const {onRequest} = require('firebase-functions/v2/https');
const {logger} = require('firebase-functions');
const {initializeApp} = require('firebase-admin/app');
const {getFirestore, FieldValue, Timestamp} = require('firebase-admin/firestore');
const {getStorage} = require('firebase-admin/storage');
const {getAuth} = require('firebase-admin/auth');
const Busboy = require('busboy');
const crypto = require('crypto');

initializeApp({storageBucket: 'd2-project-management.firebasestorage.app'});

const db = getFirestore();
const bucket = getStorage().bucket();
const auth = getAuth();
const APP_ROOT = 'artifacts/d2-Project-Management/public/data';
const REQUESTS = `${APP_ROOT}/contractor_document_requests`;
const CONTRACTORS = `${APP_ROOT}/contractors`;
const PROJECTS = `${APP_ROOT}/projects`;
const USERS = `${APP_ROOT}/user_credentials`;
const ACCESS = `${APP_ROOT}/access_control`;
const AUDIT = `${APP_ROOT}/audit_logs`;
const SUPER_ADMIN = 'dante.frota@allcablingtech.com';
const MAX_FILE_SIZE = 15 * 1024 * 1024;
const MAX_REQUEST_AGE = 30 * 24 * 60 * 60 * 1000;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT = 30;
const ALLOWED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const CORS_ORIGINS = [
  'https://d2-project-management.web.app',
  'https://d2-project-management.firebaseapp.com',
  'http://127.0.0.1:4173',
  'http://localhost:4173'
];

const cleanText = (value, maxLength = 180) => String(value || '').trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, maxLength);
const safeFileName = value => cleanText(value || 'document', 120).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
const tokenHash = token => crypto.createHash('sha256').update(String(token || '')).digest('hex');
const isSuperAdminEmail = email => String(email || '').toLowerCase() === SUPER_ADMIN;
const requestCollection = () => db.collection(REQUESTS);

function normalizePermissions(profile = {}, superAdmin = false) {
  if (superAdmin) return {p_smart: true, p_hvac: true, p_global: true, p_tab_proj: true, p_tab_new: true, p_tab_rep: true, p_fin: true, p_costs: true, p_contractors: true};
  return {
    p_smart: profile.p_smart !== false,
    p_hvac: profile.p_hvac !== false,
    p_global: profile.p_global === true || profile.viewAll === true,
    p_tab_proj: profile.p_tab_proj !== false,
    p_tab_new: profile.p_tab_new === true,
    p_tab_rep: profile.p_tab_rep === true,
    p_fin: profile.p_fin === true,
    p_costs: profile.p_costs === true || profile.viewCosts === true,
    p_contractors: profile.p_contractors === true
  };
}

function sanitizeProfile(id, profile = {}) {
  const {password: _removedPassword, ...safe} = profile;
  return {id, ...safe};
}

async function profileByEmail(email) {
  const target = String(email || '').toLowerCase();
  let snapshot = await db.collection(USERS).where('email', '==', target).limit(1).get();
  if (!snapshot.empty) return snapshot.docs[0];
  snapshot = await db.collection(USERS).get();
  return snapshot.docs.find(item => String(item.data().email || '').toLowerCase() === target) || null;
}

async function writeAccess(userRecord, profile = {}, superAdmin = false) {
  const permissions = normalizePermissions(profile, superAdmin);
  const data = {
    uid: userRecord.uid, email: String(userRecord.email || '').toLowerCase(),
    name: cleanText(profile.name || userRecord.displayName || '', 120), active: !userRecord.disabled,
    superAdmin, ...permissions, updatedAt: FieldValue.serverTimestamp()
  };
  await db.doc(`${ACCESS}/${userRecord.uid}`).set(data, {merge: true});
  return data;
}

async function listSanitizedTeam() {
  const snapshot = await db.collection(USERS).get();
  return snapshot.docs.map(item => sanitizeProfile(item.id, item.data()));
}

