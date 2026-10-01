const round = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export function financeProjection(flow, { inicio, fim, today, mode = 'cumulative' }) {
  const start = inicio > today ? inicio : today;
  if (!start || !fim || start > fim) return [];
  const daily = new Map(flow.days.map((d) => [d.date, d]));
  let received = 0,
    paid = 0;
  const rows = [];
  for (
    let day = start;
    day <= fim;
    day = new Date(Date.parse(day + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10)
  ) {
    const d = daily.get(day) || { date: day, receivable: 0, payable: 0, balance: 0 };
    received = round(received + d.receivable);
    paid = round(paid + d.payable);
    rows.push({
      ...d,
      receivable: round(d.receivable),
      payable: round(d.payable),
      balance: round(d.receivable - d.payable),
      received: mode === 'daily' ? round(d.receivable) : received,
      paid: mode === 'daily' ? round(d.payable) : paid,
      net: mode === 'daily' ? round(d.receivable - d.payable) : round(received - paid)
    });
  }
  return rows;
}
