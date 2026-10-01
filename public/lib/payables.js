import { walletCompanyIds } from './wallet.js';
export const payableOrigin = (row) =>
  row.invoices?.length || /^\d{44}$/.test(row.accessKey || '') ? 'invoice' : 'unlinked';
export function payablesSelection(
  rows,
  { inicio, fim, company = '', query = '', today, status = '', sort = 'date', origin = '' } = {}
) {
  const normalize = (s) =>
    String(s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  const term = normalize(query).trim();
  const selected = rows
    .filter(
      (r) =>
        (!company || String(walletCompanyIds[r.companyCode]) === String(company)) &&
        (!origin || payableOrigin(r) === origin) &&
        r.dueOn &&
        r.dueOn >= inicio &&
        r.dueOn <= fim &&
        (!status ||
          (status === 'blocked'
            ? r.blocked
            : status === 'overdue'
              ? r.dueOn < today
              : r.dueOn >= today)) &&
        (!term ||
          normalize(
            `${r.documentNumber} ${r.supplier} ${r.supplierTaxId || ''} ${r.titleNumber} ${(r.invoices || []).map((n) => n.invoiceNumber).join(' ')}`
          ).includes(term))
    )
    .sort(
      (a, b) =>
        (sort === 'value'
          ? b.amount - a.amount
          : sort === 'supplier'
            ? String(a.supplier).localeCompare(String(b.supplier))
            : 0) ||
        a.dueOn.localeCompare(b.dueOn) ||
        a.titleNumber - b.titleNumber ||
        a.installment - b.installment
    );
  const totals = { forecast: 0, overdue: 0, blocked: 0 };
  const days = new Map();
  for (const r of selected) {
    const amount = Math.max(0, r.amount);
    totals[r.dueOn < today ? 'overdue' : 'forecast'] += amount;
    if (r.blocked) totals.blocked += amount;
    days.set(r.dueOn, (days.get(r.dueOn) || 0) + amount);
  }
  return {
    rows: selected,
    totals,
    days: [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value }))
  };
}