async function sanitizeAndSynchronizeAllUsers() {
  const profiles = await db.collection(USERS).get();
  const byEmail = new Map(profiles.docs.map(item => [String(item.data().email || '').toLowerCase(), item]));
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    const batch = db.batch();
    for (const userRecord of page.users) {
      const email = String(userRecord.email || '').toLowerCase();
      const profileDoc = byEmail.get(email);
      const superAdmin = isSuperAdminEmail(email);
      if (profileDoc || superAdmin) {
        const permissions = normalizePermissions(profileDoc?.data() || {}, superAdmin);
        batch.set(db.doc(`${ACCESS}/${userRecord.uid}`), {
          uid: userRecord.uid, email, name: cleanText(profileDoc?.data()?.name || userRecord.displayName || '', 120),
          active: !userRecord.disabled, superAdmin, ...permissions, updatedAt: FieldValue.serverTimestamp()
        }, {merge: true});
      }
      if (profileDoc?.data()?.password !== undefined) batch.update(profileDoc.ref, {password: FieldValue.delete()});
    }
    await batch.commit();
    pageToken = page.pageToken;
  } while (pageToken);
}

async function normalizeLegacyContractors() {
  const snapshot = await db.collection(CONTRACTORS).get();
  for (let index = 0; index < snapshot.docs.length; index += 450) {
    const batch = db.batch(); let writes = 0;
    snapshot.docs.slice(index, index + 450).forEach(item => {
      const data = item.data(); const companies = Array.isArray(data.companies) ? data.companies.filter(company => ['HVAC', 'Smart Home'].includes(company)) : [];
      const fallback = ['HVAC', 'Smart Home'].includes(data.company) ? data.company : '';
      const normalized = Array.from(new Set([...companies, fallback].filter(Boolean)));
      if (normalized.length && JSON.stringify(normalized) !== JSON.stringify(companies)) { batch.set(item.ref, {companies: normalized, company: normalized[0], updatedAt: FieldValue.serverTimestamp()}, {merge: true}); writes += 1; }
    });
    if (writes) await batch.commit();
  }
}

async function authenticatedContext(req) {
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Bearer ')) throw Object.assign(new Error('Authentication required.'), {status: 401});
  const decoded = await auth.verifyIdToken(header.slice(7));
  const email = String(decoded.email || '').toLowerCase();
  const superAdmin = isSuperAdminEmail(email);
  const profileDoc = await profileByEmail(email);
  if (!superAdmin && !profileDoc) throw Object.assign(new Error('User is not authorized for this system.'), {status: 403});
  const userRecord = await auth.getUser(decoded.uid);
  if (userRecord.disabled) throw Object.assign(new Error('User is disabled.'), {status: 403});
  const profile = profileDoc?.data() || {};
  const access = await writeAccess(userRecord, profile, superAdmin);
  return {decoded, email, superAdmin, profileDoc, profile, access, userRecord};
}

function requireSuperAdmin(context) {
  if (!context.superAdmin) throw Object.assign(new Error('Super administrator permission required.'), {status: 403});
}

function canCompany(context, company) {
  return context.superAdmin || (company === 'HVAC' ? context.access.p_hvac : company === 'Smart Home' && context.access.p_smart);
}

function requireContractorCompany(context, company) {
  if (!(context.superAdmin || context.access.p_contractors) || !canCompany(context, company)) throw Object.assign(new Error('Contractor or company permission denied.'), {status: 403});
}

async function auditLog(context, action, meta = {}) {
  const safeMeta = {};
  for (const [key, value] of Object.entries(meta || {}).slice(0, 30)) {
    if (['string', 'number', 'boolean'].includes(typeof value) || value === null) safeMeta[cleanText(key, 60)] = typeof value === 'string' ? cleanText(value, 500) : value;
  }
  await db.collection(AUDIT).add({user: context.email, uid: context.decoded.uid, action: cleanText(action, 500), timestampIso: new Date().toISOString(), createdAt: FieldValue.serverTimestamp(), ...safeMeta});
}

function isExpired(request) {
  if (request.expiresAt?.toDate) return request.expiresAt.toDate().getTime() < Date.now();
  const created = request.createdAt?.toDate?.() || new Date(request.createdAtClient || 0);
  return !Number.isFinite(created.getTime()) || Date.now() - created.getTime() > MAX_REQUEST_AGE;
}

async function findRequest(token) {
  if (!token || typeof token !== 'string' || token.length < 20) return null;
  let snapshot = await requestCollection().where('tokenHash', '==', tokenHash(token)).limit(1).get();
  if (snapshot.empty) {
    snapshot = await requestCollection().where('token', '==', token).limit(1).get();
    if (!snapshot.empty) await snapshot.docs[0].ref.update({tokenHash: tokenHash(token), token: FieldValue.delete()});
  }
  if (snapshot.empty) return null;
  return {ref: snapshot.docs[0].ref, id: snapshot.docs[0].id, ...snapshot.docs[0].data()};
}

