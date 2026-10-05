import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isInventoryExpense,preserveInventoryExpenses,formatInventoryUnitCost,inventoryCostReviewUrl} from '../inventory-expenses.mjs';
import {assertUnchangedProjectFields} from '../project-concurrency.mjs';

test('fractional per-foot prices retain six decimal places in all portal languages',()=>{
  assert.equal(formatInventoryUnitCost(0.333333,'en'),'$0.333333');
  assert.match(formatInventoryUnitCost(0.333333,'pt'),/0,333333/);
  assert.match(formatInventoryUnitCost(0.333333,'es'),/0,333333/);
  assert.equal(formatInventoryUnitCost(1.25,'en'),'$1.25');
});
test('manual edits and stale arrays retain the authoritative inventory cost and reversal',()=>{
  const charge={id:'stock-a',autoType:'inventory_consumption',valor:7.5};
  const reversal={id:'stock-b',autoType:'inventory_reversal',valor:-7.5};
  const manual={id:'manual',valor:15};
  assert.deepEqual(preserveInventoryExpenses([manual,{...charge,valor:999}],[charge,reversal]),[manual,charge,reversal]);
  assert.equal(isInventoryExpense(charge),true);assert.equal(isInventoryExpense(reversal),true);assert.equal(isInventoryExpense(manual),false);
});
test('a server stock cost arriving during a manual edit does not block it; another manual change does',()=>{
  const manual={id:'manual',valor:15},charge={id:'stock-a',autoType:'inventory_consumption',valor:7.5};
  assert.doesNotThrow(()=>assertUnchangedProjectFields({despesas:[manual,charge]},{despesas:[manual]},{despesas:[{...manual,valor:16}]}));
  assert.throws(()=>assertUnchangedProjectFields({despesas:[{...manual,valor:20},charge]},{despesas:[manual]},{despesas:[{...manual,valor:16}]}));
});

test('cost review links only allow pending consumption in supported companies and safe movement IDs',()=>{
  const row={autoType:'inventory_consumption',inventoryCompany:'hvac',inventoryMovementId:'a'.repeat(32),inventoryCostPending:true};
  assert.equal(new URL(inventoryCostReviewUrl(row)).searchParams.get('expenseMovement'),row.inventoryMovementId);
  for(const patch of [{autoType:'inventory_reversal'},{inventoryCostPending:false},{inventoryCompany:'other'},{inventoryMovementId:'bad&company=smart'}])assert.equal(inventoryCostReviewUrl({...row,...patch}),'');
});
