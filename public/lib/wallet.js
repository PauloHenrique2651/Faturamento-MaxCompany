export const walletCompanyIds = { 1: 1, 3: 2, 5: 3, 6: 4 };
export function walletSelection(
  rows,
  { inicio, fim, company = '', query = '', today, status = '', sort = 'date' } = {}
) {
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
        (!status ||
          (status === 'anticipated'
            ? r.anticipated
            : status === 'overdue'
              ? !r.anticipated && r.dueOn < today
              : !r.anticipated && r.dueOn >= today)) &&
        (!term ||
          `${r.invoiceNumber} ${r.customer} ${r.paymentTerms}`
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .includes(term))
    )
    .sort(
      (a, b) =>
        (sort === 'value'
          ? b.amount - a.amount
          : sort === 'customer'
            ? String(a.customer).localeCompare(String(b.customer))
            : 0) ||
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
  return {
    rows: selected,
    totals,
    days: [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value }))
  };
}
