import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

test('combined project totals wait for both company snapshots and retain the other company on updates',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const source=html.slice(html.indexOf('    function initData() {'),html.indexOf('    function renderTeamAdmin()'));
 const callbacks=[],renders=[],state={isSuperAdmin:false,userPerms:{smart:true,hvac:true,global:true,contractors:false},projects:[]};
 const context={state,auth:{currentUser:{email:'owner@example.test'}},db:{},appId:'test',console,
  collection:()=>({}),where:(field,op,company)=>({field,op,company}),query:(_ref,constraint)=>constraint,
  onSnapshot:(ref,next)=>{callbacks.push({company:ref.company,next});return()=>{};},
  sessionLifecycle:{listen:(subscribe,next,error)=>subscribe(next,error)},reconcileCompletedProjectClosure:async()=>{},
  window:{renderProjectSellerFilter(){},renderProjects(){},safeRenderReport(){renders.push(state.projects.map(p=>p.id));}}};
 runInNewContext(source+'\ninitData();',context);
 const snapshot=(id,empresa)=>({docs:[{id,data:()=>({empresa})}]});
 callbacks.find(c=>c.company==='Smart Home').next(snapshot('smart','Smart Home'));
 assert.equal(renders.length,0);assert.equal(state.projects.length,0);
 callbacks.find(c=>c.company==='HVAC').next(snapshot('hvac','HVAC'));
 assert.deepEqual(Array.from(state.projects,p=>p.id).sort(),['hvac','smart']);assert.equal(renders.length,1);
 callbacks.find(c=>c.company==='Smart Home').next(snapshot('smart-new','Smart Home'));
 assert.deepEqual(Array.from(state.projects,p=>p.id).sort(),['hvac','smart-new']);assert.equal(renders.length,2);
});
