import { cashFlow } from '../lib/cash-flow.js';
import { escapeHtml as esc, formatMoney as money } from '../lib/format.js';
export function renderCashFlow({ wallet, payables, state, today }) {
  if (!wallet?.available || !payables?.available)
    return '<section class="panel wallet-panel"><h2>Receber e pagar</h2><p class="notice">A previsão conjunta aguarda as duas carteiras confirmadas. Não foi estimado um saldo sem os dados completos.</p></section>';
  const p = {
    inicio: state.params.get('inicio'),
    fim: state.params.get('fim'),
    company: state.params.get('empresa'),
    today
  };
  const flow = cashFlow(wallet.rows, payables.rows, p);
  const params = new URLSearchParams({
    inicio: p.inicio,
    fim: p.fim,
    ...(p.company ? { empresa: p.company } : {})
  });
  const checked = (d) => esc(new Date(d.checkedAt).toLocaleString('pt-BR'));
  return `<section class="panel wallet-panel cash-flow-panel"><h2>Receber e pagar · previsão do período</h2><p class="note">Mesma empresa e vencimentos selecionados. Os filtros das listas abaixo não alteram este consolidado.</p><div class="order-totals cash-flow-totals"><div><span>Entradas previstas</span><strong>${money(flow.receivable)}</strong><small>A vencer · sem antecipados</small></div><div><span>Pagamentos previstos</span><strong>${money(flow.payable)}</strong><small>A vencer · inclui títulos bloqueados</small></div><div class="wallet-primary"><span>Saldo projetado</span><strong>${money(flow.balance)}</strong><small>Entradas menos pagamentos a vencer</small></div></div><p>Vencido a receber: <strong>${money(flow.overdueReceivable)}</strong> · Vencido a pagar: <strong>${money(flow.overduePayable)}</strong> · Bloqueado a pagar: <strong>${money(flow.blocked)}</strong> (já incluído nas obrigações).</p><details><summary>Ver previsão por vencimento</summary><div class="table-wrap"><table><thead><tr><th>Vencimento</th><th>Receber</th><th>Pagar</th><th>Diferença do dia</th></tr></thead><tbody>${flow.days.map((d) => `<tr><td>${esc(d.date.split('-').reverse().join('/'))}</td><td>${money(d.receivable)}</td><td>${money(d.payable)}</td><td>${money(d.balance)}</td></tr>`).join('') || '<tr><td colspan="4">Nenhum vencimento futuro neste período.</td></tr>'}</tbody></table></div></details><div class="tabs"><a class="button" href="#carteira?${esc(params)}">Ver carteira a receber</a><a class="button" href="#pagar?${esc(params)}">Ver contas a pagar</a></div><p class="note">Previsão de fluxo, sem saldo bancário inicial. Vencidos ficam separados porque a data de pagamento é incerta. Receber revisado em ${checked(wallet)}; pagar em ${checked(payables)}.${wallet.stale || payables.stale ? ' Uma carteira aguarda nova revisão: este saldo usa o último conjunto confirmado.' : ''}</p></section>`;
}
