// Regra gerencial da MaxCompany. Não representa uma classificação tributária universal.
import { classifyFiscalOperation } from './fiscal-operation.js';
export const FINANCIAL_CFOPS = new Set([
  '5102',
  '6102',
  '7102',
  '1102',
  '2102',
  '3102',
  '1353',
  '2353',
  '3353',
  '5922',
  '6922',
  '2113',
  '6113',
  '5916',
  '2916',
  '1901',
  '2901',
  '5118',
  '6118',
  '5119',
  '6119',
  '5114',
  '6114',
  '1556',
  '2556'
]);

const cents = (value) => Math.round((Number(value) || 0) * 100);
const currency = (value) => value / 100;

export function financialDocument(row) {
  const fiscal = cents(row.value ?? row.amount);
  const items = Array.isArray(row.itemsDetail)
    ? row.itemsDetail
    : Array.isArray(row.items)
      ? row.items
      : [];
  if (!items.length)
    return {
      fiscalValue: currency(fiscal),
      financialValue: 0,
      nonFinancialValue: 0,
      pendingValue: currency(fiscal),
      status: 'pending',
      items: []
    };
  const classified = items.map((item) => {
    const cfop = String(item.cfop || '').trim();
    const value = Math.max(0, cents(item.value) - cents(item.discount));
    return {
      cfop,
      value: currency(value),
      effect: /^\d{4}$/.test(cfop)
        ? FINANCIAL_CFOPS.has(cfop)
          ? 'financial'
          : 'nonfinancial'
        : 'pending'
    };
  });
  const sum = (effect) =>
    classified
      .filter((item) => item.effect === effect)
      .reduce((total, item) => total + cents(item.value), 0);
  const financial = sum('financial');
  const nonFinancial = sum('nonfinancial');
  const pendingItems = sum('pending');
  const difference = fiscal - financial - nonFinancial - pendingItems;
  return {
    fiscalValue: currency(fiscal),
    financialValue: currency(financial),
    nonFinancialValue: currency(nonFinancial),
    pendingValue: currency(pendingItems + Math.max(0, difference)),
    discrepancyValue: currency(Math.min(0, difference)),
    status:
      pendingItems || difference
        ? 'partial'
        : financial && nonFinancial
          ? 'mixed'
          : financial
            ? 'financial'
            : 'nonfinancial',
    items: classified
  };
}

export function financialSaleValue(row) {
  if (
    row.canceled ||
    ['return', 'transfer', 'industrial-return', 'bonus', 'complementary', 'adjustment'].includes(
      row.fiscalOperation?.type
    )
  )
    return 0;
  const items = Array.isArray(row.itemsDetail)
    ? row.itemsDetail
    : Array.isArray(row.items)
      ? row.items
      : [];
  return currency(items.reduce((sum, item) => sum + cents(financialSaleItemValue(row, item)), 0));
}

export function financialSaleItemValue(row, item) {
  if (row.canceled || !FINANCIAL_CFOPS.has(String(item.cfop || ''))) return 0;
  const operation = classifyFiscalOperation({
    purpose: row.purpose,
    operation: row.operation,
    items: [item]
  });
  return operation.type === 'sale'
    ? currency(Math.max(0, cents(item.value) - cents(item.discount)))
    : 0;
}

export function financialPurchaseValue(row) {
  return !row.canceled &&
    row.full &&
    !['return', 'transfer', 'industrial-return', 'bonus', 'complementary', 'adjustment'].includes(
      row.fiscalOperation?.type
    )
    ? financialDocument(row).financialValue
    : 0;
}

// Só abatemos uma devolução cujo documento original foi confirmado e é integralmente financeiro.
// Para vendas mistas, o XML da devolução não prova qual parcela original foi retornada.
export function confirmedFinancialReturn(row) {
  return !row.canceled &&
    row.fiscalOperation?.type === 'return' &&
    row.saleReference?.financialStatus === 'financial'
    ? Number(row.value || 0)
    : 0;
}