async function enforceRateLimit(request) {
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(request.ref);
    const data = snapshot.data() || {};
    const start = data.rateWindowStart?.toMillis?.() || 0;
    const currentWindow = Date.now() - start < RATE_WINDOW_MS;
    const count = currentWindow ? Number(data.rateCount || 0) + 1 : 1;
    if (count > RATE_LIMIT) throw Object.assign(new Error('Too many attempts. Try again later.'), {status: 429});
    transaction.update(request.ref, {rateWindowStart: currentWindow ? data.rateWindowStart : Timestamp.now(), rateCount: count});
  });
}

async function publicRequest(request) {
  const result = {
    contractorName: request.contractorName, company: request.company, projectName: request.projectName,
    dueDate: request.dueDate || '', note: request.note || '', requestType: request.requestType || 'documents',
    registrationStatus: request.registrationStatus || '',
    documents: (request.documents || []).map(document => ({id: document.id, label: document.label, status: document.status || 'pending', originalName: document.originalName || '', expiresOn: document.expiresOn || '', rejectionReason: document.rejectionReason || ''}))
  };
  if (result.requestType === 'registration' && request.contractorId) {
    const snapshot = await db.doc(`${CONTRACTORS}/${request.contractorId}`).get();
    const contractor = snapshot.data() || {};
    result.registration = {businessName: contractor.registrationStatus === 'submitted' ? contractor.businessName || '' : '', contactName: contractor.contactName || '', email: contractor.email || request.contractorEmail || '', phone: contractor.phone || '', ein: '', address: contractor.address || '', services: contractor.services || ''};
  }
  return result;
}

async function registerContractor(request, body) {
  if (request.requestType !== 'registration' || !request.contractorId) throw new Error('Invalid registration invitation.');
  const businessName = cleanText(body.businessName, 160); const contactName = cleanText(body.contactName, 120);
  const email = cleanText(body.email, 180).toLowerCase(); const phone = cleanText(body.phone, 60);
  const address = cleanText(body.address, 240); const ein = cleanText(body.ein, 40); const services = cleanText(body.services, 500);
  if (!businessName || !contactName || !email || !phone || !address || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Complete company name, contact, email, phone, and address.');
  const now = FieldValue.serverTimestamp(); const contractorRef = db.doc(`${CONTRACTORS}/${request.contractorId}`); const batch = db.batch();
  batch.set(contractorRef, {businessName, contactName, email, phone, address, ein, services, companies: FieldValue.arrayUnion(request.company), registrationStatus: 'submitted', registrationSubmittedAt: now, updatedAt: now, updatedBy: 'contractor_public_portal'}, {merge: true});
  batch.update(request.ref, {contractorName: businessName, contractorEmail: email, registrationStatus: 'submitted', registrationSubmittedAt: now, updatedAt: now});
  await batch.commit();
  logger.info('Contractor registration submitted', {requestId: request.id, contractorId: request.contractorId});
  return {ok: true, registrationStatus: 'submitted'};
}

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const fields = {}; let file = null; let fileError = null;
    const parser = Busboy({headers: req.headers, limits: {files: 1, fields: 8, fileSize: MAX_FILE_SIZE}});
    parser.on('field', (name, value) => { fields[name] = value; });
    parser.on('file', (_name, stream, info) => {
      const chunks = []; let size = 0;
      stream.on('data', chunk => { size += chunk.length; chunks.push(chunk); });
      stream.on('limit', () => { fileError = new Error('File exceeds the 15 MB limit.'); });
      stream.on('end', () => { file = {buffer: Buffer.concat(chunks), size, filename: info.filename, mimeType: info.mimeType}; });
    });
    parser.on('error', reject);
    parser.on('finish', () => fileError ? reject(fileError) : resolve({fields, file}));
    parser.end(req.rawBody);
  });
}

function validFileSignature(file) {
  if (!file?.buffer?.length || !ALLOWED_TYPES.has(file.mimeType)) return false;
  const data = file.buffer;
  if (file.mimeType === 'application/pdf') return data.subarray(0, 5).toString() === '%PDF-';
  if (file.mimeType === 'image/jpeg') return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (file.mimeType === 'image/png') return data.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  return false;
}

