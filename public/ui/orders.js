import { escapeHtml as esc, formatMoney as money, formatNumber as num } from '../lib/format.js';
const companyIds = { 1: 1, 3: 2, 5: 3, 6: 4 };
const companyNames = { 1: 'MaxPlast', 3: 'MaxSafety', 5: 'MaxSupply', 6: 'MaxSupply · Filial ES' };
export const orderNumber = (row) =>
  `${String(row.companyCode).padStart(2, '0')}.${String(row.number).padStart(7, '0')}-${row.series}`;
const normalize = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
export function selectOrders(
  orders,
  { company = '', status = '', query = '', seller = '', sort = 'date' } = {}
) {
  const term = normalize(query).trim();
  return orders
    .filter(
      (row) =>
        (!company || String(companyIds[row.companyCode]) === String(company)) &&
        (!seller || row.seller === seller) &&
        (!status ||
          (status === 'pendente'
            ? row.pending > 0
            : status === 'faturado'
              ? row.billed > 0
              : true)) &&
        (!term ||
          normalize(
            [
              orderNumber(row),
              row.number,
              row.customer,
              row.customerCode,
              row.seller,
              ...(row.items || []).map((i) => `${i.code} ${i.name}`)
            ].join(' ')
          ).includes(term))
    )
    .sort(
      (a, b) =>
        (sort === 'value' ? b.total - a.total : sort === 'pending' ? b.pending - a.pending : 0) ||
        b.date.localeCompare(a.date) ||
        b.number - a.number
    );
}
export function renderOrdersPage({ data, state, page, header }) {
  const opened = new Set(
    [...page.querySelectorAll('details[data-order][open]')].map((el) => el.dataset.order)
  );
  const query = state.q || '',
    status = state.params.get('statusPedido') || '';
  const day = (value) => String(value).split('-').reverse().join('/');
  page.innerHTML =
    header(
      'Pedidos',
      `Pedidos criados de ${day(data.period.inicio)} a ${day(data.period.fim)}. Abra um pedido para ver os produtos e as notas vinculadas.`
    ) +
    `<section class="panel order-panel"><div class="toolbar"><label class="search-field"><span>Buscar pedido</span><input id="order-search" type="search" value="${esc(query)}" placeholder="Pedido, cliente, vendedor ou produto"></label><label>Situação<select id="order-status"><option value="">Todos os pedidos</option><option value="pendente" ${status === 'pendente' ? 'selected' : ''}>Com valor a faturar</option><option value="faturado" ${status === 'faturado' ? 'selected' : ''}>Com valor já faturado</option></select></label><label>Vendedor<select id="order-seller"><option value="">Todos</option>${[
      ...new Set(data.orders.map((r) => r.seller).filter(Boolean))
    ]
      .sort()
      .map(
        (v) =>
          `<option value="${esc(v)}" ${state.orderSeller === v ? 'selected' : ''}>${esc(v)}</option>`
      )
      .join(
        ''
      )}</select></label><label>Ordenar<select id="order-sort"><option value="date">Mais recentes</option><option value="value" ${state.orderSort === 'value' ? 'selected' : ''}>Maior valor</option><option value="pending" ${state.orderSort === 'pending' ? 'selected' : ''}>Maior saldo a faturar</option></select></label><button class="button" id="order-clear">Limpar filtros da lista</button></div><div id="order-summary" class="order-totals" aria-live="polite"></div><div id="order-list"></div><p class="note">Valores dos itens ativos do pedido. Faturamento vinculado até ${day(data.period.fim)}; pedidos parcialmente faturados aparecem nos dois filtros. Revisado em ${esc(new Date(data.checkedAt).toLocaleString('pt-BR'))}.</p></section>`;
  let firstPaint = true;
  const paint = () => {
    const rows = selectOrders(data.orders, {
      company: state.params.get('empresa'),
      status: state.params.get('statusPedido'),
      query: state.q,
      seller: state.orderSeller,
      sort: state.orderSort
    });
    const sums = rows.reduce(
      (t, r) => ({
        total: t.total + r.total,
        billed: t.billed + r.billed,
        pending: t.pending + r.pending
      }),
      { total: 0, billed: 0, pending: 0 }
    );
    page.querySelector('#order-summary').innerHTML =
      `<div><span>Pedidos encontrados</span><strong>${num(rows.length)}</strong></div><div><span>Total desses pedidos</span><strong>${money(sums.total)}</strong></div><div><span>Já faturado</span><strong>${money(sums.billed)}</strong></div><div><span>A faturar</span><strong>${money(sums.pending)}</strong></div>`;
    const previous = new Set(
      [...page.querySelectorAll('details[data-order][open]')].map((el) => el.dataset.order)
    );
    if (!firstPaint) {
      opened.clear();
      for (const id of previous) opened.add(id);
    }
    firstPaint = false;
    page.querySelector('#order-list').innerHTML =
      rows
        .slice(0, state.orderLimit || 60)
        .map(
          (row) =>
            `<details class="order-entry" data-order="${esc(row.id)}" ${opened.has(row.id) ? 'open' : ''}><summary><div><strong>Pedido ${esc(orderNumber(row))}</strong><span>${esc(row.customer)}</span><small>${esc(companyNames[row.companyCode])} · ${day(row.date)} · ${esc(row.seller || 'Vendedor não informado')}</small></div><div class="order-entry-amount"><strong>${money(row.total)}</strong><small>${row.pending > 0 ? (row.billed > 0 ? 'Parcialmente faturado' : 'A faturar') : 'Faturado'}</small></div></summary><div class="order-detail"><p><a class="button" href="/api/commercial/orders?inicio=${esc(data.period.inicio)}&amp;fim=${esc(data.period.fim)}&amp;pedido=${encodeURIComponent(row.id)}" target="_blank" rel="noopener">Baixar pedido em PDF</a></p><div class="order-totals"><div><span>Total do pedido</span><strong>${money(row.total)}</strong></div><div><span>Já faturado</span><strong>${money(row.billed)}</strong></div><div><span>A faturar</span><strong>${money(row.pending)}</strong></div></div><h3>Produtos do pedido</h3><div class="order-products">${(row.items || []).map((i) => `<div><span><strong>${esc(i.code)} · ${esc(i.name)}</strong><small>${num(i.quantity)} × ${money(i.unitPrice)}</small></span><strong>${money(i.value)}</strong></div>`).join('') || '<p>Produtos aguardando revisão.</p>'}</div><h3>Notas vinculadas</h3><div class="order-invoices">${(row.invoices || []).map((n) => (/^\d{44}$/.test(n.key) ? `<button class="button" data-invoice="${esc(n.key)}" data-invoice-type="saida" data-invoice-company="${companyIds[row.companyCode]}">Nota ${esc(n.number)}/${esc(n.series)} · ${day(n.date)}</button>` : `<span>Nota ${esc(n.number)}/${esc(n.series)} · ${day(n.date)}</span>`)).join('') || '<p>Nenhuma nota válida vinculada até a data selecionada.</p>'}</div></div></details>`
        )
        .join('') ||
      '<div class="empty"><h2>Nenhum pedido encontrado</h2><p>Remova um filtro ou altere a busca.</p></div>';
    let footer = page.querySelector('#order-pagination');
    if (!footer) {
      footer = document.createElement('div');
      footer.id = 'order-pagination';
      footer.className = 'pagination';
      page.querySelector('#order-list').after(footer);
    }
    const shown = Math.min(rows.length, state.orderLimit || 60);
    footer.innerHTML = `<span>${num(shown)} de ${num(rows.length)} pedidos · os totais incluem todos os resultados</span>${shown < rows.length ? '<button class="button" id="order-more">Mostrar mais pedidos</button>' : ''}`;
    if (shown < rows.length)
      page.querySelector('#order-more').onclick = () => {
        state.orderLimit = shown + 60;
        paint();
      };
  };
  page.querySelector('#order-seller').onchange = (e) => {
    state.orderSeller = e.target.value;
    state.orderLimit = 60;
    paint();
  };
  page.querySelector('#order-sort').onchange = (e) => {
    state.orderSort = e.target.value;
    state.orderLimit = 60;
    paint();
  };
  page.querySelector('#order-clear').onclick = () => {
    state.q = '';
    state.orderSeller = '';
    state.orderSort = 'date';
    state.orderLimit = 60;
    state.params.delete('statusPedido');
    history.replaceState(null, '', `#pedidos?${state.params}`);
    renderOrdersPage({ data, state, page, header });
  };
  page.querySelector('#order-search').oninput = (e) => {
    state.q = e.target.value;
    state.orderLimit = 60;
    paint();
  };
  page.querySelector('#order-status').onchange = (e) => {
    state.orderLimit = 60;
    if (e.target.value) state.params.set('statusPedido', e.target.value);
    else state.params.delete('statusPedido');
    history.replaceState(null, '', `#pedidos?${state.params}`);
    paint();
  };
  paint();
}
