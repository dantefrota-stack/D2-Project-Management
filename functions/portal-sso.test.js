const test=require('node:test');
const assert=require('node:assert/strict');
const {projectGrant,portalClaims,intersectPermissions,createPortalSso,assertPortalLease}=require('./portal-sso');

const session={uid:'portal-owner',email:'owner@example.com',superAdmin:true,companies:['smart'],grants:{smart:{status:'active',modules:{projects:{scope:'company',actions:['read','read_cost','create']}}}}};

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

function harness({portal=session,pmEmail='owner@example.com',signerFails=false,pmAccountMissing=false}={}){
  const docs=new Map();
  const db={
    collection(path){return {doc(id){const key=`${path}/${id}`;return {key,async get(){return {exists:docs.has(key),data:()=>docs.get(key)}}};}}},
    async runTransaction(work){return work({get:ref=>ref.get(),set(ref,value){docs.set(ref.key,value)}})}
  };
  const auth={async getUser(){return {uid:'pm-owner',email:pmEmail,disabled:false}},async getUserByEmail(){if(pmAccountMissing)throw Object.assign(Error('Missing'),{code:'auth/user-not-found'});return {uid:'pm-owner',email:pmEmail,disabled:false}},async createCustomToken(uid,claims){if(signerFails)throw Error('Signing unavailable');return JSON.stringify({uid,claims})}};
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
