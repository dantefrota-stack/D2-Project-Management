'use strict';

const COMPANY_LABELS={smart:'Smart Home',hvac:'HVAC'};
const error=(message,status)=>Object.assign(new Error(message),{status});
const normalizedEmail=value=>String(value||'').trim().toLowerCase();
const {isPrimaryOwner}=require('./identity-policy');
const OWNER_ACTIONS=['read','read_cost','create','edit','assign','export'];

function assertPortalLease(claims,now=Date.now()){
  const custom=claims?.firebase?.sign_in_provider==='custom';
  if(!custom && claims?.portal_bridge!==true)return;
  if(!custom || claims.portal_bridge!==true || !Object.hasOwn(COMPANY_LABELS,claims.portal_company)
    || !Number.isSafeInteger(claims.portal_until) || claims.portal_until<=Math.floor(now/1000)
    || claims.portal_scope!=='company' || !Array.isArray(claims.portal_actions)
    || !claims.portal_actions.includes('read') || !claims.portal_actions.includes('read_cost')
    || (claims.portal_report_all===true&&claims.portal_actions.some(action=>!['read','read_cost','export'].includes(action))))
    throw error('Portal connection expired. Reconnect from the Portal.',401);
}

function projectGrant(session,company){
  // Firestore returns whole project documents, including financial fields.
  // Never issue a bridge token without the explicit cost grant.
  if(!Object.hasOwn(COMPANY_LABELS,company) || !session?.companies?.includes(company) || (session.superAdmin!==true && session.emailVerified!==true))return null;
  const grant=session.grants?.[company];
  const projects=grant?.modules?.projects;
  return grant?.status==='active' && projects?.scope==='company' && projects?.actions?.includes('read') && projects?.actions?.includes('read_cost') ? projects : null;
}

function portalClaims(company,grant,now=Date.now()){
  return {portal_bridge:true,portal_company:company,portal_scope:grant.scope,
    portal_actions:Array.isArray(grant.actions)?grant.actions.filter(action=>['read','create','edit','assign','read_cost','export'].includes(action)):[],
    portal_until:Math.floor(now/1000)+5*60};
}
function reportClaims(session,company,pmUser,now=Date.now()){
  if(session?.superAdmin!==true||!isPrimaryOwner(pmUser)||!['smart','hvac'].every(value=>projectGrant(session,value)))throw error('Combined reports require the verified super administrator and both company grants.',403);
  return {...portalClaims(company,projectGrant(session,company),now),portal_report_all:true,portal_actions:['read','read_cost','export']};
}

function ownerClaims(session,company,pmUser,now=Date.now()){
  const claims=portalClaims(company,projectGrant(session,company),now);
  // Preserve the existing owner's powers only when both systems independently
  // authorize the same protected identity and both live company grants are full.
  if(session?.superAdmin===true && isPrimaryOwner(pmUser)
    && normalizedEmail(session.email)===normalizedEmail(pmUser.email)
    && ['smart','hvac'].every(value=>{
      const grant=projectGrant(session,value);
      return grant && OWNER_ACTIONS.every(action=>grant.actions.includes(action));
    }))claims.portal_owner=true;
  return claims;
}

function isOwnerPortalSession(claims,verifiedOwner){
  return verifiedOwner===true && claims?.portal_bridge===true && claims.portal_owner===true
    && claims.portal_report_all!==true && claims.portal_scope==='company'
    && Object.hasOwn(COMPANY_LABELS,claims.portal_company)
    && Array.isArray(claims.portal_actions) && OWNER_ACTIONS.every(action=>claims.portal_actions.includes(action));
}

function intersectPermissions(permissions,claims,verifiedOwner=false){
  if(claims?.portal_bridge!==true)return permissions;
  if(isOwnerPortalSession(claims,verifiedOwner))return {...permissions,p_cost_edit:permissions.p_costs===true};
  const actions=Array.isArray(claims.portal_actions)?claims.portal_actions:[];
  const reportAll=claims.portal_report_all===true&&verifiedOwner;
  return {...permissions,
    p_smart:permissions.p_smart && (reportAll||claims.portal_company==='smart'),
    p_hvac:permissions.p_hvac && (reportAll||claims.portal_company==='hvac'),
    p_global:permissions.p_global && claims.portal_scope==='company',
    p_tab_proj:permissions.p_tab_proj && actions.includes('read'),
    p_tab_new:permissions.p_tab_new && actions.includes('create'),
    p_tab_rep:permissions.p_tab_rep && actions.includes('read'),
    p_fin:permissions.p_fin && actions.includes('edit') && actions.includes('read_cost'),
    p_costs:permissions.p_costs && actions.includes('read_cost'),
    p_cost_edit:permissions.p_costs && actions.includes('edit') && actions.includes('read_cost'),
    p_contractors:false};
}

