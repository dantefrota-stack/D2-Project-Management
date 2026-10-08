import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {spanishProjectLabels,spanishProjectPhrases,projectLocale} from '../project-locale.mjs';

test('every registered English UI label has a Spanish value after locale installation',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const script=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
 const ctx=vm.createContext({window:{},state:{lang:'es'},spanishProjectLabels});
 vm.runInContext(script.slice(script.indexOf('const translations ='),script.indexOf('const loc ='))+';globalThis.labels=translations;',ctx);
 const missing=Object.keys(ctx.labels.en).filter(key=>!ctx.labels.es[key]);
 assert.deepEqual(missing,[]);
 assert.equal(ctx.window.t('no_active_works'),'No se encontraron proyectos activos.');
});

test('Spanish covers the project, receipt, payout and report views; explicit copy takes priority',()=>{
 for(const en of ['Project Overview','Client Receipts','Seller Payments','Commission unpaid','Gross contract value','Outstanding at period end','Actual completion date','All sellers','No expenses recorded yet.']){
  assert.notEqual(projectLocale('es','Português',en),en);
  assert.equal(projectLocale('en','Português',en),en);
  assert.equal(projectLocale('pt','Português',en),'Português');
 }
 assert.equal(projectLocale('es','PT','EN','Español explícito'),'Español explícito');
 assert.equal(projectLocale('es','PT','Unknown user data'),'Unknown user data');
 assert.equal(projectLocale('es','pt-BR','en-US'),'es-ES');
 assert.ok(Object.keys(spanishProjectPhrases).length>200);
});
