const test=require('node:test');
const assert=require('node:assert/strict');
const {projectGrant,portalClaims,ownerClaims,isOwnerPortalSession,reportClaims,intersectPermissions,createPortalSso,assertPortalLease}=require('./portal-sso');
const {OWNER_UID,OWNER_EMAIL}=require('./identity-policy');

const session={uid:'portal-owner',email:'owner@example.com',superAdmin:true,companies:['smart'],grants:{smart:{status:'active',modules:{projects:{scope:'company',actions:['read','read_cost','create']}}}}};
const fullGrant={status:'active',modules:{projects:{scope:'company',actions:['read','read_cost','create','edit','assign','export']}}};
const ownerSession={...session,email:OWNER_EMAIL,companies:['smart','hvac'],grants:{smart:fullGrant,hvac:fullGrant}};

test('full Portal administration preserves only the existing protected owner with two full live grants',()=>{
  const owner={uid:OWNER_UID,email:OWNER_EMAIL};
  const claims=ownerClaims(ownerSession,'smart',owner,1000000);
  assert.equal(claims.portal_owner,true);
  assert.equal(claims.portal_until,1300);
  assert.equal(isOwnerPortalSession(claims,true),true);
  const source={p_smart:true,p_hvac:true,p_contractors:true,p_costs:true,p_fin:true,p_tab_new:true};
  assert.deepEqual(intersectPermissions(source,claims,true),{...source,p_cost_edit:true});
  assert.equal(isOwnerPortalSession(claims,false),false);
  for(const candidate of [{...owner,uid:'replacement'},{...owner,email:'other@example.test'}])assert.equal(ownerClaims(ownerSession,'smart',candidate).portal_owner,undefined);
  for(const portal of [{...ownerSession,superAdmin:false,emailVerified:true},{...ownerSession,email:'other@example.test'},
    {...ownerSession,companies:['smart']},{...ownerSession,grants:{smart:fullGrant,hvac:{...fullGrant,status:'suspended'}}},
    {...ownerSession,grants:{smart:fullGrant,hvac:session.grants.smart}}])assert.equal(ownerClaims(portal,'smart',owner).portal_owner,undefined);
  const report={...reportClaims(ownerSession,'smart',owner,1000000),portal_owner:true};
  assert.equal(isOwnerPortalSession(report,true),false);
  assert.equal(intersectPermissions(source,report,true).p_contractors,false);
  assert.throws(()=>assertPortalLease({...claims,portal_until:1,firebase:{sign_in_provider:'custom'}},1000000));
});

test('consolidated reports require the protected source owner and two live grants, with no write actions',()=>{
  const both={...session,companies:['smart','hvac'],grants:{smart:session.grants.smart,hvac:session.grants.smart}};
  const owner={uid:OWNER_UID,email:OWNER_EMAIL};
  const claims=reportClaims(both,'smart',owner,1000000);
  assert.equal(claims.portal_report_all,true);
  assert.deepEqual(claims.portal_actions,['read','read_cost','export']);
  assert.equal(claims.portal_until,1300);
  assert.throws(()=>reportClaims({...both,superAdmin:false},'smart',owner));
  assert.throws(()=>reportClaims(session,'smart',owner));
  assert.throws(()=>reportClaims(both,'smart',{...owner,uid:'replacement'}));
  const effective=intersectPermissions({p_smart:true,p_hvac:true,p_global:true,p_tab_proj:true,p_tab_new:true,p_tab_rep:true,p_fin:true,p_costs:true,p_contractors:true},claims,true);
  assert.equal(effective.p_smart,true);assert.equal(effective.p_hvac,true);assert.equal(effective.p_tab_rep,true);
  for(const key of ['p_tab_new','p_fin','p_cost_edit','p_contractors'])assert.equal(effective[key],false);
  assert.equal(intersectPermissions(effective,claims,false).p_hvac,false);
  assert.throws(()=>assertPortalLease({...claims,portal_actions:[...claims.portal_actions,'edit'],firebase:{sign_in_provider:'custom'}},1000000));
});

test('a company link requires a company-wide project grant',()=>{
  assert.deepEqual(projectGrant(session,'smart'),session.grants.smart.modules.projects);
  assert.equal(projectGrant(session,'hvac'),null);
  assert.equal(projectGrant({...session,superAdmin:false},'smart'),null);
  assert.deepEqual(projectGrant({...session,superAdmin:false,emailVerified:true},'smart'),session.grants.smart.modules.projects);
  assert.equal(projectGrant({...session,grants:{smart:{status:'active',modules:{projects:{scope:'company',actions:['read']}}}}},'smart'),null);
  assert.equal(projectGrant({...session,grants:{smart:{status:'active',modules:{projects:{scope:'own',actions:['read']}}}}},'smart'),null);
});

test('Portal claims expire and Project permissions are narrowed to one company',()=>{
  const claims=portalClaims('smart',projectGrant(session,'smart'),1000000);
  assert.equal(claims.portal_until,1300);
  const current={p_smart:true,p_hvac:true,p_global:true,p_tab_proj:true,p_tab_new:true,p_tab_rep:true,p_fin:true,p_costs:true,p_contractors:true};
  const effective=intersectPermissions(current,claims);
  assert.equal(effective.p_smart,true);
  assert.equal(effective.p_hvac,false);
  assert.equal(effective.p_tab_new,true);
  assert.equal(effective.p_fin,false);
  assert.equal(effective.p_costs,true);
  assert.equal(effective.p_cost_edit,false);
  assert.equal(effective.p_contractors,false);
  assert.equal(intersectPermissions(current,{}),current);
});

