import { escapeHtml as esc, formatMoney as money, formatNumber as num } from '../lib/format.js';
import { walletSelection, walletCompanyIds } from '../lib/wallet.js';
import { renderCashFlow } from './cash-flow.js';
const names = { 1: 'MaxPlast', 3: 'MaxSafety', 5: 'MaxSupply', 6: 'MaxSupply · Filial ES' };
const day = (v) =>
  String(v || '')
    .split('-')
    .reverse()
    .join('/');
export function renderWalletPage({ data, payables, state, page, header }) {
  const inicio = state.params.get('inicio'),
    fim = state.params.get('fim');
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(
    new Date()
  );
  const next30 = new Date(Date.parse(today + 'T12:00:00Z') + 29 * 86400000)
    .toISOString()
    .slice(0, 10);
  const walletLink = (inicio, fim) =>
    '#carteira?' +
    new URLSearchParams({
      inicio,
      fim,
      ...(state.params.get('empresa') ? { empresa: state.params.get('empresa') } : {})
    });
  const open = new Set(
    [...page.querySelectorAll('details[data-wallet][open]')].map((e) => e.dataset.wallet)
  );
  const active = document.activeElement;
  const focus =
    active?.id === 'wallet-search'
      ? { start: active.selectionStart, end: active.selectionEnd }
      : null;
  const flowDetail = page.querySelector('.cash-flow-panel details');
  if (flowDetail) state.cashFlowOpen = flowDetail.open;
  page.innerHTML =
    header(
      'Carteira a receber',
      `Vencimentos de ${day(inicio)} a ${day(fim)}. Inclui notas emitidas em qualquer data; pedidos ainda não faturados não entram.`
    ) +
    renderCashFlow({ wallet: data, payables, state, today }) +
    `<section class="panel wallet-panel"><div class="tabs"><a class="button" href="${esc(walletLink(today, next30))}">Próximos 30 dias</a></div><div class="toolbar"><label class="search-field"><span>Buscar nota ou cliente</span><input id="wallet-search" type="search" placeholder="Nota, cliente ou condição de pagamento" value="${esc(state.walletQuery || '')}"></label><label>Situação<select id="wallet-status"><option value="">Todas as parcelas</option><option value="forecast" ${state.walletStatus === 'forecast' ? 'selected' : ''}>A vencer</option><option value="overdue" ${state.walletStatus === 'overdue' ? 'selected' : ''}>Vencidas</option><option value="anticipated" ${state.walletStatus === 'anticipated' ? 'selected' : ''}>Antecipadas / descontadas</option></select></label><label>Ordenar<select id="wallet-sort"><option value="date">Vencimento</option><option value="value" ${state.walletSort === 'value' ? 'selected' : ''}>Maior valor</option><option value="customer" ${state.walletSort === 'customer' ? 'selected' : ''}>Cliente</option></select></label><button class="button" id="wallet-clear">Limpar filtros da lista</button></div><div id="wallet-summary" class="order-totals" aria-live="polite"></div><div id="wallet-calendar"></div><h2>Notas e parcelas a receber</h2><div id="wallet-list"></div><p class="note">Previsão pelas parcelas em aberto do MASERP. Valores pagos, baixados, excluídos ou de notas canceladas ficam fora. Abatimentos já reduzem o valor; vencimentos reprogramados prevalecem. Antecipados/descontados ficam separados. A data prevista não garante o pagamento nem representa saldo bancário ou capital líquido disponível. Revisado em ${esc(new Date(data.checkedAt).toLocaleString('pt-BR'))}.</p><div id="wallet-missing"></div></section>`;
  let first = true;
  const paint = () => {
    const result = walletSelection(data.rows, {
      inicio,
      fim,
      company: state.params.get('empresa'),
      query: state.walletQuery,
      today,
      status: state.walletStatus,
      sort: state.walletSort
    });
    page.querySelector('#wallet-summary').innerHTML =
      `<div class="wallet-primary"><span>Previsto para o período</span><strong>${money(result.totals.forecast)}</strong><small>A vencer · sem antecipados</small></div><div><span>Vencido no período</span><strong>${money(result.totals.overdue)}</strong><small>Atrasado · sem data certa de entrada</small></div><div><span>Antecipados / descontados</span><strong>${money(result.totals.anticipated)}</strong><small>Fora da previsão de nova entrada</small></div><div><span>Parcelas encontradas</span><strong>${num(result.rows.length)}</strong><small>Vencimento dentro do filtro</small></div>`;
    const max = Math.max(1, ...result.days.map((d) => d.value));
    page.querySelector('#wallet-calendar').innerHTML =
      `<h2>Recebimentos por dia</h2><div class="wallet-days">${result.days.map((d) => `<div class="wallet-day"><span>${day(d.date)}${d.date < today ? ' · vencido' : ''}</span><div><i style="width:${((d.value / max) * 100).toFixed(2)}%"></i></div><strong>${money(d.value)}</strong></div>`).join('') || '<p>Nenhum recebimento previsto neste período.</p>'}</div>`;
    if (!first) {
      open.clear();
      for (const e of page.querySelectorAll('details[data-wallet][open]'))
        open.add(e.dataset.wallet);
    }
    first = false;
    page.querySelector('#wallet-list').innerHTML =
      result.rows
        .slice(0, state.walletLimit || 60)
        .map(
          (r) =>
            `<details class="order-entry" data-wallet="${esc(r.id)}" ${open.has(r.id) ? 'open' : ''}><summary><div><strong>Nota ${esc(r.invoiceNumber)}/${esc(r.invoiceSeries)} · Parcela ${num(r.installment)}</strong><span>${esc(r.customer)}</span><small>${esc(names[r.companyCode])} · Vencimento ${day(r.dueOn)} · ${r.anticipated ? 'Antecipada / descontada' : r.dueOn < today ? 'Vencida' : 'A receber'}</small></div><div class="order-entry-amount"><strong>${money(Math.max(0, r.amount))}</strong></div></summary><div class="order-detail"><p>Emitida em ${day(r.issuedOn)} · Condição: <strong>${esc(r.paymentTerms || 'Não informada na nota')}</strong></p><p>Vencimento original ${day(r.originalDueOn)}${r.dueOn !== r.originalDueOn ? ' · reprogramado para ' + day(r.dueOn) : ''}. Abatimento já considerado: ${money(r.abatement)}.</p>${/^\d{44}$/.test(r.accessKey) ? `<button class="button" data-invoice="${esc(r.accessKey)}" data-invoice-type="saida" data-invoice-company="${walletCompanyIds[r.companyCode]}">Abrir nota fiscal</button>` : ''}</div></details>`
        )
        .join('') ||
      '<div class="empty"><h2>Nenhuma parcela no filtro</h2><p>Escolha outro período de vencimento ou remova a busca.</p></div>';
    let footer = page.querySelector('#wallet-pagination');
    if (!footer) {
      footer = document.createElement('div');
      footer.id = 'wallet-pagination';
      footer.className = 'pagination';
      page.querySelector('#wallet-list').after(footer);
    }
    const shown = Math.min(result.rows.length, state.walletLimit || 60);
    footer.innerHTML = `<span>${num(shown)} de ${num(result.rows.length)} parcelas · os totais incluem todos os resultados</span>${shown < result.rows.length ? '<button class="button" id="wallet-more">Mostrar mais parcelas</button>' : ''}`;
    if (shown < result.rows.length)
      page.querySelector('#wallet-more').onclick = () => {
        state.walletLimit = shown + 60;
        paint();
      };
    const missing = (data.awaitingInstallments || []).filter(
      (r) =>
        !state.params.get('empresa') ||
        String(walletCompanyIds[r.companyCode]) === state.params.get('empresa')
    );
    page.querySelector('#wallet-missing').innerHTML = missing.length
      ? `<div class="notice">${num(missing.length)} notas recentes aguardam parcelas no financeiro. Elas serão incluídas quando o MASERP informar os vencimentos; não foi inventado um valor de recebimento.</div>`
      : '';
  };
  page.querySelector('#wallet-status').onchange = (e) => {
    state.walletStatus = e.target.value;
    state.walletLimit = 60;
    paint();
  };
  page.querySelector('#wallet-sort').onchange = (e) => {
    state.walletSort = e.target.value;
    state.walletLimit = 60;
    paint();
  };
  page.querySelector('#wallet-clear').onclick = () => {
    state.walletQuery = '';
    state.walletStatus = '';
    state.walletSort = 'date';
    state.walletLimit = 60;
    renderWalletPage({ data, payables, state, page, header });
  };
  page.querySelector('#wallet-search').oninput = (e) => {
    state.walletQuery = e.target.value;
    state.walletLimit = 60;
    paint();
  };
  paint();
  if (focus) {
    const input = page.querySelector('#wallet-search');
    input.focus({ preventScroll: true });
    input.setSelectionRange(focus.start, focus.end);
  }
}
