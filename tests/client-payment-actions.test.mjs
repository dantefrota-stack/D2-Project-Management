import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import {assertUnchangedProjectFields} from '../project-concurrency.mjs';
import {preserveInventoryExpenses} from '../inventory-expenses.mjs';

const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const slice = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Missing source boundaries: ${start}`);
  return source.slice(from, to);
};
function fixture({allowed = true, language = 'en'} = {}) {
  const project = {id: 'qa', cliente: 'Demo client', valorTotal: 70000, percComissao: 5, metodo: 'Zelle',
    recebimentos: [{id: 'original', data: '2026-08-21', valor: 25000, metodo: 'Zelle', registradoPor: 'existing@example.test'}],
    pagamentosEfetuados: [{id: 'commission', data: '2026-08-21', valor: 1250}],
    despesas: [{id: 'manual', valor: 30}], inventoryExpenses: [{id: 'stock', valor: 80}]};
  const state = {lang: language, projects: [project], user: {email: 'admin@example.test'}};
  const elements = new Map(), writes = [];
  const window = {t: key => key, renderProjects: () => {}, showModal: (title, message, type, confirm) => {window.modal = {title, message, type, confirm};}};
  const ctx = vm.createContext({state, window, db: {}, appId: 'qa', crypto: {randomUUID},
    document: {querySelectorAll: () => [], getElementById: id => {
      if (!elements.has(id)) elements.set(id, {textContent: '', classList: {add: () => {}, remove: () => {}}});
      return elements.get(id);
    }},
    loc: (pt, en, es) => language === 'pt' ? pt : language === 'es' ? es : en,
    canManageProjectEntries: () => allowed, denyProjectEntryManagement: () => {window.denied = true;},
    logAccess: async () => {}, getProjectLogMeta: () => ({}), getProjectDisplayName: p => p.cliente,
    getUserDisplayName: email => email, getCompanyDisplayName: company => company || 'Demo company',
    getProjectExpensesForMetrics: p => p.despesas || [], getAutomaticCompletionPayload: () => null,
    formatCurr: n => `$${Number(n).toFixed(2)}`, doc: (db, ...path) => ({id: path.at(-1)}),
    assertUnchangedProjectFields, preserveInventoryExpenses,
    runTransaction: async (db, callback) => callback({get: async () => ({exists: () => true, data: () => ctx.fresh}),
      update: (ref, patch) => {writes.push(patch); Object.assign(ctx.fresh, patch);}})
  });
  ctx.fresh = structuredClone(project);
  vm.runInContext(
    slice('    const roundMoney =', '    const getReceiptMethodBadge =') +
    slice('    function isAdvanceCommissionPayment(', '    function getMarginAlertState(') +
    slice('    function getFin(', '    window.renderProjects =') +
    slice('    function getPaymentDraftSummary(', '    function isAdvanceCommissionPayment(') +
    slice('    async function updateProjectSafely(', '    function denyProjectEntryManagement(') +
    slice('    function financialDraftSignature(', '    window.renderPaymentEditList =') +
    slice('    window.openEditRecModal =', '    window.renderRecEditList =') +
    slice('    window.updateRecField =', '    // --- NAVEGAÇÃO INTERNA DO MODO FOCO ---'), ctx);
  window.renderRecEditList = () => {};
  window.renderPaymentEditList = () => {};
  return {ctx, state, window, writes, project, elements, fin: () => vm.runInContext('getFin(state.projects[0])', ctx)};
}
function enterPayment(f, method = 'Zelle') {
  f.window.openFinancialAction('qa', 'receipts');
  f.window.updateRecField(1, 'valor', '5000', false);
  f.window.updateRecField(1, 'data', '2026-10-06', false);
  f.window.updateRecField(1, 'metodo', method);
}
test('client action opens one new receipt and never posts an advance or resets the current draft', () => {
  const f = fixture(); enterPayment(f);
  f.window.openFinancialAction('qa', 'receipts');
  assert.equal(f.state.editingRecs.recs.length, 2);
  assert.equal(f.state.editingRecs.recs[1].valor, 5000);
  assert.equal(f.writes.length, 0);
  assert.equal(f.state.editingPayments, null);
});
test('switching away from an untouched new receipt does not require an unnecessary confirmation', () => {
  const f = fixture(); f.window.openFinancialAction('qa', 'receipts');
  f.window.openFinancialAction('qa', 'payments');
  assert.equal(f.state.editingRecs, null);
  assert.equal(f.state.editingPayments.payments.length, 1);
  assert.equal(f.window.modal, undefined);
  assert.equal(f.writes.length, 0);
});
test('a $5000 client receipt saves once, preserves history and unrelated expenses and releases the correct commission', async () => {
  const f = fixture(); enterPayment(f);
  await Promise.all([f.window.saveEditedRecs(), f.window.saveEditedRecs()]);
  assert.equal(f.writes.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(f.writes[0].recebimentos[0])), f.project.recebimentos[0]);
  assert.equal(f.writes[0].recebimentos[1].valor, 5000);
  assert.equal(f.writes[0].recebimentos[1].metodo, 'Zelle');
  assert.equal('_isNew' in f.writes[0].recebimentos[1], false);
  assert.equal('pagamentosEfetuados' in f.writes[0], false);
  assert.equal('despesas' in f.writes[0], false);
  assert.equal(f.fin().totalRecebido, 30000);
  assert.equal(f.fin().clientOutstanding, 40000);
  assert.equal(f.fin().dueNow, 250);
  assert.equal(f.state.editingRecs, null);
});
test('actual card method deducts 3% from the commission base, not the client gross receipt', async () => {
  const f = fixture(); enterPayment(f, 'CC'); await f.window.saveEditedRecs();
  assert.equal(f.fin().totalRecebido, 30000);
  assert.equal(f.fin().clientOutstanding, 40000);
  assert.equal(f.fin().commLiberada, 1492.5);
  assert.equal(f.fin().dueNow, 242.5);
});
test('switching financial actions requires discarding unsaved changes in all three languages', () => {
  for (const [language, title] of [['pt', 'Alterações não salvas'], ['en', 'Unsaved changes'], ['es', 'Cambios sin guardar']]) {
    const f = fixture({language}); enterPayment(f);
    f.window.openFinancialAction('qa', 'payments');
    assert.equal(f.window.modal.title, title);
    assert.equal(f.state.editingRecs.recs[1].valor, 5000);
    assert.equal(f.state.editingPayments, null);
    f.window.modal.confirm();
    assert.equal(f.state.editingRecs, null);
    assert.equal(f.state.editingPayments.payments.length, 1);
    assert.equal(f.writes.length, 0);
  }
});
test('validation requires a positive amount and an explicit method; denied users cannot open the action', async () => {
  const denied = fixture({allowed: false}); denied.window.openFinancialAction('qa', 'receipts');
  assert.equal(denied.window.denied, true); assert.equal(denied.state.editingRecs, undefined);
  const f = fixture(); f.window.openFinancialAction('qa', 'receipts');
  await f.window.saveEditedRecs(); assert.equal(f.writes.length, 0);
  f.window.updateRecField(1, 'valor', 5000, false);
  await f.window.saveEditedRecs(); assert.equal(f.writes.length, 0);
  f.window.updateRecField(1, 'metodo', 'Zelle');
  f.window.updateRecField(1, 'valor', -10, false);
  await f.window.saveEditedRecs(); assert.equal(f.writes.length, 0);
});
test('a concurrent client receipt blocks a stale save and keeps both the live update and the draft', async () => {
  const f = fixture(); enterPayment(f);
  f.ctx.fresh.recebimentos.push({data: '2026-10-06', valor: 100, metodo: 'Check'});
  await f.window.saveEditedRecs();
  assert.equal(f.writes.length, 0);
  assert.equal(f.ctx.fresh.recebimentos.length, 2);
  assert.equal(f.state.editingRecs.recs[1].valor, 5000);
  assert.equal(f.state.editingRecs.saving, false);
  assert.equal(f.window.modal.type, 'error');
});