exports.contractorDocuments = onRequest({region: 'us-east1', cors: CORS_ORIGINS, invoker: 'public', timeoutSeconds: 60, memory: '512MiB'}, async (req, res) => {
  try {
    if (req.method === 'GET') {
      const request = await findRequest(req.query.token);
      if (!request || request.status !== 'open' || isExpired(request)) return res.status(404).json({error: 'Request is unavailable or expired.'});
      await enforceRateLimit(request);
      return res.status(200).json(await publicRequest(request));
    }
    if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed.'});
    if (req.is('application/json') && req.body?.action === 'register') {
      const request = await findRequest(req.body.token);
      if (!request || request.status !== 'open' || isExpired(request)) return res.status(404).json({error: 'Invitation is unavailable or expired.'});
      await enforceRateLimit(request);
      try { return res.status(200).json(await registerContractor(request, req.body)); } catch (error) { return res.status(400).json({error: error.message || 'Registration could not be saved.'}); }
    }
    const {fields, file} = await parseMultipart(req);
    if (fields.action !== 'upload') return res.status(400).json({error: 'Invalid action.'});
    const request = await findRequest(fields.token);
    if (!request || request.status !== 'open' || isExpired(request)) return res.status(404).json({error: 'Request is unavailable or expired.'});
    await enforceRateLimit(request);
    const documentId = String(fields.documentId || ''); const requestedDocument = (request.documents || []).find(document => document.id === documentId);
    if (!requestedDocument || !file || !file.buffer?.length) return res.status(400).json({error: 'Invalid document or file.'});
    if (file.size > MAX_FILE_SIZE || !validFileSignature(file)) return res.status(400).json({error: 'Only valid PDF, JPG, and PNG files up to 15 MB are accepted.'});
    const storagePath = `contractor_documents/${request.company}/${request.contractorId}/${request.id}/${documentId}/${crypto.randomUUID()}-${safeFileName(file.filename)}`;
    await bucket.file(storagePath).save(file.buffer, {resumable: false, validation: 'crc32c', metadata: {contentType: file.mimeType, cacheControl: 'private, no-store', metadata: {requestId: request.id, contractorId: request.contractorId, documentId}}});
    const uploadedAt = new Date().toISOString(); const previousPath = requestedDocument.storagePath || '';
    const nextDocuments = (request.documents || []).map(document => document.id === documentId ? {...document, status: 'submitted', storagePath, originalName: safeFileName(file.filename), contentType: file.mimeType, size: file.size, submittedAt: uploadedAt, reviewedAt: '', reviewedBy: '', rejectionReason: ''} : document);
    const contractorRef = db.doc(`${CONTRACTORS}/${request.contractorId}`);
    await db.runTransaction(async transaction => {
      const contractorSnapshot = await transaction.get(contractorRef); const contractor = contractorSnapshot.data() || {}; const files = Array.isArray(contractor.documents) ? contractor.documents : [];
      const nextFiles = files.filter(item => !(item.requestId === request.id && item.documentId === documentId));
      nextFiles.push({requestId: request.id, documentId, name: safeFileName(file.filename), label: requestedDocument.label, type: file.mimeType, size: file.size, company: request.company, projectId: request.projectId, projectName: request.projectName, storagePath, receivedAt: uploadedAt, status: 'submitted'});
      transaction.update(request.ref, {documents: nextDocuments, updatedAt: FieldValue.serverTimestamp()});
      transaction.set(contractorRef, {documents: nextFiles, updatedAt: FieldValue.serverTimestamp()}, {merge: true});
    });
    if (previousPath && previousPath !== storagePath) await bucket.file(previousPath).delete({ignoreNotFound: true}).catch(error => logger.warn('Previous contractor document could not be removed', error));
    logger.info('Contractor document uploaded', {requestId: request.id, contractorId: request.contractorId, documentId});
    return res.status(200).json({ok: true, documentId, status: 'submitted'});
  } catch (error) {
    logger.error('Contractor document request failed', error);
    return res.status(error.status || 500).json({error: error.message || 'The request could not be processed.'});
  }
});

