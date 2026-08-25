const { onRequest } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions');
const admin = require('firebase-admin');
const Busboy = require('busboy');
const crypto = require('crypto');

admin.initializeApp({ storageBucket: 'd2-project-management.firebasestorage.app' });

const db = admin.firestore();
const bucket = admin.storage().bucket();
const REQUESTS = 'artifacts/d2-Project-Management/public/data/contractor_document_requests';
const MAX_FILE_SIZE = 15 * 1024 * 1024;
const MAX_REQUEST_AGE = 30 * 24 * 60 * 60 * 1000;
const ALLOWED_TYPES = new Set([
  'application/pdf', 'image/jpeg', 'image/png',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]);

function requestCollection() {
  return db.collection(REQUESTS);
}

function safeFileName(value) {
  return String(value || 'document').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
}

function isExpired(request) {
  const created = request.createdAt?.toDate?.() || new Date(request.createdAtClient || 0);
  return !Number.isFinite(created.getTime()) || Date.now() - created.getTime() > MAX_REQUEST_AGE;
}

async function findRequest(token) {
  if (!token || typeof token !== 'string' || token.length < 20) return null;
  const snapshot = await requestCollection().where('token', '==', token).limit(1).get();
  if (snapshot.empty) return null;
  return { ref: snapshot.docs[0].ref, id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
}

function cleanText(value, maxLength = 180) {
  return String(value || '').trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, maxLength);
}

async function publicRequest(request) {
  const result = {
    contractorName: request.contractorName,
    company: request.company,
    projectName: request.projectName,
    dueDate: request.dueDate || '',
    note: request.note || '',
    requestType: request.requestType || 'documents',
    registrationStatus: request.registrationStatus || '',
    documents: (request.documents || []).map(document => ({
      id: document.id,
      label: document.label,
      status: document.status || 'pending',
      originalName: document.originalName || ''
    }))
  };
  if (result.requestType === 'registration' && request.contractorId) {
    const snapshot = await db.doc(`artifacts/d2-Project-Management/public/data/contractors/${request.contractorId}`).get();
    const contractor = snapshot.data() || {};
    result.registration = {
      businessName: contractor.registrationStatus === 'submitted' ? contractor.businessName || '' : '',
      contactName: contractor.contactName || '',
      email: contractor.email || request.contractorEmail || '',
      phone: contractor.phone || '',
      ein: contractor.ein || '',
      address: contractor.address || '',
      services: contractor.services || ''
    };
  }
  return result;
}

async function registerContractor(request, body) {
  if (request.requestType !== 'registration' || !request.contractorId) throw new Error('Convite de cadastro inválido.');
  const businessName = cleanText(body.businessName, 160);
  const contactName = cleanText(body.contactName, 120);
  const email = cleanText(body.email, 180).toLowerCase();
  const phone = cleanText(body.phone, 60);
  const address = cleanText(body.address, 240);
  const ein = cleanText(body.ein, 40);
  const services = cleanText(body.services, 500);
  if (!businessName || !contactName || !email || !phone || !address || !email.includes('@')) throw new Error('Preencha empresa, contato, e-mail, telefone e endereço.');
  const now = admin.firestore.FieldValue.serverTimestamp();
  const contractorRef = db.doc(`artifacts/d2-Project-Management/public/data/contractors/${request.contractorId}`);
  const batch = db.batch();
  batch.set(contractorRef, {
    businessName, contactName, email, phone, address, ein, services,
    companies: [request.company], company: request.company,
    registrationStatus: 'submitted', registrationSubmittedAt: now,
    updatedAt: now, updatedBy: 'contractor_public_portal'
  }, { merge: true });
  batch.update(request.ref, {
    contractorName: businessName, contractorEmail: email,
    registrationStatus: 'submitted', registrationSubmittedAt: now,
    updatedAt: now
  });
  await batch.commit();
  logger.info('Contractor registration submitted', { requestId: request.id, contractorId: request.contractorId });
  return { ok: true, registrationStatus: 'submitted' };
}

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const fields = {}; let file = null; let fileError = null;
    const parser = Busboy({ headers: req.headers, limits: { files: 1, fields: 8, fileSize: MAX_FILE_SIZE } });
    parser.on('field', (name, value) => { fields[name] = value; });
    parser.on('file', (_name, stream, info) => {
      const chunks = []; let size = 0;
      stream.on('data', chunk => { size += chunk.length; chunks.push(chunk); });
      stream.on('limit', () => { fileError = new Error('Arquivo excede o limite de 15 MB.'); });
      stream.on('end', () => { file = { buffer: Buffer.concat(chunks), size, filename: info.filename, mimeType: info.mimeType }; });
    });
    parser.on('error', reject);
    parser.on('finish', () => fileError ? reject(fileError) : resolve({ fields, file }));
    parser.end(req.rawBody);
  });
}

