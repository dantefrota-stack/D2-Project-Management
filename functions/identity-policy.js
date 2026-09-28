'use strict';
// Existing administrator identity verified against Authentication during audit.
// An account later created with the same email must not inherit this privilege.
const OWNER_UID='IYz2jpQojuRsClIHpSaSIFziAQG3';
const OWNER_EMAIL='dante.frota@allcablingtech.com';
function isPrimaryOwner(record){return (record?.uid||record?.localId)===OWNER_UID && String(record?.email||'').toLowerCase()===OWNER_EMAIL;}
module.exports={OWNER_UID,OWNER_EMAIL,isPrimaryOwner};