async function createSecureRequest(context, body) {
  const company = body.company === 'Smart Home' ? 'Smart Home' : body.company === 'HVAC' ? 'HVAC' : '';
  requireContractorCompany(context, company);
  const documents = Array.isArray(body.documents) ? body.documents.slice(0, 20).map(item => ({id: cleanText(item.id, 100), label: cleanText(item.label, 160), status: 'pending', custom: item.custom === true})).filter(item => item.id && item.label) : [];
  if (!documents.length) throw Object.assign(new Error('At least one document is required.'), {status: 400});
  const projectId = cleanText(body.projectId, 160); let project = null;
  if (projectId) {
    const snapshot = await db.doc(`${PROJECTS}/${projectId}`).get();
    if (!snapshot.exists || snapshot.data().empresa !== company) throw Object.assign(new Error('Project and company do not match.'), {status: 400});
    project = {id: snapshot.id, ...snapshot.data()};
  }
  const rawToken = crypto.randomBytes(32).toString('base64url'); const dueDate = cleanText(body.dueDate, 20);
  const dueTimestamp = dueDate && Number.isFinite(new Date(`${dueDate}T23:59:59Z`).getTime()) ? Timestamp.fromDate(new Date(`${dueDate}T23:59:59Z`)) : null;
  const maxExpiry = Timestamp.fromMillis(Date.now() + MAX_REQUEST_AGE); const expiresAt = dueTimestamp && dueTimestamp.toMillis() < maxExpiry.toMillis() ? dueTimestamp : maxExpiry;
  const requestRef = requestCollection().doc();
  const common = {tokenHash: tokenHash(rawToken), company, projectId: project?.id || '', projectName: cleanText(body.projectName || project?.nomeProjeto || project?.cliente || '', 240), dueDate, expiresAt, note: cleanText(body.note, 500), documents, status: 'open', createdAt: FieldValue.serverTimestamp(), createdAtClient: new Date().toISOString(), createdBy: context.email};
  if (body.requestType === 'registration') {
    const contractorRef = db.collection(CONTRACTORS).doc(); const recipient = cleanText(body.recipient, 180); const placeholderName = recipient ? `Pending registration - ${recipient}` : 'Pending registration'; const batch = db.batch();
    batch.set(contractorRef, {businessName: placeholderName, contactName: '', email: recipient.includes('@') ? recipient.toLowerCase() : '', phone: '', ein: '', address: '', services: '', companies: [company], company, w9Status: 'pending', registrationStatus: 'pending', archived: false, documents: [], createdAt: FieldValue.serverTimestamp(), createdBy: context.email, updatedAt: FieldValue.serverTimestamp(), updatedBy: context.email});
    batch.set(requestRef, {...common, requestType: 'registration', registrationStatus: 'pending', contractorId: contractorRef.id, contractorName: placeholderName, contractorEmail: recipient.includes('@') ? recipient.toLowerCase() : ''});
    await batch.commit(); await auditLog(context, `Created contractor registration invitation: ${company}`, {contractorId: contractorRef.id, contractorRequestId: requestRef.id, company});
    return {ok: true, token: rawToken, requestId: requestRef.id, contractorId: contractorRef.id};
  }
  const contractorId = cleanText(body.contractorId, 160); const contractorSnapshot = await db.doc(`${CONTRACTORS}/${contractorId}`).get();
  if (!contractorSnapshot.exists || !(contractorSnapshot.data().companies || [contractorSnapshot.data().company]).includes(company)) throw Object.assign(new Error('Contractor and company do not match.'), {status: 400});
  await requestRef.set({...common, requestType: 'documents', contractorId, contractorName: cleanText(contractorSnapshot.data().businessName, 160), contractorEmail: cleanText(contractorSnapshot.data().email, 180)});
  await auditLog(context, `Created contractor document request: ${contractorSnapshot.data().businessName}`, {contractorId, contractorRequestId: requestRef.id, company, projectId});
  return {ok: true, token: rawToken, requestId: requestRef.id, contractorId};
}