function createPortalSso({auth,db,getPortalSession,getPmContext,getPmProfile,clock=Date.now}){
  const links=db.collection('artifacts/d2-Project-Management/public/data/portal_links');
  const reverse=db.collection('artifacts/d2-Project-Management/public/data/portal_links_by_pm');
  return async(req,res)=>{
    res.set('Cache-Control','private, no-store');
    try{
      if(req.method!=='POST')throw error('Method not allowed.',405);
      const {action,portalToken,company,scope}=req.body||{};
      if(scope!==undefined&&scope!=='all')throw error('Invalid report scope.',400);
      if(scope==='all'&&action!=='exchange')throw error('Report mode cannot pair accounts.',400);
      if(!['pair','exchange'].includes(action) || !Object.hasOwn(COMPANY_LABELS,company) || typeof portalToken!=='string' || portalToken.length>8000 || portalToken.length<100)throw error('Invalid handoff request.',400);
      const session=await getPortalSession(portalToken);
      const grant=projectGrant(session,company);
      if(!session?.uid || !session?.email || !grant)throw error('Projects access is not authorized for this company.',403);
      if(scope==='all'&&(session.superAdmin!==true||!['smart','hvac'].every(value=>projectGrant(session,value))))throw error('Combined reports require both company grants.',403);
      const ref=links.doc(session.uid);
      if(action==='pair'){
        const context=await getPmContext(req);
        if(normalizedEmail(context.email)!==normalizedEmail(session.email))throw error('The Portal and Projects account emails must match.',403);
        if(context.decoded.portal_bridge===true)throw error('Sign in directly to Projects to link your account.',403);
        if(context.access?.p_tab_proj!==true || context.access?.[company==='smart'?'p_smart':'p_hvac']!==true)throw error('This Projects account is not authorized for the selected company.',403);
        // Verify that the destination can sign a bridge token before persisting the link.
        await auth.createCustomToken(context.decoded.uid,portalClaims(company,grant,clock()));
        const reverseRef=reverse.doc(context.decoded.uid);
        await db.runTransaction(async tx=>{
          const [forward,back]=await Promise.all([tx.get(ref),tx.get(reverseRef)]);
          if(forward.exists && forward.data().pmUid!==context.decoded.uid)throw error('This Portal account is linked to another Projects account.',409);
          if(back.exists && back.data().portalUid!==session.uid)throw error('This Projects account is linked to another Portal account.',409);
          const record={portalUid:session.uid,portalEmail:normalizedEmail(session.email),pmUid:context.decoded.uid,pmEmail:normalizedEmail(context.email),updatedAt:new Date(clock()).toISOString()};
          tx.set(ref,record);tx.set(reverseRef,{portalUid:session.uid});
        });
        return res.json({ok:true,linked:true});
      }
      let linked=await ref.get();
      if(!linked.exists){
        if(session.emailVerified!==true)throw error('Confirm your Portal email before linking Projects.',403);
        let candidate;
        try{candidate=await auth.getUserByEmail(session.email);}catch(failure){if(failure.code==='auth/user-not-found')throw error('The Projects account is not available.',409);throw failure;}
        if(candidate.disabled || normalizedEmail(candidate.email)!==normalizedEmail(session.email))throw error('The Projects account is unavailable.',403);
        const candidateProfile=await getPmProfile(session.email);
        if(!candidateProfile)throw error('The Projects profile is unavailable.',403);
        const profile=candidateProfile.data();
        if(profile.p_tab_proj===false || profile[company==='smart'?'p_smart':'p_hvac']===false || (profile.p_costs!==true && profile.viewCosts!==true))throw error('The Projects profile does not allow company-wide financial access.',403);
        const reverseRef=reverse.doc(candidate.uid);
        await db.runTransaction(async tx=>{
          const [forward,back]=await Promise.all([tx.get(ref),tx.get(reverseRef)]);
          if(forward.exists && forward.data().pmUid!==candidate.uid)throw error('This Portal account is linked to another Projects account.',409);
          if(back.exists && back.data().portalUid!==session.uid)throw error('This Projects account is linked to another Portal account.',409);
          if(!forward.exists){
            tx.set(ref,{portalUid:session.uid,portalEmail:normalizedEmail(session.email),pmUid:candidate.uid,pmEmail:normalizedEmail(candidate.email),updatedAt:new Date(clock()).toISOString()});
            tx.set(reverseRef,{portalUid:session.uid});
          }
        });
        linked=await ref.get();
      }
      const mapping=linked.data();
      if(mapping.portalUid!==session.uid || mapping.portalEmail!==normalizedEmail(session.email))throw error('The Portal identity changed. Link accounts again.',403);
      const pmUser=await auth.getUser(mapping.pmUid);
      if(pmUser.disabled || normalizedEmail(pmUser.email)!==mapping.pmEmail)throw error('The linked Projects account is unavailable.',403);
      const profile=await getPmProfile(mapping.pmEmail);
      if(!profile && mapping.pmEmail!=='dante.frota@allcablingtech.com')throw error('The linked Projects profile is unavailable.',403);
      if(profile && mapping.pmEmail!=='dante.frota@allcablingtech.com'){
        const access=profile.data();
        if(access.p_tab_proj===false || access[company==='smart'?'p_smart':'p_hvac']===false || (access.p_costs!==true && access.viewCosts!==true))throw error('The linked Projects profile no longer allows company-wide financial access.',403);
      }
      const claims=scope==='all'?reportClaims(session,company,pmUser,clock()):ownerClaims(session,company,pmUser,clock());
      const token=await auth.createCustomToken(mapping.pmUid,claims);
      return res.json({ok:true,token,expiresInSeconds:5*60});
    }catch(failure){
      if(!failure.status)console.error('Portal SSO failed:',failure.code||failure.name||'unknown',failure.message);
      return res.status(failure.status||500).json({error:failure.status?failure.message:'Unable to connect Projects. Try again.'});
    }
  };
}

module.exports={projectGrant,portalClaims,ownerClaims,isOwnerPortalSession,reportClaims,intersectPermissions,createPortalSso,assertPortalLease};
