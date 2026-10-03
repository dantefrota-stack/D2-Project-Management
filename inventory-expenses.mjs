export const isInventoryExpense = row => ['inventory_consumption','inventory_reversal'].includes(row?.autoType);
export function preserveInventoryExpenses(rows, protectedRows = []) {
  if (!Array.isArray(rows) || !Array.isArray(protectedRows)) throw Error('Invalid expense list');
  const ids = new Set(protectedRows.map(row => row.id));
  return [...rows.filter(row => !ids.has(row.id)), ...protectedRows];
}