exports.adminApi = onRequest({region: 'us-east1', cors: CORS_ORIGINS, invoker: 'public', timeoutSeconds: 60, memory: '512MiB'}, async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({error: 'Method not allowed.'});
    const context = await authenticatedContext(req); const action = cleanText(req.body?.action, 80);
    if (action === 'session') {
      if (context.superAdmin) { await sanitizeAndSynchronizeAllUsers(); await normalizeLegacyContractors(); }
      return res.json({ok: true, superAdmin: context.superAdmin, permissions: normalizePermissions(context.profile, context.superAdmin), team: await listSanitizedTeam()});
    }
    if (action === 'audit') { await auditLog(context, req.body.actionText, req.body.meta); return res.json({ok: true}); }
    if (action === 'clearAudit') {
      requireSuperAdmin(context); const snapshot = await db.collection(AUDIT).get();
      for (let index = 0; index < snapshot.docs.length; index += 450) { const batch = db.batch(); snapshot.docs.slice(index, index + 450).forEach(item => batch.delete(item.ref)); await batch.commit(); }
      return res.json({ok: true});
    }
    if (action === 'createUser') {
      requireSuperAdmin(context); const email = cleanText(req.body.email, 180).toLowerCase(); const name = cleanText(req.body.name, 120); const password = String(req.body.password || '');
      if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8) throw Object.assign(new Error('Name, valid email, and a temporary password of at least 8 characters are required.'), {status: 400});
      const userRecord = await auth.createUser({email, password, displayName: name, emailVerified: false}); const profileRef = db.collection(USERS).doc(); const permissions = normalizePermissions(req.body.permissions || {});
      await profileRef.set({name, email, role: cleanText(req.body.role || 'editor', 30), ...permissions, createdAt: FieldValue.serverTimestamp(), createdBy: context.email, updatedAt: FieldValue.serverTimestamp()});
      await writeAccess(userRecord, {...permissions, name}, false); await auditLog(context, `Created user: ${name}`, {managedUserUid: userRecord.uid, managedUserEmail: email});
      return res.json({ok: true, team: await listSanitizedTeam()});
    }
    if (action === 'updateUser') {
      requireSuperAdmin(context); const profileId = cleanText(req.body.profileId, 160); const profileRef = db.doc(`${USERS}/${profileId}`); const snapshot = await profileRef.get();
      if (!snapshot.exists) throw Object.assign(new Error('User profile not found.'), {status: 404});
      const oldEmail = String(snapshot.data().email || '').toLowerCase(); const userRecord = await auth.getUserByEmail(oldEmail);
      if (isSuperAdminEmail(oldEmail)) throw Object.assign(new Error('The primary administrator cannot be changed here.'), {status: 400});
      const email = cleanText(req.body.email || oldEmail, 180).toLowerCase(); const name = cleanText(req.body.name, 120); const password = String(req.body.password || ''); const update = {email, displayName: name};
      if (password) { if (password.length < 8) throw Object.assign(new Error('New password must contain at least 8 characters.'), {status: 400}); update.password = password; }
      const updatedRecord = await auth.updateUser(userRecord.uid, update); const permissions = normalizePermissions(req.body.permissions || {});
      await profileRef.set({name, email, role: cleanText(req.body.role || snapshot.data().role || 'editor', 30), ...permissions, password: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp(), updatedBy: context.email}, {merge: true});
      await writeAccess(updatedRecord, {...permissions, name}, false); await auditLog(context, `Updated user: ${name}`, {managedUserUid: userRecord.uid, managedUserEmail: email, passwordChanged: Boolean(password)});
      return res.json({ok: true, team: await listSanitizedTeam()});
    }
    if (action === 'deleteUser') {
      requireSuperAdmin(context); const profileId = cleanText(req.body.profileId, 160); const profileRef = db.doc(`${USERS}/${profileId}`); const snapshot = await profileRef.get();
      if (!snapshot.exists) throw Object.assign(new Error('User profile not found.'), {status: 404}); const email = String(snapshot.data().email || '').toLowerCase();
      if (isSuperAdminEmail(email)) throw Object.assign(new Error('The primary administrator cannot be deleted.'), {status: 400});
      const userRecord = await auth.getUserByEmail(email); const batch = db.batch(); batch.delete(profileRef); batch.delete(db.doc(`${ACCESS}/${userRecord.uid}`)); await batch.commit(); await auth.deleteUser(userRecord.uid);
      await auditLog(context, `Deleted user: ${snapshot.data().name || email}`, {managedUserUid: userRecord.uid, managedUserEmail: email}); return res.json({ok: true, team: await listSanitizedTeam()});
    }
    if (action === 'createContractorRequest') return res.json(await createSecureRequest(context, req.body));
    if (action === 'renewContractorRequest') {
      const requestId = cleanText(req.body.requestId, 160); const ref = db.doc(`${REQUESTS}/${requestId}`); const snapshot = await ref.get();
      if (!snapshot.exists) throw Object.assign(new Error('Request not found.'), {status: 404}); requireContractorCompany(context, snapshot.data().company); const rawToken = crypto.randomBytes(32).toString('base64url');
      await ref.update({tokenHash: tokenHash(rawToken), token: FieldValue.delete(), status: 'open', createdAt: FieldValue.serverTimestamp(), createdAtClient: new Date().toISOString(), expiresAt: Timestamp.fromMillis(Date.now() + MAX_REQUEST_AGE), renewedAt: FieldValue.serverTimestamp(), renewedBy: context.email});
      await auditLog(context, 'Renewed contractor request link', {contractorRequestId: requestId, company: snapshot.data().company}); return res.json({ok: true, token: rawToken});
    }
    if (action === 'revokeContractorRequest') {
      const requestId = cleanText(req.body.requestId, 160); const ref = db.doc(`${REQUESTS}/${requestId}`); const snapshot = await ref.get();
      if (!snapshot.exists) throw Object.assign(new Error('Request not found.'), {status: 404}); requireContractorCompany(context, snapshot.data().company);
      await ref.update({status: 'revoked', revokedAt: FieldValue.serverTimestamp(), revokedBy: context.email}); await auditLog(context, 'Revoked contractor request link', {contractorRequestId: requestId, company: snapshot.data().company}); return res.json({ok: true});
    }
    if (action === 'reviewDocument') {
      const contractorId = cleanText(req.body.contractorId, 160); const requestId = cleanText(req.body.requestId, 160); const documentId = cleanText(req.body.documentId, 100); const decision = req.body.decision === 'approved' ? 'approved' : req.body.decision === 'rejected' ? 'rejected' : '';
      if (!decision) throw Object.assign(new Error('Invalid review decision.'), {status: 400}); const contractorRef = db.doc(`${CONTRACTORS}/${contractorId}`); const contractorSnapshot = await contractorRef.get();
      if (!contractorSnapshot.exists) throw Object.assign(new Error('Contractor not found.'), {status: 404}); const files = Array.isArray(contractorSnapshot.data().documents) ? contractorSnapshot.data().documents : []; const target = files.find(item => item.requestId === requestId && item.documentId === documentId);
      if (!target) throw Object.assign(new Error('Document not found.'), {status: 404}); requireContractorCompany(context, target.company);
      const reviewedAt = new Date().toISOString(); const rejectionReason = decision === 'rejected' ? cleanText(req.body.reason, 500) : ''; const expiresOn = decision === 'approved' ? cleanText(req.body.expiresOn, 20) : '';
      const nextFiles = files.map(item => item.requestId === requestId && item.documentId === documentId ? {...item, status: decision, reviewedAt, reviewedBy: context.email, rejectionReason, expiresOn} : item);
      const requestRef = db.doc(`${REQUESTS}/${requestId}`); const requestSnapshot = await requestRef.get(); const requestDocuments = requestSnapshot.exists && Array.isArray(requestSnapshot.data().documents) ? requestSnapshot.data().documents.map(item => item.id === documentId ? {...item, status: decision, reviewedAt, reviewedBy: context.email, rejectionReason, expiresOn} : item) : [];
      const batch = db.batch(); batch.update(contractorRef, {documents: nextFiles, ...(documentId === 'w9' ? {w9Status: decision === 'approved' ? 'approved' : 'pending'} : {}), updatedAt: FieldValue.serverTimestamp()}); if (requestSnapshot.exists) batch.update(requestRef, {documents: requestDocuments, updatedAt: FieldValue.serverTimestamp()}); await batch.commit();
      await auditLog(context, `${decision === 'approved' ? 'Approved' : 'Rejected'} contractor document: ${target.label}`, {contractorId, contractorRequestId: requestId, documentId, company: target.company}); return res.json({ok: true});
    }
    if (action === 'downloadDocument') {
      const storagePath = cleanText(req.body.storagePath, 800); const match = /^contractor_documents\/(HVAC|Smart Home)\//.exec(storagePath);
      if (!match) throw Object.assign(new Error('Invalid document path.'), {status: 400}); requireContractorCompany(context, match[1]);
      const [url] = await bucket.file(storagePath).getSignedUrl({action: 'read', expires: Date.now() + 5 * 60 * 1000, responseDisposition: 'inline'});
      await auditLog(context, 'Opened contractor document', {company: match[1], storagePath}); return res.json({ok: true, url, expiresInSeconds: 300});
    }
    return res.status(400).json({error: 'Invalid action.'});
  } catch (error) {
    logger.error('Admin API request failed', error);
    return res.status(error.status || 500).json({error: error.message || 'Request failed.'});
  }
});
