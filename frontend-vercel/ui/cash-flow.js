import { cashFlow } from '../lib/cash-flow.js';
import { financeProjection } from '../lib/finance-projection.js';
import {
  escapeHtml as esc,
  formatMoney as money,
  formatCompactNumber as compact
} from '../lib/format.js';
const day = (d) => d.split('-').reverse().join('/');
const series = {
  received: { name: 'A receber', cls: 'incoming', dash: '' },
  paid: { name: 'A pagar', cls: 'outgoing', dash: '7 5' },
  net: { name: 'Saldo projetado', cls: 'balance', dash: '2 5' }
};
function chart(rows, selected, mode) {
  if (!rows.length)
    return '<div class="empty"><h3>Sem vencimentos futuros no período</h3><p>Selecione datas a partir de hoje para acompanhar a projeção.</p></div>';
  const keys =
    selected === 'receber'
      ? ['received']
      : selected === 'pagar'
        ? ['paid']
        : ['received', 'paid', 'net'];
  const values = rows.flatMap((r) => keys.map((k) => r[k]));
  const min = Math.min(0, ...values),
    max = Math.max(1, ...values),
    span = max - min;
  const x = (i) => 68 + (i / Math.max(1, rows.length - 1)) * 780;
  const y = (v) => 252 - ((v - min) / span) * 214;
  const ticks = [
    ...new Set([
      0,
      Math.round((rows.length - 1) / 3),
      Math.round(((rows.length - 1) * 2) / 3),
      rows.length - 1
    ])
  ];
  const line = (k) =>
    rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)},${y(r[k]).toFixed(2)}`).join(' ');
  return `<div class="finance-chart-wrap"><svg class="finance-chart" viewBox="0 0 880 296" role="group" aria-label="Projeção ${mode === 'daily' ? 'por dia' : 'acumulada'} por vencimento"><title>Projeção financeira por vencimento</title>${[
    0, 0.25, 0.5, 0.75, 1
  ]
    .map((p) => {
      const v = min + span * p;
      return `<line x1="68" x2="848" y1="${y(v)}" y2="${y(v)}" class="finance-grid"/><text x="57" y="${y(v) + 4}" text-anchor="end">${esc(compact(v))}</text>`;
    })
    .join(
      ''
    )}<line x1="68" x2="848" y1="${y(0)}" y2="${y(0)}" class="finance-zero"/>${keys.map((k) => `<path class="finance-line ${series[k].cls}" d="${line(k)}" ${series[k].dash ? `stroke-dasharray="${series[k].dash}"` : ''}/>`).join('')}${rows.map((r, i) => `<g data-flow-day="${r.date}" role="button" tabindex="${i === 0 ? 0 : -1}" aria-label="${day(r.date)}: receber ${money(r.receivable)}, pagar ${money(r.payable)}, diferença ${money(r.balance)}"><title>${day(r.date)} · Receber ${money(r.receivable)} · Pagar ${money(r.payable)} · Saldo ${money(r.balance)}</title><rect x="${x(i) - Math.max(3, 390 / rows.length)}" y="30" width="${Math.max(6, 780 / rows.length)}" height="226" class="finance-hit"/>${keys.map((k) => `<circle cx="${x(i)}" cy="${y(r[k])}" r="3" class="finance-point ${series[k].cls}"/>`).join('')}</g>`).join('')}${ticks.map((i) => `<text x="${x(i)}" y="281" text-anchor="${i === 0 ? 'start' : i === rows.length - 1 ? 'end' : 'middle'}">${day(rows[i].date).slice(0, 5)}</text>`).join('')}</svg></div><div class="finance-legend">${keys.map((k) => `<span><i class="${series[k].cls}"></i>${series[k].name}${mode === 'cumulative' ? ' acumulado' : ''}</span>`).join('')}</div>`;
}
export function renderCashFlow({ wallet, payables, state, today }) {
  if (!wallet?.available || !payables?.available)
    return '<section class="panel wallet-panel"><h2>Projeção financeira</h2><p class="notice">A previsão conjunta aguarda as duas carteiras confirmadas.</p></section>';
  const p = {
    inicio: state.params.get('inicio'),
    fim: state.params.get('fim'),
    company: state.params.get('empresa'),
    today
  };
  const flow = cashFlow(wallet.rows, payables.rows, p);
  const selected = state.financeSeries || 'both',
    mode = state.financeMode || 'cumulative';
  const rows = financeProjection(flow, { ...p, mode });
  const chosen = rows.find((r) => r.date === state.financeDay) || rows[0];
  const params = new URLSearchParams(state.params);
  if (chosen) {
    params.set('inicio', chosen.date);
    params.set('fim', chosen.date);
  }
  const checked = (d) => esc(new Date(d.checkedAt).toLocaleString('pt-BR'));
  return `<section class="panel wallet-panel cash-flow-panel"><div class="finance-dashboard-head"><div><h2>Projeção de recebimentos e pagamentos</h2><p>Vencimentos de ${day(p.inicio)} a ${day(p.fim)} · empresa selecionada</p></div><span class="finance-live">Atualização automática</span></div><div class="order-totals cash-flow-totals"><div><span>A receber</span><strong>${money(flow.receivable)}</strong><small>A vencer · sem antecipados</small></div><div><span>A pagar</span><strong>${money(flow.payable)}</strong><small>A vencer · inclui bloqueados</small></div><div class="wallet-primary"><span>Saldo projetado</span><strong>${money(flow.balance)}</strong><small>Receber menos pagar no período</small></div></div><div class="finance-chart-controls"><div role="group" aria-label="Contas exibidas no gráfico">${[
    ['both', 'Receber e pagar'],
    ['receber', 'Só a receber'],
    ['pagar', 'Só a pagar']
  ]
    .map(
      ([v, label]) =>
        `<button id="flow-series-${v}" type="button" class="button ${selected === v ? 'primary' : ''}" data-flow-series="${v}" aria-pressed="${selected === v}">${label}</button>`
    )
    .join('')}</div><div role="group" aria-label="Visão da projeção">${[
    ['cumulative', 'Acumulado'],
    ['daily', 'Por dia']
  ]
    .map(
      ([v, label]) =>
        `<button id="flow-mode-${v}" type="button" class="button ${mode === v ? 'primary' : ''}" data-flow-mode="${v}" aria-pressed="${mode === v}">${label}</button>`
    )
    .join(
      ''
    )}</div></div>${chart(rows, selected, mode)}${chosen ? `<div class="finance-day-detail"><label>Consultar vencimento<select id="flow-day">${rows.map((r) => `<option value="${r.date}" ${r.date === chosen.date ? 'selected' : ''}>${day(r.date)}</option>`).join('')}</select></label><div id="flow-day-values" aria-live="polite"><span>Receber <strong>${money(chosen.receivable)}</strong></span><span>Pagar <strong>${money(chosen.payable)}</strong></span><span>Diferença do dia <strong>${money(chosen.balance)}</strong></span></div><a class="button quiet" href="#carteira?${esc(params)}">Ver parcelas deste dia</a></div>` : ''}<p class="finance-arrears">Vencido a receber: <strong>${money(flow.overdueReceivable)}</strong> · Vencido a pagar: <strong>${money(flow.overduePayable)}</strong> · Bloqueado a pagar: <strong>${money(flow.blocked)}</strong> (já incluído).</p><details ${state.cashFlowOpen ? 'open' : ''}><summary>Ver valores por vencimento</summary><div class="table-wrap"><table><thead><tr><th>Vencimento</th><th>Receber</th><th>Pagar</th><th>Diferença do dia</th></tr></thead><tbody>${flow.days.map((d) => `<tr><td>${day(d.date)}</td><td>${money(d.receivable)}</td><td>${money(d.payable)}</td><td>${money(d.balance)}</td></tr>`).join('') || '<tr><td colspan="4">Sem vencimentos futuros neste período.</td></tr>'}</tbody></table></div></details><p class="note">Projeção com os títulos em aberto, sem saldo bancário inicial. Os filtros das listas abaixo não alteram o gráfico. Vencidos e antecipados ficam separados. Receber revisado em ${checked(wallet)}; pagar em ${checked(payables)}.${wallet.stale || payables.stale ? ' Uma carteira aguarda revisão: exibindo o último conjunto confirmado.' : ''}</p></section>`;
}
export function bindCashFlow(root, context) {
  const { state } = context;
  const repaint = (focus) => {
    const details = root.querySelector('details');
    if (details) state.cashFlowOpen = details.open;
    root.innerHTML = renderCashFlow(context);
    if (focus) root.querySelector('#' + focus)?.focus({ preventScroll: true });
  };
  root.onclick = (e) => {
    const seriesButton = e.target.closest('[data-flow-series]'),
      modeButton = e.target.closest('[data-flow-mode]'),
      point = e.target.closest('[data-flow-day]');
    if (seriesButton) {
      state.financeSeries = seriesButton.dataset.flowSeries;
      repaint(seriesButton.id);
    } else if (modeButton) {
      state.financeMode = modeButton.dataset.flowMode;
      repaint(modeButton.id);
    } else if (point) {
      state.financeDay = point.dataset.flowDay;
      repaint('flow-day');
    }
  };
  root.onchange = (e) => {
    if (e.target.id === 'flow-day') {
      state.financeDay = e.target.value;
      repaint('flow-day');
    }
  };
  root.onkeydown = (e) => {
    const point = e.target.closest('[data-flow-day]');
    if (!point) return;
    if (['Enter', ' '].includes(e.key)) {
      e.preventDefault();
      point.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
    if (['ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      const nodes = [...root.querySelectorAll('[data-flow-day]')];
      nodes[
        Math.max(
          0,
          Math.min(nodes.length - 1, nodes.indexOf(point) + (e.key === 'ArrowRight' ? 1 : -1))
        )
      ]?.focus();
    }
  };
}
