const test=require('node:test'),assert=require('node:assert/strict');
const {OWNER_UID,OWNER_EMAIL,isPrimaryOwner}=require('./identity-policy');
test('owner privilege requires the existing UID and matching email',()=>{
 assert.equal(isPrimaryOwner({uid:OWNER_UID,email:OWNER_EMAIL}),true);
 assert.equal(isPrimaryOwner({uid:'replacement',email:OWNER_EMAIL}),false);
 assert.equal(isPrimaryOwner({uid:OWNER_UID,email:'other@example.test'}),false);
});
