import { walletSelection } from './wallet.js';
import { payablesSelection } from './payables.js';
export function cashFlow(receivables, payables, { inicio, fim, company, today }) {
  // Os filtros de busca e situação das listas não alteram o consolidado financeiro.
  const options = { inicio, fim, company, today };
  const incoming = walletSelection(receivables, options),
    outgoing = payablesSelection(payables, options);
  const days = new Map();
  for (const [key, source] of [
    ['receivable', incoming.days],
    ['payable', outgoing.days]
  ])
    for (const d of source) {
      if (d.date < today) continue;
      if (!days.has(d.date)) days.set(d.date, { date: d.date, receivable: 0, payable: 0 });
      days.get(d.date)[key] += d.value;
    }
  return {
    receivable: incoming.totals.forecast,
    payable: outgoing.totals.forecast,
    balance: incoming.totals.forecast - outgoing.totals.forecast,
    overdueReceivable: incoming.totals.overdue,
    overduePayable: outgoing.totals.overdue,
    anticipated: incoming.totals.anticipated,
    blocked: outgoing.totals.blocked,
    days: [...days.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({ ...d, balance: d.receivable - d.payable }))
  };
}
