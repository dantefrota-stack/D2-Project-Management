export const isInventoryExpense = row => ['inventory_consumption','inventory_reversal'].includes(row?.autoType);
export function inventoryCostReviewUrl(row) {
  if (row?.autoType !== 'inventory_consumption' || row.inventoryCostPending !== true || !['smart','hvac'].includes(row.inventoryCompany) || !/^[A-Za-z0-9_-]{1,128}$/.test(row.inventoryMovementId || '')) return '';
  return `https://d2-group-system.web.app/inventory/?company=${row.inventoryCompany}&expenseMovement=${row.inventoryMovementId}`;
}
export function formatInventoryUnitCost(cost, language = 'en') {
  const locale = {en:'en-US',pt:'pt-BR',es:'es-ES'}[language] || 'en-US';
  return new Intl.NumberFormat(locale, {style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:6}).format(Number(cost));
}
export function preserveInventoryExpenses(rows, protectedRows = []) {
  if (!Array.isArray(rows) || !Array.isArray(protectedRows)) throw Error('Invalid expense list');
  const ids = new Set(protectedRows.map(row => row.id));
  return [...rows.filter(row => !ids.has(row.id)), ...protectedRows];
}
