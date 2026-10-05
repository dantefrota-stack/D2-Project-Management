import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import {assertUnchangedProjectFields} from '../project-concurrency.mjs';
import {preserveInventoryExpenses} from '../inventory-expenses.mjs';

const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const slice=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
function fixture({pending=200,released=1000,paid=800,language='en',allowed=true}={}) {
  const project={id:'qa-project',cliente:'Test customer',numeroInvoice:'INV-QA',numeroProposta:'PROP-QA',empresa:'Smart Home',vendedor:'seller@example.test',released,pagamentosEfetuados:[{id:'initial',valor:paid}],despesas:[{id:'manual',valor:25}]};
  const classes=new Set(),elements=new Map(),writes=[],timers=[];
  const state={lang:language,user:{email:'admin@example.test'},userPerms:{fin:true},projects:[project],reportProjectList:{kind:'outstanding',rows:[{project,pendingEnd:pending}]}};
  const window={showModal:(title,message,type,confirm)=>{window.modal={title,message,type,confirm};},safeRenderReport:()=>{},openReportProjectList:()=>{},closeEditPaymentModal:()=>{throw Error('Must stay in report');}};
  const ctx=vm.createContext({window,state,console,db:{},appId:'qa',crypto:{randomUUID},Set,
    document:{getElementById:id=>{if(!elements.has(id))elements.set(id,{textContent:'',classList:{add:c=>classes.add(c)}});return elements.get(id);}},
    canManageProjectEntries:()=>allowed,denyProjectEntryManagement:()=>{window.denied=true;},
    roundMoney:n=>Math.round(Number(n)*100)/100,formatCurr:n=>`$${Number(n).toFixed(2)}`,formatProjectDate:d=>d,
    getUserDisplayName:()=> 'Test seller',getCompanyDisplayName:()=> 'Test company',getProjectDisplayName:p=>p.cliente,
    getAutomaticCompletionPayload:()=>null,logAccess:()=>{},getProjectLogMeta:()=>({}),
    getPaymentDraftSummary:(id,entries)=>({remainingToPay:Math.max(0,released-entries.reduce((n,p)=>n+p.valor,0)),advanceAvailable:250,commLiberada:released,clientOutstanding:500}),
    setTimeout:fn=>{timers.push(fn);},doc:(db,...path)=>({id:path.at(-1)}),
    assertUnchangedProjectFields,preserveInventoryExpenses,
    runTransaction:async(db,callback)=>callback({get:async()=>({exists:()=>true,data:()=>ctx.fresh}),update:(ref,patch)=>writes.push(patch)})
  });
  ctx.fresh=structuredClone(project);
  vm.runInContext(slice('    async function updateProjectSafely(', '    function denyProjectEntryManagement(')+slice('    function isAdvanceCommissionPayment(', '    function getMarginAlertState(')+slice('    const commissionWrites =', '    function getReportPendingPaymentItems('),ctx);
  return {ctx,state,window,writes,timers,elements,project};
}
test('report payment confirms once, posts the commission expense and stays in the filtered report',async()=>{
  const f=fixture();f.window.payReportCommission('qa-project');
  assert.match(f.window.modal.message,/INV-QA.*PROP-QA/);assert.match(f.window.modal.message,/Test seller/);assert.match(f.window.modal.message,/\$200.00/);
  const confirm=f.window.modal.confirm;await Promise.all([confirm(),confirm()]);
  assert.equal(f.writes.length,1);assert.equal(f.writes[0].pagamentosEfetuados.at(-1).valor,200);
  assert.equal(f.writes[0].despesas.find(e=>e.linkedPaymentId===f.writes[0].pagamentosEfetuados.at(-1).id).valor,200);
  assert.ok(f.writes[0].despesas.some(e=>e.id==='manual'));
  assert.equal(f.state.reportProjectList.kind,'outstanding');assert.match(f.elements.get('report-payment-status').textContent,/recorded/);
});
test('historical report amount is capped by current eligible balance and never becomes an advance',async()=>{
  for(const [pending,released,paid,expected]of [[500,1000,800,200],[50,1000,800,50]]){
    const f=fixture({pending,released,paid});f.window.payReportCommission('qa-project');await f.window.modal.confirm();
    assert.equal(f.writes[0].pagamentosEfetuados.at(-1).valor,expected);assert.equal(f.writes[0].pagamentosEfetuados.at(-1).isAdvance,false);
  }
  const settled=fixture({paid:1000});settled.window.payReportCommission('qa-project');assert.equal(settled.window.modal.type,'info');assert.equal(settled.writes.length,0);
});
test('permission denial and an intervening payment never overwrite financial history',async()=>{
  const denied=fixture({allowed:false});denied.window.payReportCommission('qa-project');assert.equal(denied.window.denied,true);assert.equal(denied.writes.length,0);
  const f=fixture();f.window.payReportCommission('qa-project');
  f.ctx.fresh.pagamentosEfetuados.push({id:'other-user',valor:100});
  f.state.projects=[structuredClone(f.ctx.fresh)]; // Live snapshot arrives while confirmation is open.
  await f.window.modal.confirm();assert.equal(f.writes.length,0);assert.equal(f.timers.length,1);
});
test('report confirmation follows Portuguese, English and Spanish preference',()=>{
  for(const [language,title]of [['en','Record commission payment'],['pt','Registrar pagamento de comissão'],['es','Registrar pago de comisión']]){
    const f=fixture({language});f.window.payReportCommission('qa-project');assert.equal(f.window.modal.title,title);
  }
});
