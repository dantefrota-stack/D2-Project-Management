import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(fileURLToPath(import.meta.url));
const {buildProgressPrompt, buildTranscriptionPrompt} = require('../functions/progress-reports.js');
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
const endpoint = 'https://us-central1-aiplatform.googleapis.com/v1/projects/d2-project-management/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent';
if (process.argv.includes('--probe') && serviceData.state === 'ENABLED') {
  const response = await fetch(endpoint, {
    method: 'POST', headers: {...headers, 'Content-Type': 'application/json'},
    body: JSON.stringify({contents: [{role: 'user', parts: [{text: 'Reply with valid JSON: {"ok":true}'}]}], generationConfig: {responseMimeType: 'application/json', maxOutputTokens: 80}}),
    signal: AbortSignal.timeout(60000),
  });
  const result = await response.json().catch(() => ({}));
  probe = {status: response.status, generated: Boolean(result.candidates?.[0]?.content?.parts?.[0]?.text), errorCode: result.error?.status || null};
}
const languageProbe = [];
if (process.argv.includes('--language-probe') && serviceData.state === 'ENABLED') {
  const cases = [
    {spokenLanguage: 'pt', lang: 'en', notes: 'Concluímos a instalação dos cabos no primeiro andar. Falta agendar a inspeção.'},
    {spokenLanguage: 'en', lang: 'es', notes: 'We completed the first-floor cable installation. The inspection has not been scheduled.'},
    {spokenLanguage: 'es', lang: 'pt', notes: 'Terminamos la instalación de cables en el primer piso. Falta programar la inspección.'},
  ];
  const project = {cliente: 'Projeto de teste de idioma', nomeProjeto: 'Verificação multilíngue', numeroInvoice: '', numeroProposta: ''};
  for (const item of cases) {
    const prompt = buildProgressPrompt({project, lang: item.lang, spokenLanguage: item.spokenLanguage, audio: false});
    const response = await fetch(endpoint, {
      method: 'POST', headers: {...headers, 'Content-Type': 'application/json'},
      body: JSON.stringify({contents: [{role: 'user', parts: [{text: `${prompt}\n\nManager notes:\n${item.notes}`}]}], generationConfig: {responseMimeType: 'application/json', temperature: 0.1, maxOutputTokens: 3000, thinkingConfig: {thinkingBudget: 0}}}),
      signal: AbortSignal.timeout(60000),
    });
    const result = await response.json().catch(() => ({}));
    const raw = result.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || '';
    let draft = null;
    try { draft = JSON.parse(raw); } catch {}
    languageProbe.push({source: item.spokenLanguage, report: item.lang, status: response.status, validDraft: !!(draft?.transcript && draft?.summary && draft?.title), transcript: String(draft?.transcript || '').slice(0, 180), summary: String(draft?.summary || '').slice(0, 180), errorCode: result.error?.status || null});
  }
}
const audioProbe = [];
if (process.argv.includes('--audio-probe') && serviceData.state === 'ENABLED') {
  const directory = process.env.D2_PROGRESS_AUDIO_PROBE_DIR;
  if (!directory) throw Error('D2_PROGRESS_AUDIO_PROBE_DIR is required for --audio-probe.');
  const project = {cliente: 'Projeto de teste de idioma', nomeProjeto: 'Verificação multilíngue', numeroInvoice: '', numeroProposta: ''};
  for (const [source, target, audioLanguage] of [['pt', 'en', 'pt'], ['en', 'es', 'en'], ['es', 'pt', 'es'], ['auto', 'en', 'pt'], ['auto', 'es', 'en'], ['auto', 'pt', 'es']]) {
    const file = path.join(directory, `${audioLanguage}.wav`);
    const data = fs.readFileSync(file).toString('base64');
    const transcriptionResponse = await fetch(endpoint, {
      method: 'POST', headers: {...headers, 'Content-Type': 'application/json'},
      body: JSON.stringify({contents: [{role: 'user', parts: [{inlineData: {mimeType: 'audio/wav', data}}, {text: buildTranscriptionPrompt(source)}]}], generationConfig: {responseMimeType: 'application/json', temperature: 0.1, maxOutputTokens: 8192, thinkingConfig: {thinkingBudget: 0}}}),
      signal: AbortSignal.timeout(90000),
    });
    const transcriptionResult = await transcriptionResponse.json().catch(() => ({}));
    let transcript = '';
    try { transcript = JSON.parse(transcriptionResult.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || '').transcript || ''; } catch {}
    if (!transcript) {
      audioProbe.push({source, audioLanguage, report: target, transcriptionStatus: transcriptionResponse.status, validDraft: false, errorCode: transcriptionResult.error?.status || null});
      continue;
    }
    const prompt = buildProgressPrompt({project, lang: target, spokenLanguage: source, audio: false});
    const response = await fetch(endpoint, {
      method: 'POST', headers: {...headers, 'Content-Type': 'application/json'},
      body: JSON.stringify({contents: [{role: 'user', parts: [{text: `${prompt}\n\nManager notes:\n${transcript}`}]}], generationConfig: {responseMimeType: 'application/json', temperature: 0.1, maxOutputTokens: 3000, thinkingConfig: {thinkingBudget: 0}}}),
      signal: AbortSignal.timeout(90000),
    });
    const result = await response.json().catch(() => ({}));
    const raw = result.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || '';
    let draft = null;
    try { draft = JSON.parse(raw); } catch {}
    audioProbe.push({source, audioLanguage, report: target, transcriptionStatus: transcriptionResponse.status, status: response.status, validDraft: !!(transcript && draft?.summary && draft?.title), transcript: transcript.slice(0, 180), summary: String(draft?.summary || '').slice(0, 180), errorCode: result.error?.status || null});
  }
}
console.log(JSON.stringify({serviceStatus: service.status, vertexState: serviceData.state || null, iamStatus: iam.status, runtimeRoles: roles, probe, languageProbe, audioProbe}));
