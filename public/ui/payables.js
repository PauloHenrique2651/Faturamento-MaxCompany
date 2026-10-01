import { escapeHtml as esc, formatMoney as money, formatNumber as num } from '../lib/format.js';
import { payablesSelection } from '../lib/payables.js';
import { walletCompanyIds } from '../lib/wallet.js';
import { renderCashFlow } from './cash-flow.js';
const names = { 1: 'MaxPlast', 3: 'MaxSafety', 5: 'MaxSupply', 6: 'MaxSupply · Filial ES' };
const day = (d) =>
  esc(
    String(d || '')
      .split('-')
      .reverse()
      .join('/') || 'Não informado'
  );
export function renderPayablesPage({ data, wallet, state, page, header }) {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(
    new Date()
  );
  const next30 = new Date(Date.parse(today + 'T12:00:00Z') + 29 * 86400000)
    .toISOString()
    .slice(0, 10);
  const upcoming =
    '#pagar?' +
    new URLSearchParams({
      inicio: today,
      fim: next30,
      ...(state.params.get('empresa') ? { empresa: state.params.get('empresa') } : {})
    });
  const open = new Set(
    [...page.querySelectorAll('details[data-payable][open]')].map((e) => e.dataset.payable)
  );
  page.innerHTML =
    header(
      'Contas a pagar',
      'Parcelas em aberto do MASERP, pelo vencimento. Inclui documentos lançados em qualquer data.'
    ) +
    renderCashFlow({ wallet, payables: data, state, today }) +
    `<section class="panel wallet-panel"><div class="tabs"><a class="button" href="${esc(upcoming)}">Próximos 30 dias</a></div><div class="toolbar"><label class="search-field"><span>Buscar documento ou fornecedor</span><input id="payable-search" type="search" value="${esc(state.payableQuery || '')}" placeholder="Nota, documento, fornecedor ou título"></label><label>Situação<select id="payable-status"><option value="">Todas as parcelas</option><option value="forecast" ${state.payableStatus === 'forecast' ? 'selected' : ''}>A vencer</option><option value="overdue" ${state.payableStatus === 'overdue' ? 'selected' : ''}>Vencidas</option><option value="blocked" ${state.payableStatus === 'blocked' ? 'selected' : ''}>Bloqueadas</option></select></label><label>Ordenar<select id="payable-sort"><option value="date">Vencimento</option><option value="value" ${state.payableSort === 'value' ? 'selected' : ''}>Maior valor</option><option value="supplier" ${state.payableSort === 'supplier' ? 'selected' : ''}>Fornecedor</option></select></label><button class="button" id="payable-clear">Limpar filtros da lista</button></div><div id="payable-summary" class="order-totals" aria-live="polite"></div><h2>Documentos e parcelas a pagar</h2><div id="payable-list"></div><div class="pagination" id="payable-pagination"></div><p class="note">Valor da parcela menos desconto, mais juros e mora cadastrados no MASERP. Pagos, baixados, excluídos, encerrados por renegociação e previsões provisórias ficam fora. Bloqueados permanecem identificados e incluídos nas obrigações; não representam pagamento autorizado. Compras e lucro não são alterados por esta previsão. Revisado em ${esc(new Date(data.checkedAt).toLocaleString('pt-BR'))}.</p></section>`;
  let first = true;
  const paint = () => {
    const result = payablesSelection(data.rows, {
      inicio: state.params.get('inicio'),
      fim: state.params.get('fim'),
      company: state.params.get('empresa'),
      today,
      query: state.payableQuery,
      status: state.payableStatus,
      sort: state.payableSort
    });
    page.querySelector('#payable-summary').innerHTML =
      `<div><span>A pagar no período</span><strong>${money(result.totals.forecast)}</strong><small>A vencer</small></div><div><span>Vencido no período</span><strong>${money(result.totals.overdue)}</strong><small>Pagamento em atraso</small></div><div><span>Bloqueado</span><strong>${money(result.totals.blocked)}</strong><small>Parte dos valores acima · não somar novamente</small></div><div><span>Parcelas encontradas</span><strong>${num(result.rows.length)}</strong><small>Vencimento dentro do filtro</small></div>`;
    if (!first) {
      open.clear();
      for (const e of page.querySelectorAll('details[data-payable][open]'))
        open.add(e.dataset.payable);
    }
    first = false;
    const shown = Math.min(result.rows.length, state.payableLimit || 60);
    page.querySelector('#payable-list').innerHTML =
      result.rows
        .slice(0, shown)
        .map((r) => {
          const invoices = [...(r.invoices || [])];
          if (/^\d{44}$/.test(r.accessKey) && !invoices.some((n) => n.accessKey === r.accessKey))
            invoices.push({ accessKey: r.accessKey });
          return `<details class="order-entry" data-payable="${esc(r.id)}" ${open.has(r.id) ? 'open' : ''}><summary><div><strong>Documento ${esc(r.documentNumber || r.titleNumber)} · Parcela ${num(r.installment)}</strong><span>${esc(r.supplier || 'Fornecedor não informado')}</span><small>${esc(names[r.companyCode])} · Vencimento ${day(r.dueOn)} · ${r.blocked ? 'Bloqueada · ' : ''}${r.dueOn < today ? 'Vencida' : 'A pagar'}</small></div><div class="order-entry-amount"><strong>${money(Math.max(0, r.amount))}</strong></div></summary><div class="order-detail"><p>Título ${esc(r.titleNumber)} · Lançado em ${day(r.issuedOn)} · Vencimento original ${day(r.originalDueOn)}${r.dueOn !== r.originalDueOn ? ' · reprogramado para ' + day(r.dueOn) : ''}.</p><p>Desconto considerado: ${money(r.discount)} · Juros e mora: ${money(r.charges)}.</p>${invoices.map((n) => (/^\d{44}$/.test(n.accessKey) ? `<button class="button" data-invoice="${esc(n.accessKey)}" data-invoice-type="entrada" data-invoice-company="${walletCompanyIds[r.companyCode]}">Abrir nota${n.invoiceNumber ? ' ' + esc(n.invoiceNumber) : ''}</button>` : `<p>Nota vinculada ${esc(n.invoiceNumber || 'sem número')} · chave não disponível.</p>`)).join('') || '<p>Documento financeiro sem nota vinculada informada pelo MASERP.</p>'}</div></details>`;
        })
        .join('') ||
      '<div class="empty"><h2>Nenhuma parcela no filtro</h2><p>Escolha outro vencimento ou remova a busca.</p></div>';
    page.querySelector('#payable-pagination').innerHTML =
      `<span>${num(shown)} de ${num(result.rows.length)} parcelas · os totais incluem todos os resultados</span>${shown < result.rows.length ? '<button class="button" id="payable-more">Mostrar mais parcelas</button>' : ''}`;
    if (shown < result.rows.length)
      page.querySelector('#payable-more').onclick = () => {
        state.payableLimit = shown + 60;
        paint();
      };
  };
  page.querySelector('#payable-search').oninput = (e) => {
    state.payableQuery = e.target.value;
    state.payableLimit = 60;
    paint();
  };
  for (const [id, key] of [
    ['payable-status', 'payableStatus'],
    ['payable-sort', 'payableSort']
  ])
    page.querySelector('#' + id).onchange = (e) => {
      state[key] = e.target.value;
      state.payableLimit = 60;
      paint();
    };
  page.querySelector('#payable-clear').onclick = () => {
    state.payableQuery = '';
    state.payableStatus = '';
    state.payableSort = 'date';
    state.payableLimit = 60;
    renderPayablesPage({ data, wallet, state, page, header });
  };
  paint();
}