test('custom sessions fail closed if bridge claims disappear or become invalid',()=>{
  const claims={...portalClaims('smart',projectGrant(session,'smart'),1000000),firebase:{sign_in_provider:'custom'}};
  assert.doesNotThrow(()=>assertPortalLease(claims,1000000));
  assert.doesNotThrow(()=>assertPortalLease({firebase:{sign_in_provider:'password'}},1000000));
  for(const patch of [{portal_bridge:false},{portal_until:1},{portal_until:'1300'},{portal_company:'other'},{portal_actions:['read']},{portal_scope:'own'},{firebase:{sign_in_provider:'password'}}])
    assert.throws(()=>assertPortalLease({...claims,...patch},1000000));
});

function harness({portal=session,pmEmail='owner@example.com',pmUid='pm-owner',signerFails=false,pmAccountMissing=false}={}){
  const docs=new Map();
  const db={
    collection(path){return {doc(id){const key=`${path}/${id}`;return {key,async get(){return {exists:docs.has(key),data:()=>docs.get(key)}}};}}},
    async runTransaction(work){return work({get:ref=>ref.get(),set(ref,value){docs.set(ref.key,value)}})}
  };
  const auth={async getUser(){return {uid:pmUid,email:pmEmail,disabled:false}},async getUserByEmail(){if(pmAccountMissing)throw Object.assign(Error('Missing'),{code:'auth/user-not-found'});return {uid:pmUid,email:pmEmail,disabled:false}},async createCustomToken(uid,claims){if(signerFails)throw Error('Signing unavailable');return JSON.stringify({uid,claims})}};
  const getPmContext=async()=>({email:pmEmail,decoded:{uid:'pm-owner'},access:{p_tab_proj:true,p_smart:true,p_hvac:false}});
  const getPmProfile=async()=>({exists:true,data:()=>({p_tab_proj:true,p_smart:true,p_hvac:false,p_costs:true})});
  const handler=createPortalSso({auth,db,getPortalSession:async()=>portal,getPmContext,getPmProfile,clock:()=>1000000});
  async function call(action,company='smart'){
    const result={statusCode:200,headers:{},body:null};
    const res={set(k,v){result.headers[k]=v;return this},status(value){result.statusCode=value;return this},json(value){result.body=value;return this}};
    await handler({method:'POST',body:{action,company,portalToken:'x'.repeat(101)}},res);
    return result;
  }
  return {call,docs};
}

test('a Portal identity without a Projects account cannot obtain a token',async()=>{
  const h=harness({portal:{...session,emailVerified:true},pmAccountMissing:true});
  assert.equal((await h.call('exchange')).statusCode,409);
  assert.equal(h.docs.size,0);
});

test('pairing requires control of matching Portal and Projects accounts',async()=>{
  const h=harness({pmEmail:'other@example.com'});
  assert.equal((await h.call('pair')).statusCode,403);
  assert.equal(h.docs.size,0);
});

test('a link is not saved when Projects cannot sign bridge tokens',async()=>{
  const h=harness({signerFails:true});
  assert.equal((await h.call('pair')).statusCode,500);
  assert.equal(h.docs.size,0);
});

test('a paired identity receives a company-scoped short-lived token',async()=>{
  const h=harness();
  assert.equal((await h.call('pair')).statusCode,200);
  const result=await h.call('exchange');
  assert.equal(result.statusCode,200);
  assert.deepEqual(JSON.parse(result.body.token),{uid:'pm-owner',claims:portalClaims('smart',projectGrant(session,'smart'),1000000)});
  assert.equal((await h.call('exchange','hvac')).statusCode,403);
});

test('exchange signs owner administration only for the protected destination account',async()=>{
  const h=harness({portal:{...ownerSession,emailVerified:true},pmEmail:OWNER_EMAIL,pmUid:OWNER_UID});
  const result=await h.call('exchange');
  assert.equal(result.statusCode,200);
  assert.equal(JSON.parse(result.body.token).claims.portal_owner,true);
  const recreated=harness({portal:{...ownerSession,emailVerified:true},pmEmail:OWNER_EMAIL,pmUid:'recreated-account'});
  assert.equal(JSON.parse((await recreated.call('exchange')).body.token).claims.portal_owner,undefined);
});

test('a verified manager with an existing authorized Projects account is linked without a second password',async()=>{
  const manager={...session,superAdmin:false,emailVerified:true};
  const h=harness({portal:manager});
  const result=await h.call('exchange');
  assert.equal(result.statusCode,200);
  assert.equal(h.docs.size,2);
  assert.deepEqual(JSON.parse(result.body.token),{uid:'pm-owner',claims:portalClaims('smart',projectGrant(manager,'smart'),1000000)});
});

test('an unverified Portal account cannot link to Projects by matching email',async()=>{
  const h=harness({portal:{...session,superAdmin:false,emailVerified:false}});
  assert.equal((await h.call('exchange')).statusCode,403);
  assert.equal(h.docs.size,0);
});
