import {isInventoryExpense} from './inventory-expenses.mjs';
function stable(value) {
  if(Array.isArray(value))return value.map(stable);
  if(value && typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
  return value;
}
export function assertUnchangedProjectFields(current,baseline,patch) {
  if(!current||!baseline)throw Error('Project is unavailable. Reload before saving.');
  for(const key of Object.keys(patch)){
    if(key==='updatedAt')continue;
    const currentValue=key==='despesas'&&Array.isArray(current[key])?current[key].filter(row=>!isInventoryExpense(row)):current[key];
    const baselineValue=key==='despesas'&&Array.isArray(baseline[key])?baseline[key].filter(row=>!isInventoryExpense(row)):baseline[key];
    if(JSON.stringify(stable(currentValue))!==JSON.stringify(stable(baselineValue)))
      throw Error('This project changed while you were editing. Reload it before saving to preserve the other update.');
  }
}
