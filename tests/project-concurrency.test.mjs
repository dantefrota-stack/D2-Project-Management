import test from 'node:test';
import assert from 'node:assert/strict';
import {assertUnchangedProjectFields} from '../project-concurrency.mjs';
test('financial edits reject a concurrently changed array instead of losing the other receipt',()=>{
 const original={recebimentos:[{valor:5}],despesas:[]};
 assert.throws(()=>assertUnchangedProjectFields({...original,recebimentos:[{valor:5},{valor:8}]},original,{recebimentos:[{valor:6}]}));
 assert.doesNotThrow(()=>assertUnchangedProjectFields({...original,despesas:[{valor:8}]},original,{recebimentos:[{valor:6}]}));
});
test('comparison accepts equivalent map ordering but detects removals and missing projects',()=>{
 assert.doesNotThrow(()=>assertUnchangedProjectFields({a:{x:1,y:2}},{a:{y:2,x:1}},{a:{x:2}}));
 assert.throws(()=>assertUnchangedProjectFields({},{a:1},{a:2}));
 assert.throws(()=>assertUnchangedProjectFields(null,{a:1},{a:2}));
});
