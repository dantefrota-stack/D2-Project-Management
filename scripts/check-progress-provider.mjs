import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const require = createRequire(fileURLToPath(import.meta.url));
if (!process.env.D2_FIREBASE_AUTH_MODULE) throw Error('D2_FIREBASE_AUTH_MODULE is required.');
const cli = require(process.env.D2_FIREBASE_AUTH_MODULE);
const account = cli.getGlobalDefaultAccount();
if (!account?.tokens?.refresh_token) throw Error('Firebase CLI account is not signed in.');
const token = (await cli.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform']))?.access_token;
if (!token) throw Error('Firebase CLI access token unavailable.');
const headers = {Authorization: `Bearer ${token}`};
const serviceUrl = 'https://serviceusage.googleapis.com/v1/projects/d2-project-management/services/aiplatform.googleapis.com';
let service = await fetch(serviceUrl, {headers, signal: AbortSignal.timeout(30000)});
let serviceData = await service.json().catch(() => ({}));
if (process.argv.includes('--enable') && serviceData.state !== 'ENABLED') {
  const enabled = await fetch(`${serviceUrl}:enable`, {method: 'POST', headers, body: '', signal: AbortSignal.timeout(30000)});
  const operation = await enabled.json().catch(() => ({}));
  if (!enabled.ok) throw Error(`Enable Vertex AI API failed: HTTP ${enabled.status}: ${String(operation.error?.message || '').slice(0, 300)}`);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (attempt) await new Promise(resolve => setTimeout(resolve, 2000));
    service = await fetch(serviceUrl, {headers, signal: AbortSignal.timeout(30000)});
    serviceData = await service.json().catch(() => ({}));
    if (serviceData.state === 'ENABLED') break;
  }
}
const iam = await fetch('https://cloudresourcemanager.googleapis.com/v1/projects/d2-project-management:getIamPolicy', {method: 'POST', headers: {...headers, 'Content-Type': 'application/json'}, body: '{}', signal: AbortSignal.timeout(30000)});
const iamData = await iam.json().catch(() => ({}));
const member = 'serviceAccount:254630664761-compute@developer.gserviceaccount.com';
const roles = (iamData.bindings || []).filter(binding => binding.members?.includes(member)).map(binding => binding.role).sort();
let probe = null;
if (process.argv.includes('--probe') && serviceData.state === 'ENABLED') {
  const endpoint = 'https://us-central1-aiplatform.googleapis.com/v1/projects/d2-project-management/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent';
  const response = await fetch(endpoint, {
    method: 'POST', headers: {...headers, 'Content-Type': 'application/json'},
    body: JSON.stringify({contents: [{role: 'user', parts: [{text: 'Reply with valid JSON: {"ok":true}'}]}], generationConfig: {responseMimeType: 'application/json', maxOutputTokens: 80}}),
    signal: AbortSignal.timeout(60000),
  });
  const result = await response.json().catch(() => ({}));
  probe = {status: response.status, generated: Boolean(result.candidates?.[0]?.content?.parts?.[0]?.text), errorCode: result.error?.status || null};
}
console.log(JSON.stringify({serviceStatus: service.status, vertexState: serviceData.state || null, iamStatus: iam.status, runtimeRoles: roles, probe}));
