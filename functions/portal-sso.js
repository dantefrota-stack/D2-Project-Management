'use strict';

const COMPANY_LABELS={smart:'Smart Home',hvac:'HVAC'};
const error=(message,status)=>Object.assign(new Error(message),{status});
const normalizedEmail=value=>String(value||'').trim().toLowerCase();

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

function intersectPermissions(permissions,claims){
  if(claims?.portal_bridge!==true)return permissions;
  const actions=Array.isArray(claims.portal_actions)?claims.portal_actions:[];
  return {...permissions,
    p_smart:permissions.p_smart && claims.portal_company==='smart',
    p_hvac:permissions.p_hvac && claims.portal_company==='hvac',
    p_global:permissions.p_global && claims.portal_scope==='company',
    p_tab_proj:permissions.p_tab_proj && actions.includes('read'),
    p_tab_new:permissions.p_tab_new && actions.includes('create'),
    p_tab_rep:permissions.p_tab_rep && actions.includes('read'),
    p_fin:permissions.p_fin && actions.includes('edit') && actions.includes('read_cost'),
    p_costs:permissions.p_costs && actions.includes('read_cost'),
    p_contractors:false};
}

function createPortalSso({auth,db,getPortalSession,getPmContext,getPmProfile,clock=Date.now}){
  const links=db.collection('artifacts/d2-Project-Management/public/data/portal_links');
  const reverse=db.collection('artifacts/d2-Project-Management/public/data/portal_links_by_pm');
  return async(req,res)=>{
    res.set('Cache-Control','private, no-store');
    try{
      if(req.method!=='POST')throw error('Method not allowed.',405);
      const {action,portalToken,company}=req.body||{};
      if(!['pair','exchange'].includes(action) || !Object.hasOwn(COMPANY_LABELS,company) || typeof portalToken!=='string' || portalToken.length>8000 || portalToken.length<100)throw error('Invalid handoff request.',400);
      const session=await getPortalSession(portalToken);
      const grant=projectGrant(session,company);
      if(!session?.uid || !session?.email || !grant)throw error('Projects access is not authorized for this company.',403);
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
      const token=await auth.createCustomToken(mapping.pmUid,portalClaims(company,grant,clock()));
      return res.json({ok:true,token,expiresInSeconds:5*60});
    }catch(failure){
      if(!failure.status)console.error('Portal SSO failed:',failure.code||failure.name||'unknown',failure.message);
      return res.status(failure.status||500).json({error:failure.status?failure.message:'Unable to connect Projects. Try again.'});
    }
  };
}

module.exports={projectGrant,portalClaims,intersectPermissions,createPortalSso};