exports.contractorDocuments = onRequest({
  region: 'us-east1',
  cors: true,
  invoker: 'public',
  timeoutSeconds: 60,
  memory: '512MiB'
}, async (req, res) => {
  try {
    if (req.method === 'GET') {
      const request = await findRequest(req.query.token);
      if (!request || request.status !== 'open' || isExpired(request)) return res.status(404).json({ error: 'Solicitação não disponível.' });
      return res.status(200).json(await publicRequest(request));
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });
    if (req.is('application/json') && req.body?.action === 'register') {
      const request = await findRequest(req.body.token);
      if (!request || request.status !== 'open' || isExpired(request)) return res.status(404).json({ error: 'Convite não disponível.' });
      try {
        return res.status(200).json(await registerContractor(request, req.body));
      } catch (error) {
        return res.status(400).json({ error: error.message || 'Não foi possível salvar o cadastro.' });
      }
    }
    const { fields, file } = await parseMultipart(req);
    if (fields.action !== 'upload') return res.status(400).json({ error: 'Ação inválida.' });
    const request = await findRequest(fields.token);
    if (!request || request.status !== 'open' || isExpired(request)) return res.status(404).json({ error: 'Solicitação não disponível.' });
    const documentId = String(fields.documentId || '');
    const requestedDocument = (request.documents || []).find(document => document.id === documentId);
    if (!requestedDocument || !file || !file.buffer?.length) return res.status(400).json({ error: 'Documento ou arquivo inválido.' });
    if (file.size > MAX_FILE_SIZE || !ALLOWED_TYPES.has(file.mimeType)) return res.status(400).json({ error: 'Formato não permitido ou arquivo maior que 15 MB.' });
    const storagePath = `contractor_documents/${request.company}/${request.contractorId}/${request.id}/${documentId}/${crypto.randomUUID()}-${safeFileName(file.filename)}`;
    await bucket.file(storagePath).save(file.buffer, { resumable: false, metadata: { contentType: file.mimeType, metadata: { requestId: request.id, contractorId: request.contractorId, documentId } } });
    const uploadedAt = new Date().toISOString();
    const nextDocuments = (request.documents || []).map(document => document.id === documentId ? { ...document, status: 'submitted', storagePath, originalName: safeFileName(file.filename), contentType: file.mimeType, size: file.size, submittedAt: uploadedAt } : document);
    await request.ref.update({ documents: nextDocuments, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    const contractorRef = db.doc(`artifacts/d2-Project-Management/public/data/contractors/${request.contractorId}`);
    const contractorUpdate = { documents: admin.firestore.FieldValue.arrayUnion({ requestId: request.id, documentId, name: safeFileName(file.filename), label: requestedDocument.label, type: file.mimeType, size: file.size, company: request.company, projectId: request.projectId, projectName: request.projectName, storagePath, receivedAt: uploadedAt, status: 'submitted' }), updatedAt: admin.firestore.FieldValue.serverTimestamp() };
    if (documentId === 'w9') contractorUpdate.w9Status = 'received';
    await contractorRef.set(contractorUpdate, { merge: true });
    logger.info('Contractor document uploaded', { requestId: request.id, contractorId: request.contractorId, documentId });
    return res.status(200).json({ ok: true, documentId, status: 'submitted' });
  } catch (error) {
    logger.error('Contractor document upload failed', error);
    return res.status(500).json({ error: 'Não foi possível processar o documento.' });
  }
});
