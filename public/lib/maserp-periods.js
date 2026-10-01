// Relatórios e fatos publicados pelo coletor. Nunca usa uma base fora do período.
const aggregate = (rows, keys) => {
  const groups = new Map();
  for (const row of rows) {
    const id = keys.map((k) => row[k]).join('|');
    const group = groups.get(id) || Object.fromEntries(keys.map((k) => [k, row[k]]));
    for (const [key, value] of Object.entries(row))
      if (!keys.includes(key) && typeof value === 'number') group[key] = (group[key] || 0) + value;
      else if (key === 'internal' && group[key] === undefined) group[key] = value;
    groups.set(id, group);
  }
  return [...groups.values()];
};
export function billingAtDate(row, end) {
  const last = (row.timeline || row.billingTimeline || []).filter((t) => t.date <= end).at(-1);
  return (
    last || {
      billed: 0,
      cohortBilled: 0,
      pending: Number(row.sales ?? row.total ?? 0),
      pendingOrders: Number(row.sales ?? row.total ?? 0) > 0.005 ? 1 : 0,
      billedCostCoverage: 0,
      billedCost: 0,
      billedWithRotation: 0,
      billedWithoutRotation: 0
    }
  );
}
export function orderAtDate(order, end) {
  if (!Array.isArray(order.billingTimeline)) return order;
  const billed = billingAtDate(order, end);
  return {
    ...order,
    billed: billed.billed,
    pending: billed.pending,
    invoices: (order.invoices || []).filter((n) => n.date <= end)
  };
}
export function deriveMaserpReport(report, period) {
  if (
    !report?.available ||
    !report.periodFacts ||
    period.inicio < report.startDate ||
    period.fim > report.endDate
  )
    return null;
  const within = (date) => date >= period.inicio && date <= period.fim;
  const facts = report.periodFacts;
  const select = (rows, keys) =>
    aggregate(
      (rows || []).filter((r) => within(r.date)).map(({ date, ...r }) => r),
      keys
    );
  const commercial = aggregate(
    (facts.commercial || [])
      .filter((r) => within(r.date))
      .map(({ date, timeline, ...r }) => {
        const { date: billedDate, ...billed } = billingAtDate({ ...r, timeline }, period.fim);
        return { ...r, ...billed };
      }),
    ['companyCode']
  );
  const { periodFacts, orderCatalog, orders, ...base } = report;
  return {
    ...base,
    startDate: period.inicio,
    endDate: period.fim,
    companies: select(facts.companies, ['companyCode']),
    commercial,
    profitability: select(facts.profitability, ['companyCode']),
    sellerProfitability: select(facts.sellerProfitability, [
      'companyCode',
      'sellerCode',
      'sellerName'
    ]),
    incomingFreights: (report.incomingFreights || []).filter((r) =>
      within(
        r.entryDate instanceof Date
          ? r.entryDate.toISOString().slice(0, 10)
          : String(r.entryDate).slice(0, 10)
      )
    ),
    ...(orders
      ? { orders: orders.filter((r) => within(r.date)).map((r) => orderAtDate(r, period.fim)) }
      : {})
  };
}
export function selectMaserpReport(sync, period) {
  const reports = [sync?.maserpSales, ...Object.values(sync?.maserpReports || {})];
  const exact = reports.find(
    (r) => r?.available && r.startDate === period?.inicio && r.endDate === period?.fim
  );
  const candidates = reports
    .filter(
      (r) =>
        r?.available && r.periodFacts && r.startDate <= period?.inicio && r.endDate >= period?.fim
    )
    .sort((a, b) => String(b.checkedAt).localeCompare(String(a.checkedAt)));
  if (exact && (!candidates.length || String(exact.checkedAt) >= String(candidates[0].checkedAt)))
    return exact;
  return candidates.length ? deriveMaserpReport(candidates[0], period) : exact || null;
}
export function monthlyReportPeriods(end) {
  const first = end.slice(0, 7) + '-01';
  const previousEnd = new Date(Date.parse(first + 'T12:00:00Z') - 86400000)
    .toISOString()
    .slice(0, 10);
  return [
    [first, end],
    [previousEnd.slice(0, 7) + '-01', previousEnd]
  ];
}
export function commercialBilled(row) {
  return Number(row.cohortBilled ?? row.billed ?? 0);
}

// Envia apenas o recorte necessário à tela; o histórico integral continua no coletor.
export function summarySynchronization(sync, period) {
  const selected = selectMaserpReport(sync, period);
  const { maserpSales, maserpReports, ...status } = sync || {};
  if (!selected) return { ...status, maserpSales: null, maserpReports: {} };
  const { periodFacts, orders, orderCatalog, ...report } = selected;
  return { ...status, maserpSales: report, maserpReports: {} };
}
