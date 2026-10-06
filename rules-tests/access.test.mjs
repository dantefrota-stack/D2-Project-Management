import {readFileSync} from 'node:fs';
import {before,after,beforeEach,test} from 'node:test';
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,updateDoc,deleteDoc,collection,query,where,getDocs} from 'firebase/firestore';

if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8280')throw Error('Requires isolated Projects emulator on port 8280');
const root='artifacts/d2-Project-Management/public/data',project='demo-d2-project-audit';
const ownerUid='IYz2jpQojuRsClIHpSaSIFziAQG3';
const ownerClaims={email:'dante.frota@allcablingtech.com',portal_owner:true,portal_actions:['read','read_cost','create','edit','assign','export']};
let env;
const perms={active:true,superAdmin:false,p_smart:true,p_hvac:false,p_global:true,p_tab_proj:true,p_tab_new:true,p_tab_rep:true,p_fin:true,p_costs:true,p_contractors:false};
const record={empresa:'Smart Home',vendedor:'manager@example.test',cliente:'Audit',valorTotal:100,orcamento:20,percComissao:10,recebimentos:[],pagamentosEfetuados:[],despesas:[]};
const claims={email:'manager@example.test',email_verified:true,firebase:{sign_in_provider:'custom'},portal_bridge:true,portal_company:'smart',portal_scope:'company',portal_actions:['read','read_cost','create','edit','assign'],portal_until:Math.floor(Date.now()/1000)+300};
const db=(overrides={},uid='manager')=>env.authenticatedContext(uid,{...claims,...overrides}).firestore();
const projectRef=(database,id='smart')=>doc(database,`${root}/projects/${id}`);
const seed=async(uid,permissions)=>env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),`${root}/access_control/${uid}`),{...perms,...permissions}));
before(async()=>{env=await initializeTestEnvironment({projectId:project,firestore:{rules:readFileSync(new URL('../firestore.rules',import.meta.url),'utf8')}});});
after(async()=>env?.cleanup());
beforeEach(async()=>{await env.clearFirestore();await seed('manager',{});await env.withSecurityRulesDisabled(async c=>{
 await setDoc(projectRef(c.firestore()),record);await setDoc(projectRef(c.firestore(),'hvac'),{...record,empresa:'HVAC'});
});});
test('manager can list only the authorized company and cannot delete projects',async()=>{
 const d=db();await assertSucceeds(getDocs(query(collection(d,`${root}/projects`),where('empresa','==','Smart Home'))));
 await assertFails(getDoc(projectRef(d,'hvac')));await assertFails(getDocs(collection(d,`${root}/projects`)));await assertFails(deleteDoc(projectRef(d)));
});
test('protected owner consolidated reports read both companies, reject writes and honor revocation',async()=>{
 await seed('owner',{superAdmin:true,p_hvac:true});
 const report={portal_report_all:true,portal_actions:['read','read_cost','export']};
 const d=db(report,'owner');
 await assertFails(getDocs(collection(d,`${root}/projects`)));
 for(const company of ['Smart Home','HVAC'])await assertSucceeds(getDocs(query(collection(d,`${root}/projects`),where('empresa','==',company))));
 for(const id of ['smart','hvac']){
  await assertSucceeds(getDoc(projectRef(d,id)));
  await assertFails(updateDoc(projectRef(d,id),{pagamentosEfetuados:[{valor:1}]}));
  await assertFails(updateDoc(projectRef(d,id),{cliente:'Changed'}));
  await assertFails(deleteDoc(projectRef(d,id)));
 }
 await assertFails(setDoc(projectRef(d,'new'),record));
 await assertFails(updateDoc(projectRef(db({...report,portal_actions:['read','read_cost','edit']},'owner')),{cliente:'Changed'}));
 await seed('manager',{p_hvac:true});await assertFails(getDoc(projectRef(db(report),'hvac')));
 await seed('owner',{superAdmin:true,p_hvac:false});await assertFails(getDoc(projectRef(d,'hvac')));
 await seed('owner',{superAdmin:true,p_hvac:true,active:false});await assertFails(getDoc(projectRef(d,'smart')));
});
test('missing, expired, or malformed bridge claims never become direct access',async()=>{
 for(const override of [{portal_until:1},{portal_until:'9999999999'},{portal_bridge:false},{portal_actions:[]},{portal_actions:['read']}])await assertFails(getDoc(projectRef(db(override))));
});
test('suspension and removal of company/read permissions reject existing sessions',async()=>{
 const d=db();await assertSucceeds(getDoc(projectRef(d)));
 for(const change of [{active:false},{p_smart:false},{p_tab_proj:false}]){await seed('manager',change);await assertFails(getDoc(projectRef(d)));}
});
test('a read-only bridge cannot create, edit, assign, or mutate financial records',async()=>{
 const d=db({portal_actions:['read','read_cost']});await assertSucceeds(getDoc(projectRef(d)));
 await assertFails(setDoc(projectRef(d,'new'),record));await assertFails(updateDoc(projectRef(d),{cliente:'Changed'}));await assertFails(updateDoc(projectRef(d),{recebimentos:[{valor:1}]}));
});
test('cost permission does not grant payments, assignment, contract changes, or arbitrary fields',async()=>{
 await seed('manager',{p_tab_new:false,p_fin:false});const d=db();
 await assertSucceeds(updateDoc(projectRef(d),{despesas:[{valor:5}]}));
 for(const patch of [{recebimentos:[{valor:50}]},{pagamentosEfetuados:[{valor:50}]},{valorTotal:2},{vendedor:'other@example.test'},{injected:true}])await assertFails(updateDoc(projectRef(d),patch));
});
test('creation permits clean valid projects but not seeded payments or invalid amounts',async()=>{
 const d=db();await assertSucceeds(setDoc(projectRef(d,'new'),record));
 for(const patch of [{valorTotal:-1},{orcamento:-1},{percComissao:101},{recebimentos:[{valor:50}]},{despesas:[{valor:20}]}])await assertFails(setDoc(projectRef(d,'bad'),{...record,...patch}));
});
test('assign action is required to change the seller and companies cannot be moved',async()=>{
 const d=db({portal_actions:['read','read_cost','edit','create']});
 await assertFails(updateDoc(projectRef(d),{vendedor:'other@example.test'}));await assertFails(updateDoc(projectRef(db()),{empresa:'HVAC'}));
 await assertSucceeds(updateDoc(projectRef(db()),{vendedor:'other@example.test'}));
});
test('credentials, access controls, audit, and contractor records remain protected',async()=>{
 const d=db();for(const name of ['user_credentials','access_control','audit_logs','contractors','portal_links']){
 await assertFails(setDoc(doc(d,`${root}/${name}/tamper`),{superAdmin:true}));
 await assertFails(getDocs(collection(d,`${root}/${name}`)));
 }
});
test('direct authorized access still works and an owner bridge has no owner bypass',async()=>{
 await seed('owner',{superAdmin:true,p_hvac:true});const owner=db({},'owner');await assertFails(getDoc(projectRef(owner,'hvac')));
 const direct=db({firebase:{sign_in_provider:'password'},portal_bridge:false},'owner');await assertSucceeds(getDoc(projectRef(direct,'hvac')));
});

