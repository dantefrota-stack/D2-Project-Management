'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {createProgressReportsHandler, normalizedDraft, parseAudio, pdfReport, buildProgressPrompt, buildTranscriptionPrompt, buildLocalizationPrompt, localizeDraft, spokenLanguage} = require('./progress-reports');

const draft = {
  title: 'Instalação elétrica', summary: 'A equipe concluiu a passagem de cabos.',
  completed: 'Passagem de cabos no primeiro andar.', progress: 'Aguardando inspeção.',
  issues: 'Inspeção ainda sem data confirmada.', nextSteps: 'Agendar inspeção.',
  transcript: 'Passamos os cabos no primeiro andar e precisamos marcar a inspeção.',
};
const project = {cliente: 'Felipe Lamounier', nomeProjeto: 'Felipe Lamounier - Miami', empresa: 'Smart Home', endereco: '4365 North Bay Road', numeroInvoice: '1789', numeroProposta: '604'};
const stamp = {toDate: () => new Date('2026-09-30T12:00:00Z'), toMillis: () => Date.parse('2026-09-30T12:00:00Z')};
const report = {...draft, projectId: 'project-smart', company: 'Smart Home', createdAt: stamp, createdBy: {uid: 'manager-1', name: 'Gerente'}};

function fakeResponse() {
  return {
    code: 200, headers: {}, payload: undefined,
    set(key, value) { this.headers[key] = value; return this; },
    status(value) { this.code = value; return this; },
    json(value) { this.payload = value; return this; },
    send(value) { this.payload = value; return this; },
  };
}
function manager(access = {}) {
  return {decoded: {uid: 'manager-1', portal_bridge: true, portal_company: 'smart'}, email: 'manager@example.com', profile: {name: 'Gerente'}, access: {p_tab_proj: true, p_global: true, p_smart: true, p_hvac: false, ...access}, superAdmin: false};
}
function fakeDb() {
  const saved = [];
  const db = {
    saved,
    doc(path) { return {get: async () => ({exists: path.endsWith('/project-smart'), data: () => project})}; },
    collection() {
      return {
        where(_field, _operator, id) {
          return {limit() { return {get: async () => ({size: id === 'project-smart' ? 1 + saved.length : 0, docs: id === 'project-smart' ? [{id: 'report-one', data: () => report}, ...saved.map((item, index) => ({id: `saved-${index}`, data: () => item}))] : []})}; }};
        },
        doc() { return {id: `saved-${saved.length}`, create: async value => {saved.push(value);}}; },
      };
    },
  };
  return db;
}

test('draft validation requires source and report text; audio limits reject invalid input', () => {
  assert.deepEqual(normalizedDraft(draft), draft);
  assert.throws(() => normalizedDraft({...draft, summary: ''}), /Invalid report text/);
  const audio = Buffer.alloc(400, 7);
  assert.equal(parseAudio(`data:audio/webm;base64,${audio.toString('base64')}`).mimeType, 'audio/webm');
  assert.throws(() => parseAudio('data:text/plain;base64,SGVsbG8='), /Unsupported audio/);
});

test('speech preference is a hint while transcript stays original and report follows Portal language', () => {
  assert.equal(spokenLanguage('unknown'), 'auto');
  for (const [source, target, sourceName, targetName] of [
    ['pt', 'en', 'Brazilian Portuguese', 'English'],
    ['en', 'es', 'English', 'Español'],
    ['es', 'pt', 'Spanish', 'Português do Brasil'],
  ]) {
    const prompt = buildProgressPrompt({project, lang: target, spokenLanguage: source, audio: true});
    assert.match(prompt, new RegExp(`Spoken language preference: ${sourceName}`));
    assert.match(prompt, new RegExp(`only in ${targetName}`));
    assert.match(prompt, /Do not translate this field/);
    assert.match(prompt, /not a reason to override the language you actually hear/);
    assert.match(prompt, /not evidence of work performed/);
  }
  assert.match(buildProgressPrompt({project, lang: 'pt', spokenLanguage: 'auto', audio: false}), /Copy the original manager notes faithfully/);
  assert.match(buildTranscriptionPrompt('auto'), /Never translate/);
  assert.doesNotMatch(buildTranscriptionPrompt('es'), /Português do Brasil/);
  assert.match(buildLocalizationPrompt('pt'), /somente em português do Brasil/);
  assert.match(buildLocalizationPrompt('en'), /only in English/);
  assert.match(buildLocalizationPrompt('es'), /solo en español/);
});

test('only managers authorized for the project company can access progress reports', async () => {
  const db = fakeDb();
  for (const [context, expected] of [[manager(), 200], [manager({p_global: false}), 403], [manager({p_smart: false}), 403], [{...manager(), decoded: {...manager().decoded, portal_company: 'hvac'}}, 403]]) {
    const handler = createProgressReportsHandler({db, authenticate: async () => context});
    const res = fakeResponse();
    await handler({method: 'GET', query: {projectId: 'project-smart'}}, res);
    assert.equal(res.code, expected);
    if (expected === 200) {
      assert.equal(res.payload.reports.length, 1);
      assert.equal(res.payload.reports[0].createdAt, '2026-09-30T12:00:00.000Z');
      assert.equal(res.payload.reports[0].transcript, undefined);
    }
  }
});

