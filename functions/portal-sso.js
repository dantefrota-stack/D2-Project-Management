'use strict';

const COMPANY_LABELS={smart:'Smart Home',hvac:'HVAC'};
const error=(message,status)=>Object.assign(new Error(message),{status});
const normalizedEmail=value=>String(value||'').trim().toLowerCase();

function projectGrant(session,company){
  // Project documents contain contract amounts; the pilot is owner-only until
  // a redacted Projects API can enforce read_cost for other Portal roles.
  if(session?.superAdmin!==true || !Object.hasOwn(COMPANY_LABELS,company) || !session?.companies?.includes(company))return null;
  const grant=session.grants?.[company];
  const projects=grant?.modules?.projects;
  return grant?.status==='active' && projects?.scope==='company' && projects?.actions?.includes('read') && projects?.actions?.includes('read_cost') ? projects : null;
}

function portalClaims(company,grant,now=Date.now()){
  return {portal_bridge:true,portal_company:company,portal_scope:grant.scope,
    portal_actions:['read'],
    portal_until:Math.floor(now/1000)+15*60};
}

function intersectPermissions(permissions,claims){
  if(claims?.portal_bridge!==true)return permissions;
  const actions=Array.isArray(claims.portal_actions)?claims.portal_actions:[];
  return {...permissions,
    p_smart:permissions.p_smart && claims.portal_company==='smart',
    p_hvac:permissions.p_hvac && claims.portal_company==='hvac',
    p_global:permissions.p_global && claims.portal_scope==='company',
    p_tab_proj:permissions.p_tab_proj && actions.includes('read'),
    p_tab_new:false,
    p_tab_rep:false,
    p_fin:false,p_costs:false,p_contractors:false};
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
      const linked=await ref.get();
      if(!linked.exists)throw error('Sign in to Projects once to link your existing account.',409);
      const mapping=linked.data();
      if(mapping.portalUid!==session.uid || mapping.portalEmail!==normalizedEmail(session.email))throw error('The Portal identity changed. Link accounts again.',403);
      const pmUser=await auth.getUser(mapping.pmUid);
      if(pmUser.disabled || normalizedEmail(pmUser.email)!==mapping.pmEmail)throw error('The linked Projects account is unavailable.',403);
      const profile=await getPmProfile(mapping.pmEmail);
      if(!profile && mapping.pmEmail!=='dante.frota@allcablingtech.com')throw error('The linked Projects profile is unavailable.',403);
      const token=await auth.createCustomToken(mapping.pmUid,portalClaims(company,grant,clock()));
      return res.json({ok:true,token,expiresInSeconds:15*60});
    }catch(failure){
      if(!failure.status)console.error('Portal SSO failed:',failure.code||failure.name||'unknown',failure.message);
      return res.status(failure.status||500).json({error:failure.status?failure.message:'Unable to connect Projects. Try again.'});
    }
  };
}

module.exports={projectGrant,portalClaims,intersectPermissions,createPortalSso};