test('authorized protected-owner bridge manages both companies and reads contractors and audit without client ACL writes',async()=>{
 await seed(ownerUid,{superAdmin:true,p_hvac:true,p_contractors:true});const d=db(ownerClaims,ownerUid);
 for(const id of ['smart','hvac']){
  await assertSucceeds(getDoc(projectRef(d,id)));
  await assertSucceeds(updateDoc(projectRef(d,id),{cliente:'Owner edit'}));
 }
 for(const company of ['Smart Home','HVAC']){
  await assertSucceeds(getDocs(query(collection(d,`${root}/projects`),where('empresa','==',company))));
  const ref=doc(d,`${root}/contractors/${company}`);
  await assertSucceeds(setDoc(ref,{company,companies:[company],businessName:'Test contractor'}));
  await assertSucceeds(getDoc(ref));await assertSucceeds(updateDoc(ref,{businessName:'Edited'}));await assertSucceeds(deleteDoc(ref));
  const payment=doc(d,`${root}/contractor_payments/${company}`);
  await assertSucceeds(setDoc(payment,{company,valor:1}));await assertSucceeds(getDoc(payment));await assertSucceeds(deleteDoc(payment));
 }
 await assertSucceeds(getDocs(collection(d,`${root}/audit_logs`)));
 await assertFails(setDoc(doc(d,`${root}/audit_logs/forged`),{action:'Forged'}));
 await assertFails(updateDoc(doc(d,`${root}/access_control/${ownerUid}`),{superAdmin:true}));
 await assertSucceeds(setDoc(projectRef(d,'new-owner'),record));await assertSucceeds(deleteDoc(projectRef(d,'new-owner')));
});