test('one report or all reports can be exported only for the selected project', async () => {
  const db = fakeDb();
  const selected = [];
  const handler = createProgressReportsHandler({db, authenticate: async () => manager(), renderPdf: async input => {selected.push(input.reports.map(item => item.id)); return Buffer.from('%PDF-test');}});
  for (const body of [{action: 'pdf', ids: ['report-one']}, {action: 'pdf', all: true}, {action: 'pdf', ids: ['other-project-report']}]) {
    const res = fakeResponse();
    await handler({method: 'POST', body: {projectId: 'project-smart', ...body}}, res);
    assert.equal(res.code, body.ids?.[0] === 'other-project-report' ? 404 : 200);
  }
  assert.deepEqual(selected, [['report-one'], ['report-one']]);
});

test('generated drafts are reviewed before save; saving stores text and project identity', async () => {
  const db = fakeDb();
  let auditCount = 0;
  const handler = createProgressReportsHandler({db, authenticate: async () => manager(), generate: async () => draft, audit: async () => {auditCount += 1;}});
  const generated = fakeResponse();
  await handler({method: 'POST', body: {projectId: 'project-smart', action: 'generate', notes: 'We installed cable on the first floor.'}}, generated);
  assert.equal(generated.code, 200);
  assert.equal(db.saved.length, 0);
  const saved = fakeResponse();
  await handler({method: 'POST', body: {projectId: 'project-smart', action: 'save', draft: generated.payload.draft}}, saved);
  assert.equal(saved.code, 200);
  assert.equal(db.saved.length, 1);
  assert.equal(db.saved[0].projectId, 'project-smart');
  assert.equal(db.saved[0].company, 'Smart Home');
  assert.equal(db.saved[0].audio, undefined);
  assert.equal(auditCount, 1);
});

test('generate action passes spoken language separately from report language', async () => {
  const inputs = [];
  const handler = createProgressReportsHandler({db: fakeDb(), authenticate: async () => manager(), generate: async input => {inputs.push(input); return draft;}});
  for (const [spoken, reportLang] of [['es', 'pt'], ['en', 'es'], ['pt', 'en'], ['unrecognized', 'pt']]) {
    const res = fakeResponse();
    await handler({method: 'POST', body: {projectId: 'project-smart', action: 'generate', notes: 'Completed the cable installation.', spokenLanguage: spoken, lang: reportLang}}, res);
    assert.equal(res.code, 200);
  }
  assert.deepEqual(inputs.map(({spokenLanguage: spoken, lang}) => [spoken, lang]), [['es', 'pt'], ['en', 'es'], ['pt', 'en'], ['auto', 'pt']]);
});

test('language correction keeps the original transcript and does not save automatically', async () => {
  const db = fakeDb();
  const handler = createProgressReportsHandler({db, authenticate: async () => manager(), localize: async ({draft: input, lang}) => ({...input, title: lang === 'pt' ? 'Relatório diário' : input.title, summary: 'Instalação realizada.', transcript: 'changed by model'})});
  const res = fakeResponse();
  await handler({method: 'POST', body: {projectId: 'project-smart', action: 'localize', lang: 'pt', draft: {...draft, title: 'Daily Progress Report'}}}, res);
  assert.equal(res.code, 200);
  assert.equal(res.payload.draft.title, 'Relatório diário');
  assert.equal(res.payload.draft.transcript, draft.transcript);
  assert.equal(db.saved.length, 0);
});

test('localization pass replaces English report fields but never rewrites the source transcript', async () => {
  const input = {...draft, title: 'Daily Progress Report', summary: 'We installed cable.'};
  const client = {models: {generateContent: async request => {
    assert.match(request.contents[0].text, /somente em português do Brasil/);
    return {text: JSON.stringify({...input, title: 'Relatório diário', summary: 'Instalamos os cabos.', transcript: 'model changed this'})};
  }}};
  const result = await localizeDraft({client, draft: input, lang: 'pt'});
  assert.equal(result.title, 'Relatório diário');
  assert.equal(result.summary, 'Instalamos os cabos.');
  assert.equal(result.transcript, draft.transcript);
});

test('branded PDFs for both companies contain a valid PDF and embedded logo', async () => {
  for (const company of ['Smart Home', 'HVAC']) {
    const pdf = await pdfReport({project: {...project, empresa: company}, reports: [report], lang: 'pt'});
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assert.ok(pdf.length > 4000);
    assert.ok(pdf.includes(Buffer.from('/Subtype /Image')));
  }
});
