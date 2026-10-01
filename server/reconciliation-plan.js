// Relatórios antigos são percorridos sem atrasar o mês atual.
// Revisão da publicação avança 500 documentos por ciclo e reinicia ao chegar ao fim.
export function historicalPage(state, rows, now) {
  const offset = Number(state.historicalCloudOffset || 0);
  state.historicalCloudOffset = rows.length < 500 ? 0 : offset + rows.length;
  if (rows.length < 500) state.lastHistoricalCloudSweepAt = now;
  return { offset, nextOffset: state.historicalCloudOffset, completed: rows.length < 500 };
}
export function historicalReportPeriod(state, startDate, end, now = Date.now()) {
  if (now - Date.parse(state.lastHistoricalReportAt || '1970-01-01') < 300000) return null;
  const candidates = [];
  const year = Number(end.slice(0, 4)),
    month = Number(end.slice(5, 7));
  for (let back = 2; back < 12; back++) {
    const first = new Date(Date.UTC(year, month - 1 - back, 1, 12)).toISOString().slice(0, 10);
    const last = new Date(Date.UTC(year, month - back, 0, 12)).toISOString().slice(0, 10);
    if (first >= startDate) candidates.push([first, last]);
  }
  return (
    candidates.sort(
      (a, b) =>
        Date.parse(
          state.historicalReportAttempts?.[a[0].slice(0, 7)] ||
            state.maserpReports?.[a[0].slice(0, 7)]?.checkedAt ||
            '1970-01-01'
        ) -
        Date.parse(
          state.historicalReportAttempts?.[b[0].slice(0, 7)] ||
            state.maserpReports?.[b[0].slice(0, 7)]?.checkedAt ||
            '1970-01-01'
        )
    )[0] || null
  );
}