test('owner flag cannot promote another UID, a revoked ACL, a partial grant or a consolidated report',async()=>{
 await seed(ownerUid,{superAdmin:true,p_hvac:true,p_contractors:true});
 await seed('replacement',{superAdmin:true,p_hvac:true,p_contractors:true});
 for(const [uid,patch] of [['replacement',ownerClaims],[ownerUid,{...ownerClaims,email:'other@example.test'}],
  [ownerUid,{...ownerClaims,portal_until:1}],[ownerUid,{...ownerClaims,portal_actions:['read','read_cost','edit']}],
  [ownerUid,{...ownerClaims,portal_report_all:true,portal_actions:['read','read_cost','export']}]]){
  const d=db(patch,uid);await assertFails(deleteDoc(projectRef(d)));await assertFails(getDocs(collection(d,`${root}/audit_logs`)));await assertFails(getDocs(collection(d,`${root}/contractors`)));
 }
 await seed(ownerUid,{superAdmin:false,p_hvac:true,p_contractors:true});await assertFails(getDoc(projectRef(db(ownerClaims,ownerUid),'hvac')));
 await seed(ownerUid,{superAdmin:true,p_hvac:true,active:false});await assertFails(getDoc(projectRef(db(ownerClaims,ownerUid))));
});

test('automatic inventory expenses cannot be removed, edited or unlocked even by an owner',async()=>{
 const automatic={id:'stock-a',autoType:'inventory_consumption',valor:7.5};
 await env.withSecurityRulesDisabled(c=>updateDoc(projectRef(c.firestore()),{despesas:[automatic],inventoryExpenses:[automatic]}));
 await seed('owner',{superAdmin:true,p_hvac:true});
 await seed(ownerUid,{superAdmin:true,p_hvac:true,p_contractors:true});
 for(const d of [db(),db({firebase:{sign_in_provider:'password'},portal_bridge:false},'owner'),db(ownerClaims,ownerUid)]){
  await assertFails(updateDoc(projectRef(d),{despesas:[]}));
  await assertFails(updateDoc(projectRef(d),{despesas:[{...automatic,valor:999}]}));
  await assertFails(updateDoc(projectRef(d),{despesas:[automatic,automatic]}));
  await assertFails(updateDoc(projectRef(d),{inventoryExpenses:[],despesas:[]}));
  await assertSucceeds(updateDoc(projectRef(d),{despesas:[automatic,{id:'manual',valor:10}]}));
 }
 await assertFails(setDoc(projectRef(db(),'bad-inventory'),{...record,inventoryExpenses:[automatic]}));
 await assertFails(setDoc(doc(db(),`${root}/projects/smart/inventory_expense_events/forged`),{amountCents:1}));
});
