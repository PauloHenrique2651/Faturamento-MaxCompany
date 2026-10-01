export const walletCompanyIds = { 1: 1, 3: 2, 5: 3, 6: 4 };
export function walletSelection(rows, { inicio, fim, company = '', query = '', today } = {}) {
  const term = String(query)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  const selected = rows
    .filter(
      (r) =>
        (!company || String(walletCompanyIds[r.companyCode]) === String(company)) &&
        r.dueOn &&
        r.dueOn >= inicio &&
        r.dueOn <= fim &&
        (!term ||
          `${r.invoiceNumber} ${r.customer} ${r.paymentTerms}`
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .includes(term))
    )
    .sort(
      (a, b) =>
        a.dueOn.localeCompare(b.dueOn) ||
        a.invoiceNumber - b.invoiceNumber ||
        a.installment - b.installment
    );
  const totals = selected.reduce(
    (t, r) => {
      t[r.anticipated ? 'anticipated' : r.dueOn < today ? 'overdue' : 'forecast'] += Math.max(
        0,
        r.amount
      );
      return t;
    },
    { forecast: 0, overdue: 0, anticipated: 0 }
  );
  const days = new Map();
  for (const r of selected)
    if (!r.anticipated && r.amount > 0) days.set(r.dueOn, (days.get(r.dueOn) || 0) + r.amount);
  return { rows: selected, totals, days: [...days].map(([date, value]) => ({ date, value })) };
}
