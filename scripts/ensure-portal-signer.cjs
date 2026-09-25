'use strict';

// Run with FIREBASE_TOOLS_DIR pointing to the installed firebase-tools package.
// Add --apply only after reviewing the current policy summary.
const cliDir=process.env.FIREBASE_TOOLS_DIR;
if(!cliDir)throw new Error('FIREBASE_TOOLS_DIR is required.');
const auth=require(`${cliDir}/lib/auth.js`);
const email='254630664761-compute@developer.gserviceaccount.com';
const resource=`projects/d2-project-management/serviceAccounts/${email}`;
const principal=`serviceAccount:${email}`;
const role='roles/iam.serviceAccountTokenCreator';
const url=`https://iam.googleapis.com/v1/${resource}`;

async function main(){
  const account=auth.getAllAccounts().find(item=>item.user.email==='dantefrota@gmail.com');
  if(!account)throw new Error('Authorized Firebase account is unavailable.');
  const credentials=await auth.getAccessToken(account.tokens.refresh_token,['https://www.googleapis.com/auth/cloud-platform']);
  async function request(suffix,body){
    const response=await fetch(`${url}:${suffix}`,{method:'POST',headers:{Authorization:`Bearer ${credentials.access_token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    const result=await response.json();
    if(!response.ok)throw new Error(`IAM ${suffix} failed (${response.status}): ${result.error?.message||'Unknown error'}`);
    return result;
  }
  const policy=await request('getIamPolicy');
  const bindings=policy.bindings||[];
  const current=bindings.find(binding=>binding.role===role && !binding.condition);
  const present=!!current?.members?.includes(principal);
  console.log(JSON.stringify({resource,version:policy.version||1,bindingCount:bindings.length,hasScopedSignerGrant:present,apply:process.argv.includes('--apply')}));
  if(!process.argv.includes('--apply')||present)return;
  if(current)current.members.push(principal);
  else bindings.push({role,members:[principal]});
  const updated=await request('setIamPolicy',{policy:{...policy,bindings}});
  const verified=updated.bindings?.some(binding=>binding.role===role && !binding.condition && binding.members?.includes(principal));
  if(!verified)throw new Error('IAM response did not confirm signer grant.');
  console.log('Scoped signer grant confirmed.');
}

main().catch(error=>{console.error(error.message);process.exitCode=1});
