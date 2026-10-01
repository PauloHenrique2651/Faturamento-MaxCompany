// Relatórios publicados pelo coletor; nunca substitui um período por outro.
export function selectMaserpReport(sync, period) {
  return (
    [sync?.maserpSales, ...Object.values(sync?.maserpReports || {})].find(
      (r) => r?.available && r.startDate === period?.inicio && r.endDate === period?.fim
    ) || null
  );
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
  // Compatibilidade com retratos anteriores que confundiam billed com o total fiscal.
  return Number(row.cohortBilled ?? row.billed ?? 0);
}
