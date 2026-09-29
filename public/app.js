import { parseRate, projectedCommission } from './commission.js';
import { fetchJson } from './lib/api-client.js';
import {
  matchingPreset,
  monthForecast,
  periodAverages,
  presetDates,
  previousMonthAligned
} from './lib/analysis.js';
import {
  $,
  escapeHtml as esc,
  formatCompactNumber as short,
  formatDate as date,
  formatMoney as money,
  formatNumber as num,
  todayInBrazil as today
} from './lib/format.js';
import { icon } from './ui/icons.js';
import { navigationSections as sections, viewLabels as views } from './ui/navigation.js';
import { legacyViews, readSnapshot, saveSnapshot, state } from './state.js';
import { reports, reportGroups } from './report-catalog.js';
import { cfopCatalog, cfopDescription } from './lib/cfop-catalog.js';
import { renderMostrador } from './mostrador.js';
import { commercialPerformance, displayPeriod } from './lib/commercial-performance.js';
import { confirmedFinancialReturn, FINANCIAL_CFOPS } from './lib/financial-cfops.js';
import { purchaseSuggestions, reconcilePurchases } from './lib/purchase-match.js';
function href(view, changes = {}) {
  const p = new URLSearchParams(state.params);
  if (view !== 'busca') {
    p.delete('q');
    p.delete('offset');
  }
  if (['impostos', 'entradas', 'recebidas'].includes(view)) {
    for (const key of ['grupoClienteNfe', 'clienteNfe', 'vendedorNfe', 'produtoNfe']) p.delete(key);
  }
  for (const [k, v] of Object.entries(changes)) {
    if (v === null || v === '') p.delete(k);
    else p.set(k, String(v));
  }
  return `#${view}?${p}`;
}
function searchUrl(query, offset = 0) {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (offset) params.set('offset', String(offset));
  return `#busca?${params}`;
}
const fiscalViews = new Set(['emitidas', 'canceladas', 'recebidas', 'impostos', 'busca']);
async function sendJson(path, method, body = {}) {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Não foi possível salvar.');
  return data;
}
function showLogin(message = '') {
  state.user = null;
  document.body.classList.remove('auth-pending');
  document.body.classList.add('auth-locked');
  $('#auth-screen').hidden = false;
  $('#login-error').textContent = message;
  $('#login-form [name="name"]').focus();
}
function showApp(user) {
  state.user = user;
  document.body.classList.remove('auth-pending', 'auth-locked');
  $('#auth-screen').hidden = true;
  $('#current-user').textContent = user.name;
  if (user.role === 'fiscal' && !fiscalViews.has(location.hash.slice(1).split('?')[0]))
    location.hash = '#emitidas';
  route();
}
async function bootstrap() {
  try {
    showApp(await fetchJson('/api/auth/me'));
  } catch {
    showLogin();
  }
}
let searchTimer;
function go(view, changes = {}) {
  const target = href(view, changes);
  if (location.hash === target) load(true);
  else location.hash = target;
}
function link(view, text, changes = {}, cls = '') {
  return `<a class="${cls}" href="${esc(href(view, changes))}">${esc(text)}</a>`;
}
function delta(value, previous) {
  if (!previous) return '<span>Sem base anterior</span>';
  const d = ((value - previous) / previous) * 100;
  return `<span class="delta ${d < 0 ? 'down' : ''}">${d > 0 ? '+' : ''}${num(d)}%</span><span>vs. período anterior</span>`;
}
function kpi(title, value, note, type = 'trend', featured = false, target = '', tooltip = '') {
  const body = `<div class="kpi-label"${tooltip ? ` title="${esc(tooltip)}"` : ''}>${esc(title)}${icon(type)}</div><strong class="kpi-value" title="${esc(String(value).replace(/<[^>]+>/g, ''))}">${value}</strong><div class="kpi-note">${note}</div>`;
  return target
    ? `<a class="kpi kpi-link ${featured ? 'featured' : ''}" href="${esc(target.startsWith('#') ? target : href(target))}" aria-label="Abrir ${esc(title)}">${body}<span class="kpi-action">Ver detalhes ${icon('arrow')}</span></a>`
    : `<article class="kpi ${featured ? 'featured' : ''}">${body}</article>`;
}
const bigMoney = (v) => `<small>R$</small>${short(v)}`;
function head(title, subtitle, kicker = 'Inteligência comercial') {
  return `<header class="page-head"><div><div class="eyebrow">${esc(kicker)}</div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div><span class="head-tag">${icon('shield')}ERP Falco · somente consulta</span></header>`;
}
function panelHead(title, subtitle, action = '') {
  return `<div class="panel-head"><div><h2>${esc(title)}</h2><p class="panel-sub">${esc(subtitle)}</p></div>${action}</div>`;
}
function empty(message = 'Não há registros neste recorte.') {
  return `<div class="empty"><h2>Nenhum resultado</h2><p>${esc(message)} Experimente outro período ou remova um filtro.</p></div>`;
}
function totals() {
  const d = state.data.indicadores;
  return `<section class="kpis">${kpi('Vendas em pedidos', bigMoney(d.vendas), delta(d.vendas, d.anterior), 'trend', true, 'pedidos')}${kpi('Pedidos de venda', num(d.pedidos), delta(d.pedidos, d.pedidosAnterior), 'document', false, 'pedidos')}${kpi('Clientes com compra', num(d.clientes), delta(d.clientes, d.clientesAnterior), 'users', false, 'clientes')}${kpi('Ticket por pedido', bigMoney(d.pedidos ? d.vendas / d.pedidos : 0), `${num(d.produtos)} produtos distintos no recorte`, 'box', false, 'produtos')}</section>`;
}
function chart() {
  const d = state.data,
    rows = d.serie,
    max = Math.max(...rows.flatMap((r) => [r.valor, r.anterior]), 1),
    w = 720,
    h = 210,
    left = 60,
    right = 700,
    top = 10,
    bottom = 177;
  const x = (i) => left + (i / Math.max(rows.length - 1, 1)) * (right - left),
    y = (v) => bottom - (v / max) * (bottom - top);
  const path = (key) =>
    rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(r[key]).toFixed(1)}`).join(' ');
  return `<article class="panel">${panelHead('Evolução das vendas', 'Mesmo intervalo de dias, comparado ao período anterior')}<div class="chart-total"><strong>${money(d.indicadores.vendas)}</strong><div class="legend"><span><i></i>Atual</span><span><i class="previous"></i>Anterior</span></div></div><div class="chart"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Vendas diárias no período atual e anterior. Os pontos abrem os pedidos do dia."><defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--accent)" stop-opacity=".12"/><stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>${[0, 0.25, 0.5, 0.75, 1].map((t) => `<line x1="${left}" x2="${right}" y1="${y(max * t)}" y2="${y(max * t)}" stroke="#e9ebf0" stroke-dasharray="3 4"/><text x="${left - 10}" y="${y(max * t) + 4}" text-anchor="end">${short(max * t)}</text>`).join('')}<path d="${path('valor')} L${x(rows.length - 1)},${bottom} L${left},${bottom} Z" fill="url(#chart-fill)"/><path d="${path('anterior')}" fill="none" stroke="#9ca5b7" stroke-width="1.8" stroke-dasharray="5 5"/><path d="${path('valor')}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round"/>${rows.map((r, i) => `<a href="${esc(href('pedidos', { inicio: r.dia, fim: r.dia }))}" aria-label="${date(r.dia)}: ${money(r.valor)}. Abrir pedidos"><circle cx="${x(i)}" cy="${y(r.valor)}" r="9" fill="transparent"/><circle class="chart-point" cx="${x(i)}" cy="${y(r.valor)}" r="4"/><title>${date(r.dia)} · ${money(r.valor)} | Anterior: ${money(r.anterior)}</title></a>`).join('')}${[...new Set([0, Math.floor((rows.length - 1) * 0.25), Math.floor((rows.length - 1) * 0.5), Math.floor((rows.length - 1) * 0.75), rows.length - 1])].map((i) => `<text x="${x(i)}" y="203" text-anchor="${i === 0 ? 'start' : i === rows.length - 1 ? 'end' : 'middle'}">${esc(date(rows[i].dia))}</text>`).join('')}</svg></div><div class="chart-footer"><span>${date(d.filtros.inicio)} — ${date(d.filtros.fim)}</span><span>Clique em um ponto para consultar o dia</span></div></article>`;
}
function rank(title, rows, view, key, sub = 'Ordenado pelo valor de vendas') {
  const total = rows.reduce((n, r) => n + r.valor, 0);
  return `<article class="panel">${panelHead(title, sub, link(view, 'Ver todos', {}, 'text-button'))}<div class="rank-list">${
    rows
      .slice(0, 5)
      .map(
        (r, i) =>
          `<div class="rank-row"><span class="rank-index">${String(i + 1).padStart(2, '0')}</span><div>${link(view, r.nome, { [key]: r.id }, 'rank-name')}<div class="rank-detail">${num(r.pedidos)} pedidos · ${num(total ? (r.valor / total) * 100 : 0)}% do recorte</div><div class="progress"><span style="width:${Math.min(100, rows[0]?.valor ? (r.valor / rows[0].valor) * 100 : 0)}%"></span></div></div><span class="rank-value">${money(r.valor)}</span></div>`
      )
      .join('') || empty()
  }</div></article>`;
}
function insightCards() {
  const d = state.data,
    i = d.indicadores,
    top = d.clientes[0],
    lead = d.vendedores.find((v) => v.valor > 0),
    share = top && i.vendas ? (top.valor / i.vendas) * 100 : 0,
    fall = d.vendedores.filter((v) => v.anterior > 0 && v.valor < v.anterior);
  const cards = [
    [
      'Concentração de clientes',
      top
        ? `${num(share)}% das vendas estão em ${top.nome}. Avalie a dependência dessa conta.`
        : 'Não há vendas para medir concentração.',
      'clientes',
      top ? { cliente: top.id } : {},
      'users'
    ],
    [
      'Destaque comercial',
      lead
        ? `${lead.nome} lidera o recorte com ${money(lead.valor)} e ${lead.clientes} clientes atendidos.`
        : 'Nenhum vendedor com vendas neste recorte.',
      'vendedores',
      lead ? { vendedor: lead.id } : {},
      'trend'
    ],
    [
      'Ponto de atenção',
      `${fall.length} vendedores venderam menos que no intervalo anterior. Compare carteira e contexto antes de avaliar desempenho.`,
      'vendedores',
      {},
      'target'
    ]
  ];
  return `<div class="insight-strip">${cards.map(([title, body, v, c, ic]) => `<article class="insight"><div class="insight-icon">${icon(ic)}</div><div><h3>${title}</h3><p>${esc(body)}</p>${link(v, 'Investigar', c)}</div></article>`).join('')}</div>`;
}
function table(columns, rows) {
  return `<div class="table-wrap"><table class="data-table"><thead><tr>${columns.map((c) => `<th class="${c.num ? 'num' : ''}">${esc(c.title)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${columns.map((c) => `<td class="${c.num ? 'num' : ''} ${c.cls || ''}">${c.render(r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function groupName(id) {
  return state.data.catalogo.grupos.find((g) => g.id === id)?.nome || 'Sem grupo';
}
function sellerCell(r) {
  const initials = r.nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0])
    .join('');
  return `<div class="entity"><span class="avatar">${esc(initials)}</span><div>${link('vendedores', r.nome, { vendedor: r.id })}<small>Cód. ${r.id} · ${esc(groupName(r.grupo))}</small></div></div>`;
}
const sellerColumns = () => [
  { title: 'Vendedor', cls: 'name-cell', render: sellerCell },
  { title: 'Vendas em pedidos', num: true, render: (r) => money(r.valor) },
  { title: 'Pedidos', num: true, render: (r) => num(r.pedidos) },
  { title: 'Clientes', num: true, render: (r) => num(r.clientes) },
  { title: 'Comparativo', num: true, render: (r) => delta(r.valor, r.anterior) },
  {
    title: 'Cadastro',
    render: (r) =>
      `<span class="badge ${r.ativo ? 'active' : ''}">${r.ativo ? 'Ativo' : 'Inativo'}</span>`
  }
];
function dashboard() {
  const d = state.data;
  $('#page').innerHTML =
    head(
      'Visão executiva',
      'Sua operação em perspectiva. Do resultado consolidado aos pedidos que explicam cada número.',
      'Maxcompany / Visão geral'
    ) +
    totals() +
    `<div class="columns">${chart()}${rank('Principais clientes', d.clientes, 'clientes', 'cliente')}</div>` +
    insightCards() +
    `<div class="columns equal">${rank('Produtos mais vendidos', d.produtos, 'produtos', 'produto')}${rank('Fornecedores em destaque', d.fornecedores, 'fornecedores', 'fornecedor', d.comprasDisponiveis ? 'Valor em pedidos de compra' : 'Remova filtros comerciais para analisar compras')}</div><section class="panel">${panelHead('Desempenho dos vendedores', `Atribuição ao vendedor ${d.filtros.papel}`, link('vendedores', 'Ver equipe completa', {}, 'text-button'))}${table(sellerColumns(), d.vendedores.filter((r) => r.valor > 0).slice(0, 5))}</section>`;
}
function tabs(items) {
  return `<div class="tabs">${items.map((v) => link(v, views[v], {}, `tab ${state.view === v ? 'active' : ''}`)).join('')}</div>`;
}
function groupCards(edit = false) {
  const d = state.data,
    groups = [...d.catalogo.grupos];
  if (d.catalogo.vendedores.some((v) => v.grupo == null)) groups.push({ id: 0, nome: 'Sem grupo' });
  return `<div class="group-cards">${groups
    .map((g) => {
      const members = d.catalogo.vendedores.filter((v) => (v.grupo ?? 0) === g.id),
        ranking = d.vendedores.filter((v) => (v.grupo ?? 0) === g.id);
      return `<article class="group-card"><div><h3>${link('vendedores', g.nome, { grupo: g.id, vendedor: null })}</h3><p>${members.length} vendedores · ${members.filter((v) => v.ativo).length} ativos</p><strong class="group-total">${money(ranking.reduce((n, v) => n + v.valor, 0))}</strong><p>Vendas no recorte</p></div>${edit ? `<label class="rate-field"><span class="sr-only">Comissão do grupo ${esc(g.nome)}</span><input class="rate-input" inputmode="decimal" data-rate="grupos" data-id="${g.id}" value="${esc(state.rules.grupos[g.id] ?? '')}" placeholder="Herdar" aria-label="Comissão do grupo ${esc(g.nome)}"><span>%</span></label>` : link('vendedores', 'Ver equipe', { grupo: g.id, vendedor: null }, 'text-button')}</article>`;
    })
    .join('')}</div>`;
}
function listingConfig() {
  const v = state.view,
    d = state.data;
  if (v === 'vendedores' || v === 'grupos')
    return {
      rows: d.vendedores,
      columns: sellerColumns(),
      search: 'Buscar vendedor ou código',
      sellers: true
    };
  if (v === 'comissoes')
    return {
      rows: d.vendedores,
      search: 'Buscar vendedor ou código',
      sellers: true,
      columns: [
        { title: 'Vendedor', cls: 'name-cell', render: sellerCell },
        { title: 'Base de venda', num: true, render: (r) => money(r.valor) },
        {
          title: 'Regra individual (%)',
          render: (r) =>
            `<input class="rate-input" inputmode="decimal" aria-label="Comissão de ${esc(r.nome)}" data-rate="vendedores" data-id="${r.id}" value="${esc(state.rules.vendedores[r.id] ?? '')}" placeholder="Herdar">`
        },
        {
          title: 'Percentual efetivo',
          num: true,
          render: (r) => {
            const c = projectedCommission(r, state.rules);
            return c.rate === null
              ? '<span class="badge">Não definida</span>'
              : `${num(c.rate)}% <span class="badge">${c.origem}</span>`;
          }
        },
        {
          title: 'Comissão estimada',
          num: true,
          render: (r) => {
            const c = projectedCommission(r, state.rules);
            return c.valor === null ? '—' : money(c.valor);
          }
        }
      ]
    };
  if (v === 'pedidos' || v === 'compras') {
    const buy = v === 'compras';
    return {
      rows: buy ? d.compras : d.pedidos,
      search: 'Buscar pedido, empresa ou cliente',
      columns: [
        {
          title: 'Pedido / empresa',
          render: (r) =>
            `<button class="text-button" data-doc="${esc(r.id)}" data-buy="${buy}">${esc(`${r.empresa}/${r.numero}${r.serie || ''}`)}</button>`
        },
        { title: 'Inclusão', render: (r) => date(r.dia) },
        {
          title: buy ? 'Fornecedor' : 'Cliente',
          cls: 'name-cell',
          render: (r) =>
            link(buy ? 'fornecedores' : 'clientes', buy ? r.fornecedorNome : r.clienteNome, {
              [buy ? 'fornecedor' : 'cliente']: buy ? r.fornecedor : r.cliente
            })
        },
        { title: 'Itens no recorte', num: true, render: (r) => num(r.itens.length) },
        { title: 'Valor dos itens', num: true, render: (r) => money(r.valor) },
        { title: 'Situação ERP', render: (r) => `<span class="badge">${esc(r.status)}</span>` }
      ]
    };
  }
  const product = v.startsWith('produtos'),
    buy = v === 'produtos-comprados' || v === 'fornecedores',
    key = product ? 'produto' : buy ? 'fornecedor' : 'cliente',
    rows = product ? (buy ? d.produtosComprados : d.produtos) : buy ? d.fornecedores : d.clientes;
  return {
    rows,
    search: `Buscar ${product ? 'produto' : buy ? 'fornecedor' : 'cliente'} ou código`,
    columns: [
      { title: 'Código', render: (r) => link(v, r.id, { [key]: r.id }, 'code') },
      {
        title: product ? 'Produto' : buy ? 'Fornecedor' : 'Cliente',
        cls: 'name-cell',
        render: (r) => link(v, r.nome, { [key]: r.id })
      },
      {
        title: buy ? 'Compras em pedidos' : 'Vendas em pedidos',
        num: true,
        render: (r) => money(r.valor)
      },
      { title: 'Pedidos', num: true, render: (r) => num(r.pedidos) },
      ...(product
        ? [
            {
              title: 'Quantidade / un.',
              num: true,
              render: (r) => `${num(r.quantidade)} ${esc(r.unidade)}`
            }
          ]
        : [
            {
              title: 'Ticket por pedido',
              num: true,
              render: (r) => money(r.pedidos ? r.valor / r.pedidos : 0)
            }
          ]),
      {
        title: 'Participação',
        num: true,
        render: (r) =>
          `${num(rows.reduce((n, a) => n + a.valor, 0) ? (r.valor / rows.reduce((n, a) => n + a.valor, 0)) * 100 : 0)}%`
      }
    ]
  };
}
function toolbar(config) {
  return `<div class="toolbar"><label class="search-field">${icon('search')}<span class="sr-only">${config.search}</span><input id="table-search" value="${esc(state.q)}" placeholder="${config.search}"></label>${config.sellers ? `<label>Cadastro<select id="active-filter"><option value="all">Todos</option><option value="active">Ativos</option><option value="inactive">Inativos</option></select></label><label>Grupo<select id="group-filter"><option value="">Todos</option>${state.data.catalogo.grupos.map((g) => `<option value="${g.id}">${esc(g.nome)}</option>`).join('')}<option value="0">Sem grupo</option></select></label>` : ''}<label>Ordenar<select id="table-sort"><option value="valor">Maior valor</option><option value="nome">Nome / código</option><option value="pedidos">Mais pedidos</option><option value="recent">Mais recentes</option></select></label><span class="result-count" id="result-count"></span></div><div id="table-region"></div>`;
}
function paintTable() {
  const config = listingConfig();
  let rows = config.rows.filter((r) =>
    Object.values(r)
      .filter((v) => typeof v !== 'object')
      .join(' ')
      .toLocaleLowerCase('pt-BR')
      .includes(state.q.toLocaleLowerCase('pt-BR'))
  );
  if (config.sellers && state.active !== 'all')
    rows = rows.filter((r) => Boolean(r.ativo) === (state.active === 'active'));
  rows = [...rows].sort((a, b) =>
    state.sort === 'nome'
      ? String(a.nome || a.numero || a.id).localeCompare(
          String(b.nome || b.numero || b.id),
          'pt-BR',
          { numeric: true }
        )
      : state.sort === 'recent'
        ? String(b.dia || '').localeCompare(String(a.dia || ''))
        : Number(b[state.sort] || 0) - Number(a[state.sort] || 0)
  );
  const pages = Math.max(1, Math.ceil(rows.length / 20));
  state.page = Math.min(state.page, pages);
  const slice = rows.slice((state.page - 1) * 20, state.page * 20);
  $('#result-count').textContent = `${rows.length} registros`;
  $('#table-region').innerHTML =
    (slice.length ? table(config.columns, slice) : empty()) +
    `<div class="pagination"><span>${rows.length ? `${(state.page - 1) * 20 + 1}–${Math.min(state.page * 20, rows.length)} de ${rows.length}` : '0 registros'}</span><div><button data-page="-1" ${state.page === 1 ? 'disabled' : ''}>Anterior</button><span>${state.page} / ${pages}</span><button data-page="1" ${state.page === pages ? 'disabled' : ''}>Próxima</button></div></div>`;
}
function bindListing() {
  const config = listingConfig();
  $('#table-search').addEventListener('input', (e) => {
    state.q = e.target.value;
    state.page = 1;
    paintTable();
  });
  $('#table-sort').value = state.sort;
  $('#table-sort').addEventListener('change', (e) => {
    state.sort = e.target.value;
    paintTable();
  });
  if (config.sellers) {
    $('#active-filter').value = state.active;
    $('#active-filter').addEventListener('change', (e) => {
      state.active = e.target.value;
      state.page = 1;
      paintTable();
    });
    $('#group-filter').value = state.params.get('grupo') || '';
    $('#group-filter').addEventListener('change', (e) =>
      go(state.view, { grupo: e.target.value, vendedor: null })
    );
  }
  paintTable();
}
function contextTitle() {
  const p = state.params,
    d = state.data;
  for (const [key, rows] of [
    ['vendedor', d.catalogo.vendedores],
    ['cliente', d.clientes],
    ['produto', [...d.produtos, ...d.produtosComprados]],
    ['fornecedor', d.fornecedores]
  ])
    if (p.has(key))
      return rows.find((r) => r.id === Number(p.get(key)))?.nome || `${key} ${p.get(key)}`;
  return null;
}
function relationActions() {
  const d = state.data,
    isSeller = state.params.has('vendedor'),
    isClient = state.params.has('cliente'),
    isProduct = state.params.has('produto');
  if (!isSeller && !isClient && !isProduct) return '';
  const cards = [
    ['pedidos', 'Pedidos relacionados', `${num(d.indicadores.pedidos)} documentos`, 'document'],
    ['dashboard', 'Valores do recorte', money(d.indicadores.vendas), 'trend'],
    ['clientes', 'Clientes atendidos', `${num(d.clientes.length)} contas`, 'users'],
    ['produtos', 'Produtos vendidos', `${num(d.produtos.length)} códigos`, 'box']
  ];
  return `<section class="entity-actions" aria-label="Explorar relações">${cards.map(([view, title, value, ic]) => `<a class="entity-action" href="${esc(href(view))}"><span class="entity-action-icon">${icon(ic)}</span><span><small>${esc(title)}</small><strong>${esc(value)}</strong></span>${icon('arrow')}</a>`).join('')}</section>`;
}
function listings() {
  const d = state.data,
    view = state.view,
    detail = contextTitle(),
    isSeller = ['vendedores', 'grupos'].includes(view),
    buy = ['fornecedores', 'compras', 'produtos-comprados'].includes(view);
  let html = head(
    detail || views[view],
    detail
      ? 'Análise conectada ao recorte selecionado. Os filtros acompanham você entre as telas.'
      : isSeller
        ? 'Equipe, grupos, carteira e evolução das vendas. Clique em um vendedor para aprofundar.'
        : 'Ranking do período selecionado. Clique nos códigos e nomes para investigar os documentos de origem.'
  );
  if (isSeller) html += tabs(['vendedores', 'grupos', 'comissoes']);
  if (view.startsWith('produtos')) html += tabs(['produtos', 'produtos-comprados']);
  if (buy && !d.comprasDisponiveis) {
    $('#page').innerHTML =
      html +
      `<section class="panel">${empty('Filtros de vendedor, grupo ou cliente não se aplicam às compras. Remova-os nos filtros acima.')}</section>`;
    return;
  }
  if (view === 'grupos') html += groupCards();
  if (detail && !buy)
    html +=
      relationActions() +
      totals() +
      `<div class="columns">${chart()}${rank(state.params.has('cliente') ? 'Produtos comprados' : 'Clientes no recorte', state.params.has('cliente') ? d.produtos : d.clientes, state.params.has('cliente') ? 'produtos' : 'clientes', state.params.has('cliente') ? 'produto' : 'cliente')}</div>${state.params.has('vendedor') ? `<div class="tabs">${link('comissoes', 'Simular comissão deste vendedor', {}, 'tab')}</div>` : ''}`;
  if (!detail && isSeller)
    html += `<section class="kpis">${kpi('Vendedores cadastrados', num(d.catalogo.vendedores.length), 'Cadastro completo do ERP Falco', 'users')}${kpi('Ativos no cadastro', num(d.catalogo.vendedores.filter((v) => v.ativo).length), 'Situação atual no ERP Falco', 'users')}${kpi('Com vendas no recorte', num(d.vendedores.filter((v) => v.valor > 0).length), 'Inclui histórico de inativos', 'trend')}${kpi('Vendas da equipe', bigMoney(d.indicadores.vendas), 'Base provisória para comissão', 'wallet', true)}</section>`;
  if (buy)
    html += `<section class="kpis">${kpi('Pedidos de compra', num(d.compras.length), 'No período selecionado', 'document')}${kpi('Compras em pedidos', bigMoney(d.indicadores.compras), 'Valor dos itens, sem fretes adicionais', 'wallet', true)}${kpi('Fornecedores', num(d.fornecedores.length), 'Com compras no recorte', 'truck')}${kpi('Produtos comprados', num(d.produtosComprados.length), 'Códigos distintos', 'box')}</section>${detail ? `<div class="tabs">${link('compras', 'Consultar pedidos de compra', {}, 'tab')}${link('produtos-comprados', 'Explorar produtos comprados', {}, 'tab')}</div>` : ''}`;
  $('#page').innerHTML =
    html +
    `<section class="panel">${panelHead(views[view], isSeller ? 'O ranking respeita o período e a atribuição de vendas' : 'Registros vinculados aos filtros ativos')}${toolbar(listingConfig())}</section>`;
  bindListing();
}
function commissionSummary() {
  const rows = state.data.vendedores.filter((r) => r.id !== 0),
    defined = rows.filter((r) => projectedCommission(r, state.rules).rate !== null),
    pending = rows.filter((r) => r.valor > 0 && projectedCommission(r, state.rules).rate === null),
    amount =
      defined.reduce((n, r) => n + Math.round(projectedCommission(r, state.rules).valor * 100), 0) /
      100;
  return `${kpi('Base de vendas', bigMoney(rows.reduce((n, r) => n + r.valor, 0)), 'Somente vendedores identificados', 'trend')}${kpi('Comissão estimada', defined.length ? bigMoney(amount) : 'Não definida', pending.length ? 'Total parcial · há regras pendentes' : 'Simulação, sem lançamento financeiro', 'wallet', true)}${kpi('Vendedores com regra', num(defined.length), 'Percentual próprio ou herdado', 'users')}${kpi('Com vendas, sem regra', num(pending.length), 'Aguardando os percentuais', 'target')}`;
}
function commissions() {
  const d = state.data;
  $('#page').innerHTML =
    head(
      'Comissões sobre vendas',
      'Defina cenários por grupo ou vendedor. Os percentuais são locais e não alteram o ERP.',
      'Comercial / Simulador'
    ) +
    tabs(['vendedores', 'grupos', 'comissoes']) +
    `<div class="notice">Estimativa provisória. Devoluções, impostos, frete e ajustes posteriores não estão conciliados para comissão. Não utilizar como folha de pagamento.${d.indicadores.devolucoesSinalizadas ? ` Há ${d.indicadores.devolucoesSinalizadas} pedidos sinalizados com devolução neste recorte.` : ''}</div><section class="kpis" id="commission-summary">${commissionSummary()}</section><section class="panel">${panelHead('Regras da simulação', 'Vendedor → grupo → geral. O primeiro percentual definido é utilizado.')}<div class="commission-rules"><label>Percentual geral<div class="rate-field"><input class="rate-input" data-rate="geral" aria-label="Percentual geral" inputmode="decimal" placeholder="Não definido" value="${esc(state.rules.geral)}"><span>%</span></div></label><p>Deixe vazio para não definir uma regra. Digite 0 para uma regra explícita de 0%. Os percentuais são salvos neste navegador; não são compartilhados com outros usuários.</p></div><div class="form-error" id="rate-error" role="alert"></div></section>${groupCards(true)}<section class="panel">${panelHead('Comissão por vendedor', `Atribuição: vendedor ${d.filtros.papel}. Troque no filtro superior para outra visão.`)}${toolbar(listingConfig())}<div class="note">Vendedores sem identificação não recebem comissão simulada. Metas não foram inventadas: aguardam definição e período de referência.</div></section>`;
  bindListing();
}
function insights() {
  const d = state.data,
    i = d.indicadores;
  $('#page').innerHTML =
    head(
      'Pontos fortes e atenção',
      'Sinais calculados a partir do recorte. São indicações para investigação, não conclusões sobre a equipe.'
    ) +
    totals() +
    insightCards() +
    `<div class="columns equal">${rank('Concentração por produto', d.produtos, 'produtos', 'produto')}${rank(
      'Distribuição por vendedor',
      d.vendedores.filter((v) => v.valor > 0),
      'vendedores',
      'vendedor'
    )}</div><section class="panel">${panelHead('Limites da análise', 'Para decisões confiáveis')}<div class="note">Não exibimos lucro, margem, conversão de orçamento ou atingimento de meta sem validar as respectivas bases. ${i.devolucoesSinalizadas} pedidos do recorte estão sinalizados com devolução. A comparação é contra ${date(d.filtros.anteriorInicio)} a ${date(d.filtros.anteriorFim)}; o dia atual pode estar incompleto.</div></section>`;
}
function renderContext() {
  const d = state.data,
    keys = ['vendedor', 'grupo', 'cliente', 'produto', 'fornecedor'];
  const labels = {
      vendedor: 'Vendedor',
      grupo: 'Grupo',
      cliente: 'Cliente',
      produto: 'Produto',
      fornecedor: 'Fornecedor'
    },
    rows = {
      vendedor: d.catalogo.vendedores,
      grupo: d.catalogo.grupos,
      cliente: d.clientes,
      produto: [...d.produtos, ...d.produtosComprados],
      fornecedor: d.fornecedores
    };
  const filters = keys.filter((k) => state.params.has(k));
  $('#context').innerHTML = filters.length
    ? `<div class="context-bar"><span class="context-label">Recorte ativo</span>${filters.map((k) => `<span class="chip">${labels[k]}: ${esc(rows[k].find((r) => r.id === Number(state.params.get(k)))?.nome || state.params.get(k))}<button data-clear="${k}" aria-label="Remover filtro de ${labels[k]}">${icon('close')}</button></span>`).join('')}<button class="text-button" id="clear-all">Limpar recorte</button></div>`
    : '';
}
function companyLogo(name = '') {
  const n = name.toLocaleLowerCase('pt-BR');
  if (n.includes('maxplast')) return '/brand/maxplast-color.webp';
  if (n.includes('maxsafety')) return '/brand/maxsafety-color.webp';
  if (n.includes('maxsupply')) return '/brand/maxsupply-color.webp';
  return '/brand/max-company.webp';
}
const xmlCompanies = [
  { id: 1, nome: 'MaxPlast' },
  { id: 2, nome: 'MaxSafety' },
  { id: 3, nome: 'MaxSupply' },
  { id: 4, nome: 'MaxSupply · Filial ES' }
];
function renderCompanies(rows) {
  const current = state.params.get('empresa') || '';
  const companies = [{ id: '', nome: 'Grupo consolidado' }, ...rows];
  $('#company-cards').innerHTML = companies
    .map(
      (c) =>
        `<button class="company-card ${String(c.id) === current ? 'active' : ''}" data-company="${esc(c.id)}" aria-pressed="${String(c.id) === current}" title="Filtrar por ${esc(c.nome)}"><img src="${companyLogo(c.nome)}" alt="" width="160" height="44"><span><strong>${esc(c.nome)}</strong><small>${c.id === '' ? 'Visão consolidada do grupo' : c.id === 4 ? 'Unidade do Espírito Santo' : 'Empresa do grupo'}</small></span></button>`
    )
    .join('');
}
function showXmlCompanies() {
  $('#company').innerHTML =
    '<option value="">Todas as empresas</option>' +
    xmlCompanies
      .map((company) => `<option value="${company.id}">${esc(company.nome)}</option>`)
      .join('');
  $('#company').value = state.params.get('empresa') || '';
  renderCompanies(xmlCompanies);
}
function nfeSource(data, detailed = false) {
  if (data.source === 'Supabase') {
    const last = data.synchronization?.updatedAt || data.lastSyncedAt;
    const synced = last ? new Date(last).toLocaleString('pt-BR') : 'a confirmar';
    const fresh = data.synchronization?.fresh === true;
    return `<div class="nfe-source"><span class="nfe-live ${fresh ? '' : 'is-stale'}">${fresh ? 'Sincronização ativa' : data.synchronization?.collecting ? 'Sincronizando documentos' : 'Sincronização atrasada'} · NF-e por data de emissão</span><span>Última sincronização concluída: ${esc(synced)}</span></div>`;
  }
  const live = data.sourcesAvailable === data.sourcesTotal;
  const label = live
    ? 'Fonte: XMLs de NF-e · pastas conectadas'
    : 'Fonte: XMLs de NF-e · conexão parcial';
  const detail = detailed
    ? `${data.sourcesAvailable} de ${data.sourcesTotal} pastas conectadas · `
    : '';
  return `<div class="nfe-source"><span class="nfe-live ${live ? '' : 'is-stale'}">${label}</span><span>${detail}Verificado em ${new Date(data.checkedAt).toLocaleTimeString('pt-BR')}</span></div>`;
}
function documentUrl(type, row, format = 'json', download = false) {
  const company = xmlCompanies.find((item) => item.nome === row.company)?.id;
  return `/api/falco/documento?tipo=${type}&empresa=${company}&chave=${row.key}&formato=${format}${download ? '&baixar=1' : ''}`;
}
function documentRows(rows, type, limit = state.documentLimit) {
  const shown = rows.slice(0, limit);
  return `<div class="document-list"><div class="document-head"><span>Emissão</span><span>NF-e</span><span>Empresa</span><span>${type === 'saida' ? 'Destinatário' : 'Emitente'}</span><span>Valor</span></div>${shown
    .map((row) => {
      const availability =
        row.xmlStatus || row.danfeStatus
          ? `<small class="document-availability"><span class="${row.xmlStatus === 'AVAILABLE' || row.hasXml ? 'available' : 'missing'}">XML ${row.xmlStatus === 'AVAILABLE' || row.hasXml ? 'disponível' : 'pendente'}</span><span class="${row.danfeStatus === 'AVAILABLE' || row.hasDanfe ? 'available' : 'missing'}">DANFE ${row.danfeStatus === 'AVAILABLE' || row.hasDanfe ? 'disponível' : 'pendente'}</span></small>`
          : '';
      const cfops = [...new Set((row.itemsDetail || []).map((item) => item.cfop).filter(Boolean))];
      const financial = row.financial || {};
      const fiscalTags = `<small class="document-cfops">${cfops.map((code) => `<span class="cfop-badge" title="${esc(cfopDescription(code))}">CFOP ${esc(code)} · ${financial.items?.find((item) => item.cfop === code)?.effect === 'financial' ? 'GERA FINANCEIRO' : 'NÃO GERA FINANCEIRO'}</span>`).join(' ')}<span class="cfop-badge">${row.canceled ? 'CANCELADA' : financial.status === 'pending' || financial.status === 'partial' ? 'CLASSIFICAÇÃO PENDENTE' : financial.status === 'mixed' ? 'MISTA' : financial.status === 'financial' ? 'FINANCEIRA' : 'SEM EFEITO FINANCEIRO'}</span></small>`;
      return `<button class="document-row${row.canceled ? ' is-canceled' : ''}" data-invoice="${row.key}" data-invoice-type="${type}" data-invoice-company="${xmlCompanies.find((item) => item.nome === row.company)?.id}" data-invoice-canceled="${row.canceled ? 'true' : 'false'}"><span>${date(row.date)}</span><strong>${esc(row.number || row.key.slice(25, 34))}/${esc(row.series || row.key.slice(22, 25))}</strong><span>${esc(row.company)}</span><span class="document-entity">${esc(type === 'saida' ? row.customer?.name : row.supplier?.name)} · ${esc(type === 'entrada' && row.fiscalOperation?.type === 'sale' ? 'Compra / entrada de fornecedor' : operationLabel(row.fiscalOperation?.type))}${row.canceled ? '<small class="document-canceled">Cancelada</small>' : ''}${fiscalTags}${availability}</span><strong>${money(row.value)}</strong></button>`;
    })
    .join(
      ''
    )}</div>${rows.length > limit ? `<button class="button document-more" data-document-more>Mostrar mais · ${num(limit)} de ${num(rows.length)}</button>` : ''}`;
}

function operationLabel(type) {
  return (
    {
      sale: 'Venda',
      return: 'Devolução',
      transfer: 'Transferência',
      bonus: 'Bonificação',
      complementary: 'Complementar',
      adjustment: 'Ajuste',
      'industrial-return': 'Retorno de industrialização',
      mixed: 'Operação mista',
      other: 'Outra operação',
      unknown: 'Não classificada'
    }[type] || 'Não classificada'
  );
}

function reconciliationPanel(data) {
  const rows = data.reconciliation || data.operations || [];
  const filter = (type) =>
    ({ sale: 'venda', return: 'devolucao', 'industrial-return': 'industrial' })[type] || type;
  return `<article class="panel reconciliation-panel">${panelHead('Reconciliação fiscal', 'Quantidade e valor das NF-e que compõem cada classificação')}<div class="reconciliation-list">${rows.length ? rows.map((row) => `<a href="${esc(href('emitidas', { operacao: filter(row.type) }))}"><span>${esc(operationLabel(row.type))}<small>${num(row.count)} NF-e</small></span><strong>${money(row.value)}</strong></a>`).join('') : '<p class="note">Nenhum documento no período.</p>'}</div></article>`;
}

function coveragePanel(data) {
  const coverage = data.documentCoverage;
  if (!coverage) return '';
  return `<article class="panel reconciliation-panel">${panelHead('Documentos fiscais', 'Cobertura dos artefatos privados sincronizados')}<div class="coverage-grid"><div><strong>${num(coverage.xmlAvailable)}</strong><span>XML disponível</span></div><div><strong>${num(coverage.xmlMissing)}</strong><span>XML pendente</span></div><div><strong>${num(coverage.danfeAvailable)}</strong><span>DANFE disponível</span></div><div><strong>${num(coverage.danfeMissing)}</strong><span>DANFE pendente</span></div></div>${coverage.syncErrors ? `<p class="notice">${num(coverage.syncErrors)} documentos possuem erro de sincronização e serão tentados novamente.</p>` : ''}</article>`;
}
function nfeDrilldown(row, kind) {
  if (kind === 'company') {
    const company = xmlCompanies.find((item) => item.nome === row.name);
    return company
      ? href('clientes', {
          empresa: company.id,
          grupoClienteNfe: null,
          clienteNfe: null,
          vendedorNfe: null,
          produtoNfe: null
        })
      : null;
  }
  if (kind === 'customerGroup')
    return href('clientes', {
      grupoClienteNfe: row.id,
      clienteNfe: null,
      vendedorNfe: null,
      produtoNfe: null
    });
  if (kind === 'customer')
    return href('vendedores', { clienteNfe: row.id, vendedorNfe: null, produtoNfe: null });
  if (kind === 'seller') return href('emitidas', { vendedorNfe: row.name, produtoNfe: null });
  if (kind === 'product') {
    const company = xmlCompanies.find((item) => item.nome === row.company);
    return href('emitidas', {
      empresa: company?.id || null,
      grupoClienteNfe: null,
      produtoNfe: row.id,
      clienteNfe: null,
      vendedorNfe: null
    });
  }
  return null;
}
function nfeTrail() {
  const p = state.params;
  const parts = [
    link('dashboard', 'Grupo', {
      empresa: null,
      grupoClienteNfe: null,
      clienteNfe: null,
      vendedorNfe: null,
      produtoNfe: null
    })
  ];
  const company = xmlCompanies.find((row) => String(row.id) === p.get('empresa'));
  if (company)
    parts.push(
      link('clientes', company.nome, {
        grupoClienteNfe: null,
        clienteNfe: null,
        vendedorNfe: null,
        produtoNfe: null
      })
    );
  if (p.get('grupoClienteNfe'))
    parts.push(
      link('clientes', state.nfeData.scope.customerGroupName || p.get('grupoClienteNfe'), {
        clienteNfe: null,
        vendedorNfe: null,
        produtoNfe: null
      })
    );
  if (p.get('clienteNfe'))
    parts.push(
      link('vendedores', state.nfeData.scope.customerName || p.get('clienteNfe'), {
        vendedorNfe: null,
        produtoNfe: null
      })
    );
  if (p.get('vendedorNfe'))
    parts.push(link('emitidas', p.get('vendedorNfe'), { produtoNfe: null }));
  if (p.get('produtoNfe')) parts.push(link('emitidas', `Produto ${p.get('produtoNfe')}`));
  return `<nav class="nfe-trail" aria-label="Caminho dos documentos">${parts.join('<span aria-hidden="true">›</span>')}</nav>`;
}
function metricPanel(title, value, note) {
  return `<div class="metric-line"><span>${esc(title)}<small>${esc(note)}</small></span><strong>${money(value)}</strong></div>`;
}
function averagePanel(data, label = 'documentos emitidos') {
  const avg = periodAverages(data, today());
  return `<article class="panel analytic-panel">${panelHead(`Médias de ${label}`, `${avg.elapsed} dias corridos · ${avg.business} dias úteis (segunda a sexta) · ${avg.selling} dias com NF-e`)}${metricPanel('Por dia corrido', avg.daily, 'Valor total ÷ dias transcorridos')}${avg.business ? metricPanel('Por dia útil', avg.businessDaily, 'Valor total ÷ dias de segunda a sexta') : ''}${avg.selling ? metricPanel('Por dia com emissão', avg.sellingDaily, 'Valor total ÷ dias com NF-e') : ''}${metricPanel('Por semana', avg.weekly, 'Média diária × 7 dias')}${metricPanel('Por mês', avg.monthly, 'Média diária × 30,4375 dias')}</article>`;
}
function forecastPanel(data, comparison = null, returnValue = null) {
  if (!data) return '';
  const forecast = monthForecast(data, today());
  if (!forecast) return '';
  const change = comparison?.value ? (data.value / comparison.value - 1) * 100 : null;
  const projectedReturn =
    returnValue == null
      ? null
      : Math.round(
          (returnValue / forecast.elapsed) * (forecast.elapsed + forecast.remaining) * 100
        ) / 100;
  return `<article class="panel analytic-panel forecast-panel">${panelHead('Fechamento do mês', `${today().slice(0, 7)} · projeção gerencial`)}<div class="forecast-main"><div><small>VENDAS FINANCEIRAS REALIZADAS</small><strong>${money(forecast.actual)}</strong></div><div><small>VENDAS FINANCEIRAS PROJETADAS</small><strong>${money(forecast.projected)}</strong></div></div>${projectedReturn == null ? '' : `<div class="forecast-returns"><span>Devoluções projetadas <strong>${money(projectedReturn)}</strong></span><span>Faturamento real projetado <strong>${money(Math.max(0, forecast.projected - projectedReturn))}</strong></span></div>`}<div class="forecast-range">Cenários de vendas financeiras: ${money(forecast.conservative)} a ${money(forecast.optimistic)}</div>${change === null ? '' : `<p>Ritmo ante os mesmos ${forecast.elapsed} dias do mês anterior: <strong>${change >= 0 ? '+' : ''}${num(change)}%</strong>.</p>`}<p class="formula-note">Vendas financeiras emitidas no mês + dias restantes × média por dia corrido; cenários ±10% sobre a parcela futura. ${projectedReturn == null ? '' : 'Devoluções extrapoladas pelo ritmo do mês; cobertura parcial da SEFAZ limita a estimativa.'} Sem pedidos em carteira.</p></article>`;
}
function monthWithin(data) {
  const first = `${today().slice(0, 7)}-01`;
  if (data.period.inicio > first || data.period.fim < today()) return null;
  const daily = data.daily.filter((row) => row.date >= first && row.date <= today());
  return {
    period: { inicio: first, fim: today() },
    daily,
    value: daily.reduce((sum, row) => sum + Number(row.saleValue || 0), 0)
  };
}
function revenueDashboard() {
  const data = state.nfeData;
  const falco = maserpMetrics(data);
  const month = state.monthData;
  const received = state.incomingData?.returns;
  const returned = received?.linkedToSaleValue || 0;
  const net = data.saleValue - returned;
  const hasFalcoPeriod = Boolean(falco?.comparable && falco.commercialRows.length);
  const performance = commercialPerformance(
    data,
    state.incomingData,
    state.targets || [],
    { start: data.period.inicio, end: data.period.fim, horizon: data.period.fim },
    state.params.get('empresa') || null
  );
  const daily = performance.daily;
  const maxCumulative = Math.max(
    1,
    ...daily.map((row) => Math.max(row.cumulative, row.target || 0))
  );
  const cx = (index) => 54 + (index / Math.max(1, daily.length - 1)) * 600;
  const cy = (value) => 170 - (value / maxCumulative) * 135;
  const cumulativePath = daily
    .map(
      (row, index) => `${index ? 'L' : 'M'}${cx(index).toFixed(1)} ${cy(row.cumulative).toFixed(1)}`
    )
    .join(' ');
  const targetPath = daily.every((row) => row.target !== null)
    ? daily
        .map(
          (row, index) => `${index ? 'L' : 'M'}${cx(index).toFixed(1)} ${cy(row.target).toFixed(1)}`
        )
        .join(' ')
    : '';
  const other = (data.operations || [])
    .filter((row) => !['sale', 'return'].includes(row.type))
    .reduce((sum, row) => sum + row.value, 0);
  $('#page').innerHTML =
    head(
      'Faturamento documentado',
      'NF-e de venda por data de emissão. O relatório Falco por data do pedido exige conciliação com pedidos, faturados e não faturados.',
      'MaxCompany / Faturamento'
    ) +
    nfeSource(data, true) +
    maserpReportPanel(data) +
    `<section class="kpis">${kpi(hasFalcoPeriod ? 'Faturado no Falco' : 'Vendas financeiras nos XMLs', bigMoney(hasFalcoPeriod ? falco.billed : data.saleValue), hasFalcoPeriod ? (falco.profitabilityAvailable ? `Lucro Falco ${money(falco.profitabilityProfit)} · ${num(falco.profitabilityMarkup)}% sobre custo` : 'Lucratividade aguardando sincronização') : `${money(data.saleValue)} em itens elegíveis`, 'wallet', true, href('dashboard'), hasFalcoPeriod ? 'Faturamento comercial e lucro do Relatório de Lucratividade do Falco.' : 'Itens dos XMLs classificados pelos CFOPs financeiros.')}${kpi(hasFalcoPeriod ? 'Venda em pedidos' : 'Saldo gerencial dos XMLs', bigMoney(hasFalcoPeriod ? falco.sales : net), hasFalcoPeriod ? `Markup ${num(falco.salesMarkup)}% · ${money(falco.salesWithoutRotation)} sem giro` : 'Vendas financeiras menos devoluções vinculadas', 'trend', false, href('dashboard'))}${kpi(hasFalcoPeriod ? 'NF-e emitidas no Falco' : 'Valor fiscal emitido', bigMoney(hasFalcoPeriod ? falco.gross : data.value), hasFalcoPeriod ? `${num(falco.invoices)} notas · antes das devoluções` : 'Não equivale a faturamento', 'document', false, 'emitidas')}${kpi(hasFalcoPeriod ? 'Saldo fiscal após devolução' : 'Devoluções financeiras', bigMoney(hasFalcoPeriod ? falco.net : returned), hasFalcoPeriod ? `${money(falco.returned)} devolvidos no Falco` : `${num(received?.financialLinkedCount || 0)} confirmadas`, 'box', false, 'devolucoes')}</section>` +
    `<section class="kpis compact-kpis">${kpi('Itens financeiros nos XMLs', bigMoney(data.saleValue), 'Classificação item a item pelos CFOPs definidos', 'trend', false, href('emitidas', { operacao: 'venda', efeito: 'financeiro' }))}${kpi('Devoluções captadas no SEFAZ', bigMoney(returned), `${num(received?.financialLinkedCount || 0)} vínculos confirmados`, 'document', false, href('devolucoes'))}${kpi('Sem efeito financeiro', bigMoney(data.nonFinancialValue || 0), 'Remessas, transferências e operações fora da regra', 'box', false, href('emitidas', { efeito: 'nao-financeiro' }))}${kpi('Pendente de classificação', bigMoney(data.pendingClassificationValue || 0), 'Sem CFOP ou diferença sem rateio', 'target', false, href('emitidas', { efeito: 'pendente' }))}</section>` +
    `<article class="panel nfe-trend">${panelHead('Faturamento real acumulado', targetPath ? 'Azul: realizado · verde: meta acumulada' : 'Realizado acumulado · defina uma meta para comparar')}<svg class="nfe-line-chart" viewBox="0 0 710 205" role="img" aria-label="Faturamento real acumulado e meta"><line x1="54" x2="654" y1="170" y2="170" stroke="#d9e0e5"/><path d="${cumulativePath}" fill="none" stroke="var(--accent)" stroke-width="3"/>${targetPath ? `<path d="${targetPath}" fill="none" stroke="#13986f" stroke-width="3"/>` : ''}${daily.map((row, index) => `<circle cx="${cx(index)}" cy="${cy(row.cumulative)}" r="2.5" fill="var(--accent)"><title>${date(row.date)} · realizado ${money(row.cumulative)}${row.target === null ? '' : ` · meta ${money(row.target)}`}</title></circle>`).join('')}</svg></article>` +
    fiscalEventCards(data, state.incomingData) +
    `<div class="revenue-equation"><span>${money(data.saleValue)} <small>vendas faturadas</small></span><b>−</b><span>${money(returned)} <small>devoluções ligadas à venda</small></span><b>=</b><strong>${money(net)}</strong></div>` +
    `<div class="notice">Do valor fiscal emitido, ${money(data.returns.value)} são devoluções emitidas a fornecedores. Os itens sem efeito financeiro e as diferenças sem rateio ficam fora das vendas financeiras. ${num((received?.count || 0) - (received?.financialLinkedCount || 0))} devoluções recebidas aguardam vínculo ou conciliação financeira; ${num(state.incomingData?.summaryOnlyCount || 0)} entradas estão apenas em resumo.</div>` +
    `<div class="nfe-charts nfe-charts-secondary">${reconciliationPanel(data)}${coveragePanel(data)}</div>` +
    purchaseMatchPanel(data, state.purchaseHistory) +
    `<div class="nfe-charts nfe-charts-secondary">${averagePanel({ ...data, value: data.saleValue })}${forecastPanel(month ? { ...month, value: month.saleValue } : null, state.previousMonthData ? { ...state.previousMonthData, value: state.previousMonthData.saleValue } : null, state.monthIncomingData?.returns?.linkedToSaleValue ?? null)}</div>` +
    `<div class="nfe-charts nfe-charts-secondary">${nfeRanking('Vendedores', 'Valor das NF-e atribuído no XML', data.sellers, false, 12, 'seller')}${nfeRanking('Grupos de clientes', 'Valor consolidado dos CNPJs', data.customerGroups, false, 12, 'customerGroup')}</div>` +
    `<article class="panel analytic-panel">${panelHead('Composição documentada', 'Valores informados no total da NF-e')}${metricPanel('Descontos', data.discountValue, 'vDesc dos XMLs')}${metricPanel('Frete destacado', data.freightValue, 'vFrete dos XMLs')}${metricPanel('Ticket médio por NF-e', data.invoiceCount ? data.value / data.invoiceCount : 0, 'Valor total ÷ NF-e')}</article>` +
    `<p class="nfe-note">A venda financeira é calculada por item e CFOP elegível. O saldo usa devoluções recebidas com referência confirmada a venda integralmente financeira da mesma empresa e do mesmo CNPJ. Cancelamentos já estão excluídos e não são abatidos outra vez. O markup de referência cobre apenas itens com compra anterior conciliada; não representa margem contábil.</p>`;
}
function fiscalEventCards(outgoing, incoming) {
  const returns = incoming?.returns || {};
  return `<section class="fiscal-event-grid" aria-label="Devoluções e cancelamentos"><a class="fiscal-event-card return" href="${esc(href('devolucoes'))}"><span>Devoluções financeiras confirmadas</span><strong>${money(returns.linkedToSaleValue || 0)}</strong><small>${num(returns.financialLinkedCount || 0)} financeiras · ${num(Math.max(0, (returns.count || 0) - (returns.financialLinkedCount || 0)))} para conciliar</small><b>Examinar devoluções →</b></a><a class="fiscal-event-card cancel" href="${esc(href('canceladas'))}"><span>NF-e emitidas canceladas</span><strong>${money(outgoing.canceledValue || 0)}</strong><small>${num(outgoing.canceledCount || 0)} notas · ${money(outgoing.canceledSaleValue || 0)} em vendas canceladas</small><b>Abrir notas canceladas →</b></a></section>`;
}
function dreDashboard() {
  const sales = Number(state.nfeData?.saleValue || 0);
  const returns = Number(state.incomingData?.returns?.linkedToSaleValue || 0);
  const net = sales - returns;
  const match = state.purchaseHistory
    ? reconcilePurchases(state.nfeData, state.purchaseHistory, { equivalences: state.equivalences })
    : null;
  const row = (label, value, detail, target = '') =>
    `<div class="dre-row"><div><strong>${esc(label)}</strong><small>${esc(detail)}</small></div><b>${money(value)}</b>${target ? `<a href="${esc(href(target))}">Ver origem →</a>` : ''}</div>`;
  $('#page').innerHTML =
    head(
      'DRE gerencial · base documental',
      'Conciliação de NF-e por empresa e período. Resultado contábil depende de custos, despesas e tributos que não constam integralmente nos XMLs.',
      'MaxCompany / Gestão'
    ) +
    nfeSource(state.nfeData, true) +
    `<section class="kpis">${kpi('Vendas faturadas', bigMoney(sales), money(sales), 'trend', true, href('emitidas', { operacao: 'venda' }))}${kpi('Devoluções vinculadas', bigMoney(returns), money(returns), 'document', false, 'devolucoes')}${kpi('Receita após devoluções', bigMoney(net), money(net), 'wallet')}${kpi('Compras no período', bigMoney(state.incomingData?.purchaseValue || 0), 'Movimento de compras; não é CMV', 'box', false, 'entradas')}</section>` +
    fiscalEventCards(state.nfeData, state.incomingData) +
    `<article class="panel dre-panel">${panelHead('Ponte de receita', 'Valores confirmados nos documentos do período')}${row('(+) Vendas autorizadas', sales, 'NF-e de saída com CFOP de venda; canceladas excluídas', 'emitidas')}${row('(−) Devoluções de clientes', -returns, 'Somente entradas vinculadas à venda válida', 'devolucoes')}${row('(=) Receita após devoluções', net, 'Saldo documental, anterior a impostos, custos e despesas')}${row('Cancelamentos identificados', state.nfeData.canceledSaleValue || 0, 'Informativo: já excluídos das vendas, sem novo abatimento', 'emitidas')}</article>` +
    `<article class="panel dre-panel">${panelHead('Custos e resultado', 'Acompanhamento sem estimar dados ausentes')}${row('Compras documentadas', state.incomingData?.purchaseValue || 0, 'Entradas por CFOP de venda do fornecedor; não equivalem ao custo vendido', 'entradas')}${match?.purchaseReferenceValue ? row('Preço de compra de itens conciliados', match.purchaseReferenceValue, `${num(match.matchedLines)} de ${num(match.saleLines)} linhas vendidas conciliadas; referência parcial`) : '<div class="dre-pending">Preço de compra das vendas: sem cobertura suficiente para apurar CMV.</div>'}<div class="dre-pending">CMV, tributos sobre receita, despesas operacionais, despesas financeiras e IR/CSLL: aguardam lançamentos contábeis ou fiscais conciliados. O resultado líquido não é calculado.</div></article>` +
    purchaseMatchPanel(state.nfeData, state.purchaseHistory) +
    `<p class="nfe-note">Período pela emissão da NF-e. A linha de compras é movimento de entrada, não despesa do DRE. Cancelamentos e devoluções de fornecedores não são vendas. Este painel não substitui o DRE contábil nem afirma lucro ou Mk.B % com cobertura parcial.</p>`;
}
function purchaseMatchPanel(outgoing, incoming) {
  if (!incoming)
    return `<article class="panel purchase-match"><h2>Entradas × saídas</h2><p>Histórico de compras temporariamente indisponível. Nenhum custo foi estimado.</p></article>`;
  const result = reconcilePurchases(outgoing, incoming, { equivalences: state.equivalences });
  const suggestions = purchaseSuggestions(outgoing, incoming, state.equivalences);
  const ids = {
    MaxPlast: 1,
    MaxSafety: 2,
    MaxSupply: 3,
    'MaxSupply - Filial ES': 4,
    'MaxSupply · Filial ES': 4
  };
  const open = (row, type, key) =>
    `<button type="button" class="text-button" data-invoice="${esc(key)}" data-invoice-type="${type}" data-invoice-company="${row.saleCompanyId || ids[row.saleCompany] || ''}">Abrir NF-e</button>`;
  return `<article class="panel purchase-match">${panelHead('Entradas × saídas', 'Preço de compra documentado confrontado com itens vendidos no mesmo CNPJ')}
    <div class="purchase-match-stats"><div><span>Itens vendidos</span><strong>${num(result.saleLines)}</strong></div><div><span>Correspondência comprovável</span><strong>${num(result.matchedLines)}</strong><small>${result.saleLines ? num((result.matchedLines / result.saleLines) * 100) : '0'}% dos itens</small></div><div><span>Sem correspondência</span><strong>${num(result.unmatchedLines)}</strong></div><div><span>Compra mais recente com preços divergentes</span><strong>${num(result.ambiguousLines)}</strong></div></div>
    <div class="purchase-match-note"><strong>Markup de referência dos itens conciliados: ${result.purchaseReferenceValue > 0 ? `${num((result.matchedSaleValue / result.purchaseReferenceValue - 1) * 100)}%` : 'Não calculável'}</strong><p>Diferença parcial: ${result.matchedLines ? money(result.difference) : 'Não calculável'}. Somente ${money(result.matchedSaleValue)} em itens vendidos tiveram correspondência; preço de referência de compra ${money(result.purchaseReferenceValue)}. Isto não é lucro, custo de estoque nem margem contábil. Não inclui frete, tributos recuperáveis, despesas, descontos fora do item ou lote efetivamente baixado.</p></div>
    ${
      result.matches.length
        ? `<div class="purchase-match-table"><table><thead><tr><th>Produto vendido</th><th>Venda</th><th>Compra de referência</th><th>Critério</th><th>Documentos</th></tr></thead><tbody>${result.matches
            .slice(0, 50)
            .map(
              (row) =>
                `<tr><td><strong>${esc(row.itemName)}</strong><small>${esc(row.ncm)} · ${num(row.quantity)} ${esc(row.unit)}</small></td><td>${money(row.saleValue)}<small>${date(row.saleDate)}</small></td><td>${money(row.purchaseReferenceValue)}<small>${date(row.purchaseDate)} · ${esc(row.supplier)}</small></td><td>${esc(row.basis)}</td><td>${open(row, 'saida', row.saleKey)}<button type="button" class="text-button" data-invoice="${esc(row.purchaseKey)}" data-invoice-type="entrada" data-invoice-company="${ids[row.saleCompany] || ''}">Abrir compra</button></td></tr>`
            )
            .join('')}</tbody></table></div>`
        : '<p>Não há itens com chave de produto compatível entre as compras e vendas deste recorte.</p>'
    }
    <h3>Possíveis equivalências para validar</h3><p>Descrições parecidas são sugestões e ficam fora do cálculo até aprovação. Empresa, NCM e unidade já coincidem.</p>${
      suggestions.length
        ? `<div class="purchase-match-table"><table><thead><tr><th>Produto na saída</th><th>Produto na entrada</th><th>Semelhança</th><th>Ação</th></tr></thead><tbody>${suggestions
            .slice(0, 20)
            .map(({ sale, item, purchase, purchaseItem, score }) => {
              const body = {
                companyId: Number(sale.companyId) || ids[sale.company],
                saleCode: item.code,
                saleName: item.name,
                supplierId: purchase.supplier?.id,
                purchaseCode: purchaseItem.code,
                purchaseName: purchaseItem.name,
                ncm: item.ncm,
                unit: item.unit
              };
              return `<tr><td><strong>${esc(item.name)}</strong><small>Código ${esc(item.code)} · NCM ${esc(item.ncm)} · ${esc(item.unit)}</small></td><td><strong>${esc(purchaseItem.name)}</strong><small>${esc(purchase.supplier?.name)} · Código ${esc(purchaseItem.code)} · ${date(purchase.date)}</small></td><td>${num(score * 100)}%</td><td><button type="button" class="button quiet" data-equivalence='${esc(JSON.stringify(body))}'>Aprovar equivalência</button></td></tr>`;
            })
            .join('')}</tbody></table></div>`
        : '<p>Nenhuma sugestão suficientemente próxima neste período.</p>'
    }
    ${state.equivalences.length ? `<details class="purchase-approved"><summary>Equivalências aprovadas (${num(state.equivalences.length)})</summary><div class="purchase-match-table"><table><thead><tr><th>Produto de saída</th><th>Produto de entrada</th><th>NCM / unidade</th><th></th></tr></thead><tbody>${state.equivalences.map((row) => `<tr><td>${esc(row.sale_name)}<small>${esc(row.sale_code)}</small></td><td>${esc(row.purchase_name)}<small>${esc(row.purchase_code)} · fornecedor ${esc(row.purchase_supplier_id)}</small></td><td>${esc(row.ncm)} · ${esc(row.unit)}</td><td><button type="button" class="text-button" data-equivalence-delete="${esc(row.id)}">Revogar</button></td></tr>`).join('')}</tbody></table></div></details>` : ''}
    <p class="nfe-note">A correspondência exige mesma empresa, GTIN informado, descrição exata ou equivalência aprovada, NCM, unidade e compra anterior à venda nos últimos 365 dias. Devoluções, remessas e XMLs apenas resumidos não entram como compras. O código do produto do fornecedor não é considerado igual ao código interno sem aprovação.</p></article>`;
}
async function loadPurchaseHistory(params) {
  const start = params.get('inicio') || `${today().slice(0, 7)}-01`;
  const end = params.get('fim') || today();
  const from = new Date(Date.parse(`${start}T12:00:00Z`) - 365 * 86400000)
    .toISOString()
    .slice(0, 10);
  const query = new URLSearchParams({ inicio: from, fim: end });
  if (params.get('empresa')) query.set('empresa', params.get('empresa'));
  const scope = query.toString();
  if (state.purchaseHistoryScope === scope && Date.now() - state.purchaseHistoryAt < 120000)
    return state.purchaseHistory;
  try {
    const history = await fetchJson(`/api/falco/entradas?${query}`);
    state.purchaseHistory = history;
    state.purchaseHistoryScope = scope;
    state.purchaseHistoryAt = Date.now();
    return history;
  } catch {
    state.purchaseHistory = null;
    return null;
  }
}
async function loadEquivalences() {
  if (Date.now() - state.equivalencesAt < 120000) return state.equivalences;
  try {
    state.equivalences = await fetchJson('/api/commercial/equivalences');
    state.equivalencesAt = Date.now();
  } catch {
    state.equivalences = [];
  }
  return state.equivalences;
}
function returnsDashboard() {
  const outgoing = state.nfeData;
  const incoming = state.incomingData;
  const issued = outgoing.returns;
  const received = incoming.returns;
  const total = issued.value + received.value;
  const dates = outgoing.daily.map((day) => ({ date: day.date, sale: day.saleValue || 0 }));
  const receivedByDate = new Map();
  for (const row of received.documents.filter((row) => confirmedFinancialReturn(row) > 0))
    receivedByDate.set(
      row.date,
      (receivedByDate.get(row.date) || 0) + confirmedFinancialReturn(row)
    );
  const maxGross = Math.max(1, ...dates.map((row) => row.sale));
  const maxReturn = Math.max(1, ...dates.map((row) => receivedByDate.get(row.date) || 0));
  const x = (index) => 50 + (index / Math.max(1, dates.length - 1)) * 610;
  const y = (value, max) => 180 - (value / max) * 140;
  const line = (field, max) =>
    dates
      .map(
        (row, index) =>
          `${index ? 'L' : 'M'}${x(index).toFixed(1)} ${y(field(row), max).toFixed(1)}`
      )
      .join(' ');
  const groups = new Map();
  const sellers = new Map();
  for (const row of issued.documents) {
    const key = row.customer.id || row.customer.name;
    const group = groups.get(key) || { name: row.customer.name, id: key, count: 0, value: 0 };
    group.count++;
    group.value += row.value;
    groups.set(key, group);
    if (row.seller) {
      const seller = sellers.get(row.seller) || { name: row.seller, count: 0, value: 0 };
      seller.count++;
      seller.value += row.value;
      sellers.set(row.seller, seller);
    }
  }
  for (const row of received.documents) {
    const key = row.supplier.id || row.supplier.name;
    const group = groups.get(key) || { name: row.supplier.name, id: key, count: 0, value: 0 };
    group.count++;
    group.value += row.value;
    groups.set(key, group);
  }
  const ranked = (map) => [...map.values()].sort((a, b) => b.value - a.value);
  const rank = (title, rows) =>
    `<article class="panel returns-rank">${panelHead(title, 'Documentos classificados como devolução')}<div>${
      rows.length
        ? rows
            .slice(0, 12)
            .map(
              (row) =>
                `<div class="returns-rank-row"><span>${esc(row.name)}<small>${num(row.count)} NF-e</small></span><strong>${money(row.value)}</strong></div>`
            )
            .join('')
        : '<p class="note">Nenhum registro identificado neste recorte.</p>'
    }</div></article>`;
  $('#page').innerHTML =
    head(
      'Devoluções',
      'NF-e de devolução identificadas nas saídas do Falco e nas entradas da SEFAZ.',
      'MaxCompany / Faturamento'
    ) +
    nfeSource(outgoing, true) +
    `<section class="kpis">${kpi('Devoluções de compra emitidas', bigMoney(issued.value), `${num(issued.count)} NF-e a fornecedores`, 'wallet', true, href('emitidas', { operacao: 'devolucao' }))}${kpi('Devoluções recebidas', bigMoney(received.value), `${num(received.count)} NF-e com XML completo`, 'document', false, href('recebidas', { operacao: 'devolucao' }))}${kpi('Ligadas a vendas', bigMoney(received.linkedToSaleValue), `${num(received.linkedToSaleCount)} NF-e com referência confirmada`, 'trend', false, href('recebidas', { operacao: 'vinculada' }))}${kpi('Índice sobre vendas', `${num(outgoing.saleValue ? (received.linkedToSaleValue / outgoing.saleValue) * 100 : 0)}%`, 'Somente devoluções vinculadas', 'target')}</section>` +
    `<div class="returns-origin"><a href="${esc(href('emitidas', { operacao: 'devolucao' }))}"><strong>${money(issued.value)}</strong><span>Saída para fornecedor · não é venda</span>${icon('arrow')}</a><a href="${esc(href('recebidas', { operacao: 'devolucao' }))}"><strong>${money(received.value)}</strong><span>Entrada classificada como devolução · ${money(received.linkedToSaleValue)} vinculados a venda</span>${icon('arrow')}</a></div>` +
    `<article class="panel returns-chart">${panelHead('Vendas faturadas × devoluções de clientes vinculadas', 'Evolução diária · escalas independentes para leitura das duas séries')}<div class="returns-legend"><span>Vendas faturadas</span><span>Devoluções vinculadas</span></div><svg viewBox="0 0 710 210" role="img" aria-label="Evolução diária das vendas e devoluções vinculadas em escalas independentes"><path d="${line((row) => row.sale, maxGross)}" class="returns-gross-line"/><path d="${line((row) => receivedByDate.get(row.date) || 0, maxReturn)}" class="returns-return-line"/>${dates.map((row, index) => `<circle cx="${x(index)}" cy="${y(receivedByDate.get(row.date) || 0, maxReturn)}" r="3" class="returns-point"><title>${date(row.date)} · Vendas ${money(row.sale)} · Devoluções vinculadas ${money(receivedByDate.get(row.date) || 0)}</title></circle>`).join('')}</svg></article>` +
    `<div class="nfe-charts nfe-charts-secondary">${rank('Contrapartes dos documentos', ranked(groups))}${rank('Vendedor informado nas devoluções de compra emitidas', ranked(sellers))}</div>` +
    `<article class="panel document-panel">${panelHead('NF-e de devolução emitidas', 'Abra uma nota para ver itens, CFOP, XML e DANFE')}${documentRows(issued.documents, 'saida')}</article>` +
    `<article class="panel document-panel">${panelHead('NF-e de devolução recebidas', 'Classificação disponível somente nos XMLs completos')}${documentRows(received.documents, 'entrada')}</article>` +
    `<p class="nfe-note">${num(received.incompleteCount)} entradas estão somente em resumo; elas podem conter outras devoluções. ${num(received.count - received.linkedToSaleCount)} devoluções recebidas não têm venda de referência confirmada. Devoluções de compra emitidas não são descontadas das vendas. Atribuição de responsabilidade, lucro e margem exigem conciliação com pedidos e custos.</p>`;
}
function taxDashboard() {
  const data = state.nfeData;
  const incoming = state.incomingData;
  const [selectedOrigin, selected] = (state.selectedTax || '').split(':');
  const taxes = Object.entries(data.taxes).filter(([, amount]) => amount > 0);
  const incomingTaxes = Object.entries(incoming.taxes).filter(([, amount]) => amount > 0);
  const docs = selected
    ? (selectedOrigin === 'entrada' ? incoming.documents : data.documents).filter(
        (row) => row.taxes?.[selected] > 0
      )
    : [];
  const incomingByCompany = xmlCompanies
    .map((company) => {
      const rows = incoming.documents.filter((row) => row.company === company.nome && row.taxes);
      return {
        name: company.nome,
        full: rows.length,
        icms: rows.reduce((sum, row) => sum + (row.taxes.ICMS || 0), 0),
        ipi: rows.reduce((sum, row) => sum + (row.taxes.IPI || 0), 0),
        pis: rows.reduce((sum, row) => sum + (row.taxes.PIS || 0), 0),
        cofins: rows.reduce((sum, row) => sum + (row.taxes.COFINS || 0), 0)
      };
    })
    .filter(
      (row) =>
        !state.params.has('empresa') ||
        Number(state.params.get('empresa')) ===
          xmlCompanies.find((company) => company.nome === row.name)?.id
    );
  const taxRow = ([name, value], origin) =>
    `<button class="tax-row ${selected === name && selectedOrigin === origin ? 'active' : ''}" data-tax="${esc(origin)}:${esc(name)}"><span>${esc(name)}</span><strong>${money(value)}</strong></button>`;
  $('#page').innerHTML =
    head(
      'Impostos destacados',
      'Tributos extraídos item a item dos XMLs fiscais.',
      'MaxCompany / Fiscal'
    ) +
    `<div class="nfe-source"><span class="nfe-live">Fonte: XMLs autorizados e distribuição SEFAZ</span><span>Saídas ${data.invoiceCount} NF-e · Entradas ${incoming.fullXmlCount} XMLs completos</span></div>` +
    `<section class="kpis">${kpi('Crédito ICMS informado ao cliente', data.simpleIcmsCreditDocumentCount ? bigMoney(data.simpleIcmsCredit) : 'Não informado', `${num(data.simpleIcmsCreditDocumentCount)} NF-e com vCredICMSSN`, 'wallet', true)}${kpi('ICMS destacado nas entradas', bigMoney(incoming.taxes.ICMS || 0), `${num(incoming.fullXmlCount)} XMLs completos`, 'document')}${kpi('IPI destacado nas entradas', bigMoney(incoming.taxes.IPI || 0), 'Documentos recebidos', 'document')}${kpi('XMLs ainda em resumo', num(incoming.summaryOnlyCount), 'Sem dados de itens e tributos', 'target')}</section>` +
    `<article class="panel tax-panel">${panelHead('Entradas por empresa', 'Valores destacados em XMLs completos; não representam crédito apropriado')}<div class="tax-company-table"><div class="tax-company-head"><strong>Empresa</strong><strong>XMLs</strong><strong>ICMS</strong><strong>IPI</strong><strong>PIS</strong><strong>COFINS</strong></div>${incomingByCompany.map((row) => `<a class="tax-company-row" href="${esc(href('impostos', { empresa: xmlCompanies.find((company) => company.nome === row.name)?.id }))}"><strong>${esc(row.name)}</strong><span>${num(row.full)}</span><span>${money(row.icms)}</span><span>${money(row.ipi)}</span><span>${money(row.pis)}</span><span>${money(row.cofins)}</span></a>`).join('')}</div></article>` +
    `<article class="panel tax-panel">${panelHead('Regime nos XMLs de saída', 'CRT informado pelo emitente nas notas do período')}<div class="tax-regime-list">${data.taxRegimes.map((row) => `<a href="${esc(href('impostos', { empresa: xmlCompanies.find((company) => company.nome === row.name)?.id }))}"><strong>${esc(row.name)}</strong><span>${money(row.value)} · ${num(row.simples)} NF-e Simples · ${num(row.normal)} NF-e regime normal</span></a>`).join('')}</div><p class="formula-note">Nas empresas do Simples, o valor vCredICMSSN é crédito informado ao destinatário, não crédito tomado pela própria empresa.</p></article>` +
    `<div class="nfe-charts nfe-charts-secondary"><article class="panel tax-panel">${panelHead('Nas NF-e emitidas', 'Clique em um tributo para rastrear as notas')}${taxes.map((row) => taxRow(row, 'saida')).join('')}</article><article class="panel tax-panel">${panelHead('Nas NF-e recebidas', 'Valores destacados nos XMLs completos')}${incomingTaxes.map((row) => taxRow(row, 'entrada')).join('')}</article></div>` +
    (selected
      ? `<article class="panel document-panel">${panelHead(`${selected} nas NF-e ${selectedOrigin === 'entrada' ? 'recebidas' : 'emitidas'}`, `${docs.length} notas com destaque · total ${money((selectedOrigin === 'entrada' ? incoming : data).taxes[selected])}`)}${documentRows(docs, selectedOrigin === 'entrada' ? 'entrada' : 'saida')}</article>`
      : '') +
    `<p class="nfe-note">Crédito efetivamente apropriado exige a escrituração/apuração fiscal; a pasta SPED consultada não contém arquivos de apuração. Os totais das entradas são apenas destaques dos XMLs completos, sem avaliação de direito ao crédito. No Simples Nacional, vCredICMSSN indica crédito informado ao comprador, sujeito às condições legais. Resumos da SEFAZ ficam fora dos totais tributários.</p>`;
}
function freightDashboard() {
  const data = state.nfeData;
  const documented = data.documents.filter((row) => row.freight.value > 0);
  $('#page').innerHTML =
    head(
      'Fretes nas NF-e',
      'Valores e modalidades registrados nas notas emitidas.',
      'MaxCompany / Fretes'
    ) +
    nfeSource(data, true) +
    `<section class="kpis">${kpi('Frete destacado', bigMoney(data.freightValue), money(data.freightValue), 'wallet', true)}${kpi('Notas com frete', num(documented.length), 'vFrete maior que zero', 'document')}${kpi('Frete / NF-e', bigMoney(data.invoiceCount ? data.freightValue / data.invoiceCount : 0), 'Sobre todas as notas', 'trend')}${kpi('Frete / valor das notas', `${num(data.value ? (100 * data.freightValue) / data.value : 0)}%`, 'vFrete ÷ vNF', 'target')}</section>` +
    `<div class="nfe-charts nfe-charts-secondary">${nfeRanking('Modalidade declarada', 'modFrete do XML · valor destacado', data.freightModalities, false, 8)}${nfeRanking('Transportadoras identificadas', 'vFrete das notas vinculadas', data.carriers, false, 12)}</div>` +
    `<article class="panel document-panel">${panelHead('Notas com frete', 'Clique para ver transportadora, modalidade e XML')}${documentRows(documented, 'saida')}</article>` +
    `<p class="nfe-note">CIF e FOB seguem a modalidade declarada no XML. vFrete é o valor destacado na nota e não comprova desembolso financeiro da empresa ou custo logístico líquido.</p>`;
}
function outgoingDocuments() {
  const data = state.nfeData;
  const operation =
    state.view === 'canceladas' ? 'canceladas' : state.params.get('operacao') || 'todos';
  const operationTypes = {
    venda: 'sale',
    devolucao: 'return',
    industrial: 'industrial-return',
    transfer: 'transfer',
    bonus: 'bonus',
    complementary: 'complementary',
    adjustment: 'adjustment',
    mixed: 'mixed',
    other: 'other',
    unknown: 'unknown'
  };
  const filtered = (
    operation === 'canceladas' ? data.canceledDocuments || [] : data.documents
  ).filter(
    (row) =>
      operation === 'todos' ||
      operation === 'canceladas' ||
      (operation === 'outras'
        ? !['sale', 'return', 'industrial-return'].includes(row.fiscalOperation?.type)
        : row.fiscalOperation?.type === operationTypes[operation])
  );
  const canceledByCompany = new Map();
  const canceledByDay = new Map();
  if (operation === 'canceladas')
    for (const row of filtered) {
      canceledByCompany.set(
        row.company,
        (canceledByCompany.get(row.company) || 0) + Number(row.value || 0)
      );
      canceledByDay.set(row.date, (canceledByDay.get(row.date) || 0) + Number(row.value || 0));
    }
  const canceledPanel =
    operation === 'canceladas'
      ? `<div class="nfe-charts"><article class="panel nfe-companies">${panelHead('Cancelamentos por empresa', 'Valor das NF-e canceladas, excluído do faturamento')}${[
          ...canceledByCompany.entries()
        ]
          .sort((a, b) => b[1] - a[1])
          .map(
            ([name, value]) =>
              `<a class="nfe-company nfe-company-link" href="${esc(href('canceladas', { empresa: xmlCompanies.find((company) => company.nome === name)?.id }))}"><div><strong>${esc(name)}</strong><span>${money(value)}</span></div><div class="nfe-bar"><span style="width:${(value / Math.max(1, ...canceledByCompany.values())) * 100}%"></span></div></a>`
          )
          .join(
            ''
          )}</article><article class="panel nfe-companies">${panelHead('Cancelamentos por dia', 'Clique para abrir as NF-e do período')}${[
          ...canceledByDay.entries()
        ]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(
            ([day, value]) =>
              `<a class="nfe-company nfe-company-link" href="${esc(href('canceladas', { inicio: day, fim: day }))}"><div><strong>${date(day)}</strong><span>${money(value)}</span></div><div class="nfe-bar"><span style="width:${(value / Math.max(1, ...canceledByDay.values())) * 100}%"></span></div></a>`
          )
          .join('')}</article></div>`
      : '';
  $('#page').innerHTML =
    head(
      operation === 'canceladas' ? 'NF-e canceladas' : 'NF-e emitidas',
      operation === 'canceladas'
        ? 'Valores e documentos cancelados, fora do faturamento real.'
        : 'Documentos autorizados encontrados nas pastas Falco.',
      'MaxCompany / Documentos'
    ) +
    nfeSource(data, true) +
    nfeTrail() +
    `<section class="kpis">${kpi('NF-e autorizadas', num(data.invoiceCount), 'Não canceladas · no período', 'document', true)}${kpi('Valor autorizado', bigMoney(data.value), money(data.value), 'wallet')}${kpi('Canceladas', num(data.canceledCount || 0), 'Eventos confirmados', 'target', false, href('emitidas', { operacao: 'canceladas' }))}${kpi('Valor cancelado', bigMoney(data.canceledValue || 0), `${money(data.canceledSaleValue || 0)} em vendas`, 'wallet', false, href('emitidas', { operacao: 'canceladas' }))}</section>` +
    canceledPanel +
    `<article class="panel document-panel">${panelHead('Notas', 'Clique para abrir itens, impostos, XML e DANFE')}<div class="document-filter"><label>Operação<select id="operation-filter"><option value="todos">Documentos autorizados</option><option value="canceladas">Notas canceladas</option><option value="venda">Somente vendas por CFOP</option><option value="devolucao">Devoluções de compra emitidas</option><option value="transfer">Transferências</option><option value="bonus">Bonificações</option><option value="complementary">Complementares</option><option value="adjustment">Ajustes</option><option value="industrial">Retornos de industrialização</option><option value="mixed">Operações mistas</option><option value="other">Outras operações classificadas</option><option value="unknown">Não classificadas</option><option value="outras">Todas exceto venda/devolução/retorno</option></select></label><span>${num(filtered.length)} notas na lista</span></div>${documentRows(filtered, 'saida')}</article>`;
  $('#operation-filter').value = operation;
  $('#operation-filter').onchange = (event) =>
    go('emitidas', { operacao: event.target.value === 'todos' ? null : event.target.value });
}
function searchDashboard(data = null) {
  const query = (state.params.get('q') || '').trim();
  const body = !query
    ? '<div class="search-empty">Digite o número ou a chave da NF-e, ou procure pelo nome de um cliente, vendedor, fornecedor ou produto.</div>'
    : !/^\d+$/.test(query) && query.length < 3
      ? '<div class="search-empty">Digite ao menos 3 letras para pesquisar.</div>'
      : data?.items.length
        ? `<div class="search-result-list">${data.items
            .map(
              (row) =>
                `<button class="search-result" data-invoice="${row.key}" data-invoice-type="${row.type}" data-invoice-company="${row.companyId}" data-invoice-canceled="${row.canceled ? 'true' : 'false'}"><span class="search-result-type">${esc(row.context || 'NF-e')} · ${row.type === 'saida' ? 'emitida' : 'recebida'}${row.canceled ? ' · Cancelada' : ''}</span><strong>NF-e ${esc(row.number)}/${esc(row.series)}</strong><span class="search-result-party">${esc(row.party)}</span><span class="search-result-detail">${esc(row.company)} · ${date(row.date)}${row.seller ? ` · ${esc(row.seller)}` : ''}</span><b>${money(row.value)}</b></button>`
            )
            .join('')}</div>`
        : '<div class="search-empty">Nenhuma NF-e encontrada. Confira o número, a série ou tente um nome.</div>';
  const offset = data?.offset || 0;
  const limit = data?.limit || 40;
  $('#page').innerHTML =
    head(
      'Busca global',
      'Encontre documentos e relações em todas as pastas consultadas, sem limite do período do dashboard.',
      'MaxCompany / Busca'
    ) +
    (data
      ? `<div class="search-count"><strong>${num(data.total)} ${data.total === 1 ? 'resultado' : 'resultados'}</strong><span>XMLs de saída do Falco${data.sources.includes('entrada') ? ' · Documentos da SEFAZ' : ''}</span></div>`
      : '') +
    body +
    (data?.total > limit
      ? `<nav class="search-pages" aria-label="Páginas da busca">${offset ? `<a class="button quiet" href="${esc(searchUrl(query, Math.max(0, offset - limit)))}">Anterior</a>` : ''}<span>${num(offset + 1)}–${num(Math.min(offset + limit, data.total))} de ${num(data.total)}</span>${offset + limit < data.total ? `<a class="button quiet" href="${esc(searchUrl(query, offset + limit))}">Próximos resultados</a>` : ''}</nav>`
      : '');
}
function incomingDocuments() {
  const data = state.incomingData;
  const eventRows = data.synchronization?.sefaz || data.sync || [];
  const eventTotal = eventRows.reduce((sum, row) => sum + Number(row.cancellationEvents || 0), 0);
  const operation = state.params.get('operacao') || 'todos';
  const filtered = (
    operation === 'canceladas' ? data.canceledDocuments || [] : data.documents
  ).filter(
    (row) =>
      operation === 'todos' ||
      operation === 'canceladas' ||
      (operation === 'devolucao'
        ? row.fiscalOperation?.type === 'return'
        : operation === 'vinculada'
          ? Boolean(row.saleReference)
          : operation === 'compra'
            ? row.full && row.fiscalOperation?.type === 'sale'
            : row.fiscalOperation?.type !== 'return')
  );
  $('#page').innerHTML =
    head(
      'NF-e recebidas',
      'Documentos distribuídos pela SEFAZ e XMLs de entrada importados pelo Falco.',
      'MaxCompany / Documentos'
    ) +
    `<div class="nfe-source"><span class="nfe-live">Fonte: SEFAZ e importações do Falco</span><span>${data.sourcesAvailable}/${data.sourcesTotal} empresas consultadas</span></div>` +
    (eventTotal
      ? `<article class="panel cancellation-events-panel">${panelHead('Eventos de cancelamento do destinatário', `${num(eventTotal)} XMLs encontrados nas pastas ligadas ao coletor SEFAZ`)}<div class="nfe-companies">${eventRows.map((row) => `<div class="nfe-company"><div><strong>${esc(row.name)}</strong><span>${num(row.cancellationEvents || 0)} arquivos de evento XML</span></div></div>`).join('')}</div><p class="nfe-note">Esses arquivos registram eventos de cancelamento recebidos pela SEFAZ. A quantidade de arquivos não é a mesma coisa que a quantidade ou o valor das notas canceladas, exibidos nos indicadores acima.</p></article>`
      : '') +
    `<section class="kpis">${kpi('NF-e recebidas', num(data.invoiceCount), 'Não canceladas · no período', 'document', true)}${kpi('Valor total', bigMoney(data.value), money(data.value), 'wallet')}${kpi('Canceladas', num(data.canceledCount || 0), money(data.canceledValue || 0), 'target', false, href('recebidas', { operacao: 'canceladas' }))}${kpi('XMLs completos', num(data.fullXmlCount), 'Com itens e tributos', 'box')}</section>` +
    `<article class="panel document-panel">${panelHead('Notas', 'Clique para abrir o documento recebido')}<div class="document-filter"><label>Operação<select id="operation-filter"><option value="todos">Entradas não canceladas</option><option value="canceladas">Entradas canceladas</option><option value="compra">Compras identificadas</option><option value="devolucao">Devoluções recebidas</option><option value="vinculada">Devoluções ligadas a venda</option><option value="demais">Demais entradas</option></select></label><span>${num(filtered.length)} notas na lista</span></div>${documentRows(filtered, 'entrada')}</article>`;
  $('#operation-filter').value = operation;
  $('#operation-filter').onchange = (event) =>
    go('recebidas', { operacao: event.target.value === 'todos' ? null : event.target.value });
}
function setSidebar(collapsed) {
  state.collapsed = collapsed;
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  $('#sidebar-toggle').setAttribute('aria-expanded', String(!collapsed));
  $('#sidebar-toggle').setAttribute('aria-label', collapsed ? 'Expandir menu' : 'Recolher menu');
  localStorage.setItem('max-crm-sidebar', collapsed ? 'collapsed' : 'expanded');
}
function closeDrawer() {
  $('#sidebar').classList.remove('open');
  $('#sidebar-scrim').hidden = true;
  $('#menu').setAttribute('aria-expanded', 'false');
}
function closeFilters() {
  document.body.classList.remove('filters-open');
  $('#filters-scrim').hidden = true;
  $('#mobile-filters').setAttribute('aria-expanded', 'false');
}
function updateMobileFilters() {
  const count = 1 + Number(Boolean(state.params.get('empresa')));
  $('#mobile-filters').textContent =
    `Filtros ativos: ${count} · ${$('#preset').selectedOptions[0]?.textContent || 'Período'}`;
}
function render() {
  if (state.view === 'relatorios') $('#context').innerHTML = '';
  else renderContext();
  if (state.view === 'relatorios') reportCatalog();
  else if (state.view === 'executivo') dashboard();
  else if (state.view === 'comissoes') commissions();
  else if (state.view === 'insights') insights();
  else listings();
}
function paintMostrador() {
  const result = renderMostrador(state.nfeData, state.incomingData, state.targets, state.params, {
    slide: state.mostradorSlide,
    paused: state.mostradorPaused,
    sort: state.mostradorSort
  });
  if (result.signature !== state.mostradorSignature) {
    $('#page').innerHTML = result.html;
    state.mostradorSignature = result.signature;
  }
  const clock = $('#display-clock');
  if (clock)
    clock.textContent = new Date().toLocaleTimeString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit'
    });
}
function metasPage() {
  const kindLabel = { month: 'Mensal', quarter: 'Trimestral', year: 'Anual' };
  const scopeLabel = { group: 'Grupo', company: 'Empresa', seller: 'Vendedor' };
  const sellers = state.nfeData?.sellers || [];
  $('#page').innerHTML =
    head(
      'Metas comerciais',
      'Metas gravadas no banco do CRM. O Falco continua somente consulta.',
      'MaxCompany / Gestão'
    ) +
    `<section class="targets-layout"><form id="target-form" class="panel targets-form"><h2>Definir meta</h2><p>Metas mensais prevalecem sobre trimestrais e anuais no mesmo período. A distribuição diária considera segunda a sexta-feira, sem feriados.</p><label>Escopo<select name="scopeType" id="target-scope"><option value="group">Grupo MaxCompany</option><option value="company">Empresa</option><option value="seller">Vendedor</option></select></label><label class="target-entity" id="target-company-field" hidden>Empresa<select name="companyKey"><option value="1">MaxPlast</option><option value="2">MaxSafety</option><option value="3">MaxSupply</option><option value="4">MaxSupply · Filial ES</option></select></label><label class="target-entity" id="target-seller-field" hidden>Vendedor<input name="sellerName" list="target-sellers" placeholder="Nome no XML da NF-e"><datalist id="target-sellers">${sellers.map((row) => `<option value="${esc(row.name)}"></option>`).join('')}</datalist></label><label>Periodicidade<select name="periodKind" id="target-kind"><option value="month">Mensal</option><option value="quarter">Trimestral</option><option value="year">Anual</option></select></label><label>Início<input name="periodStart" id="target-period" type="date" value="${today().slice(0, 7)}-01" required></label><label>Valor da meta (R$)<input name="amount" type="number" min="0" max="999999999999" step="0.01" required></label><p id="target-error" role="alert"></p><button class="button primary" type="submit">Salvar meta</button></form><section class="panel targets-list"><h2>Metas cadastradas</h2><p>Alterações feitas aqui aparecem para toda a equipe autorizada.</p>${state.targets.length ? `<div class="targets-table-wrap"><table><thead><tr><th>Escopo</th><th>Nome</th><th>Período</th><th>Meta</th><th></th></tr></thead><tbody>${state.targets.map((row) => `<tr><td>${scopeLabel[row.scope_type] || ''}</td><td>${esc(row.scope_name)}</td><td>${kindLabel[row.period_kind] || ''} · ${esc(row.period_start)}</td><td>${money(row.amount)}</td><td><button type="button" data-target-delete="${esc(row.id)}" aria-label="Excluir meta de ${esc(row.scope_name)}">Excluir</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty"><h3>Nenhuma meta cadastrada</h3><p>Cadastre a primeira meta para comparar realizado e projeção.</p></div>'}</section></section>`;
  const sellerKey = (name) =>
    String(name || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .trim();
  const salesBySeller = new Map(sellers.map((row) => [sellerKey(row.name), row]));
  $('#page').insertAdjacentHTML(
    'beforeend',
    `<section class="targets-layout commission-layout"><form id="seller-commission-form" class="panel targets-form"><h2>Comissão por vendedor</h2><p>Defina o percentual individual. A regra é compartilhada e não altera o Falco.</p><label>Vendedor<input name="sellerName" list="target-sellers" placeholder="Nome no XML da NF-e" required></label><label>Comissão sobre vendas autorizadas (%)<input name="ratePercent" type="number" min="0" max="100" step="0.0001" required></label><p id="seller-commission-error" role="alert"></p><button class="button primary" type="submit">Salvar comissão</button></form><section class="panel targets-list"><h2>Regras individuais</h2><p>Projeção sobre vendas atribuídas no XML no período selecionado. Não é valor devido em folha: devoluções, cancelamentos posteriores e ajustes precisam de conferência.</p>${
      state.commissionRules.length
        ? `<div class="targets-table-wrap"><table><thead><tr><th>Vendedor</th><th>Percentual</th><th>Vendas do período</th><th>Projeção</th><th></th></tr></thead><tbody>${state.commissionRules
            .map((rule) => {
              const sale = salesBySeller.get(rule.seller_key);
              return `<tr><td>${esc(rule.seller_name)}</td><td>${num(rule.rate_percent)}%</td><td>${money(sale?.value || 0)}</td><td>${money(((sale?.value || 0) * rule.rate_percent) / 100)}</td><td><button type="button" data-commission-delete="${esc(rule.id)}" aria-label="Excluir comissão de ${esc(rule.seller_name)}">Excluir</button></td></tr>`;
            })
            .join('')}</tbody></table></div>`
        : '<div class="empty"><h3>Nenhuma comissão definida</h3><p>Salve uma regra individual para projetar valores.</p></div>'
    }</section></section>`
  );
}
function reportCatalog() {
  const query = (state.reportSearch || '').trim().toLocaleLowerCase('pt-BR');
  const shown = reports.filter((r) =>
    `${r.name} ${r.group}`.toLocaleLowerCase('pt-BR').includes(query)
  );
  $('#page').innerHTML =
    head(
      'Relatórios Falco',
      'Índice dos relatórios mostrados no Falco. As análises disponíveis usam somente XMLs encontrados nas pastas.',
      'MaxCompany / Relatórios'
    ) +
    `<section class="report-intro"><div><strong>${reports.length}</strong><span>relatórios identificados nas capturas</span></div><div><strong>${reports.filter((r) => r.view).length}</strong><span>com análise de XML disponível</span></div><p>Os links levam a análises relacionadas, não à reprodução integral dos relatórios do ERP. O backup MASERP.bak contém dados adicionais, mas não é uma fonte de atualização em tempo real.</p></section>` +
    `<div class="report-toolbar"><label class="search-field">${icon('search')}<span class="sr-only">Buscar relatório</span><input id="report-search" type="search" value="${esc(state.reportSearch || '')}" placeholder="Buscar relatório ou área" autocomplete="off"></label><span>${shown.length} resultados</span></div>` +
    (shown.length
      ? reportGroups
          .map((group) => {
            const items = shown.filter((r) => r.group === group);
            if (!items.length) return '';
            return `<section class="report-section"><div class="report-section-title"><h2>${esc(group)}</h2><span>${items.length}</span></div><div class="report-grid">${items
              .map(
                (r) =>
                  `<article class="report-card"><div><span class="report-mark">${icon('document')}</span><span class="report-state ${r.view ? 'related' : ''}">${r.view ? 'Análise de XML' : 'Sem fonte estruturada validada'}</span></div><h3>${esc(r.name.replace(/^Relatório de?\s*/i, ''))}</h3>${r.view ? link(r.view, `Abrir ${views[r.view]}`, {}, 'report-open') : '<span class="report-pending">Disponível no Falco; não reproduzido a partir das pastas</span>'}</article>`
              )
              .join('')}</div></section>`;
          })
          .join('')
      : '<div class="empty"><h2>Nenhum relatório encontrado</h2><p>Tente outro termo de busca.</p></div>');
  $('#report-search').oninput = (event) => {
    const input = event.target;
    const position = input.selectionStart;
    state.reportSearch = input.value;
    reportCatalog();
    const next = $('#report-search');
    next.focus();
    next.setSelectionRange(position, position);
  };
}
function nfeRanking(title, subtitle, rows, product = false, limit = 8, drilldown = null) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return `<article class="panel nfe-ranking">${panelHead(title, subtitle)}${
    rows.length
      ? `<div class="nfe-rank-list">${rows
          .slice(0, limit)
          .map((row, index) => {
            const target = drilldown ? nfeDrilldown(row, drilldown) : null;
            const tag = target ? 'a' : 'div';
            return `<${tag} class="nfe-rank-row ${target ? 'nfe-rank-link' : ''}"${target ? ` href="${esc(target)}"` : ''}><span class="nfe-rank-number">${String(index + 1).padStart(2, '0')}</span><div><div class="nfe-rank-heading"><strong title="${esc(row.name)}">${esc(row.name)}</strong><span>${money(row.value)}</span></div><small>${product && row.company ? `${esc(row.company)} · ` : ''}${row.id && /^\d{14}$/.test(row.id) ? `${esc(row.id)} · ` : ''}${row.cnpjCount ? `${num(row.cnpjCount)} ${row.cnpjCount === 1 ? 'CNPJ' : 'CNPJs'} · ` : ''}${row.registrationCount && row.registrationCount !== row.cnpjCount ? `${num(row.registrationCount)} cadastros · ` : ''}${num(row.count)} ${product ? 'itens' : 'notas'}${row.registrations?.length > 1 ? ` · Cadastros: ${esc(row.registrations.map((name) => name.match(/\(\d+\)\s*$/)?.[0] || name).join(', '))}` : ''}</small><div class="nfe-bar"><span style="width:${(row.value / max) * 100}%"></span></div></div></${tag}>`;
          })
          .join('')}</div>`
      : empty('Sem registros no período.')
  }</article>`;
}
function nfeBreakdown() {
  const data = state.nfeData;
  const config = {
    vendedores: {
      title: 'Vendas por vendedor',
      subtitle:
        'Vendedores identificados no texto das NF-e emitidas, com base no valor total da nota.',
      rows: data.sellers,
      metric: 'Vendedores identificados',
      note: `${num(data.unattributedCount)} de ${num(data.operations.find((row) => row.type === 'sale')?.count || 0)} notas de venda não informam vendedor identificável. Este ranking não é a comissão nem o cadastro completo do ERP.`
    },
    clientes: {
      title: state.params.has('grupoClienteNfe')
        ? 'CNPJs e cadastros do grupo'
        : 'Grupos de clientes',
      subtitle: state.params.has('grupoClienteNfe')
        ? 'Cada CNPJ abre os vendedores e, em seguida, as notas emitidas.'
        : 'Empresas ligadas pelo CNPJ raiz ou por grupo comercial identificado.',
      rows: state.params.has('grupoClienteNfe') ? data.customers : data.customerGroups,
      metric: state.params.has('grupoClienteNfe') ? 'CNPJs identificados' : 'Grupos identificados',
      note: 'Os valores vêm das NF-e de venda encontradas. Grupos comerciais de Baker Hughes, Globo e CSN são identificados pelo nome; os demais CNPJs são reunidos pela raiz. As devoluções de clientes aparecem separadamente.'
    },
    produtos: {
      title: 'Produtos vendidos nas NF-e',
      subtitle: 'Itens das NF-e de venda autorizadas ordenados pelo valor bruto.',
      rows: data.products,
      metric: 'Produtos identificados',
      product: true,
      note: 'Os valores dos itens podem diferir do total da nota por impostos, frete e outros ajustes.'
    }
  }[state.view];
  $('#page').innerHTML =
    head(config.title, config.subtitle, 'MaxCompany / Análise fiscal') +
    nfeSource(data) +
    nfeTrail() +
    `<section class="kpis">${kpi('Vendas faturadas', bigMoney(data.saleValue), money(data.saleValue), 'wallet', true)}${kpi('NF-e de venda', num(data.operations.find((row) => row.type === 'sale')?.count || 0), 'Autorizadas e não canceladas', 'document')}${kpi(config.metric, num(config.rows.length), 'No período selecionado', 'users')}${kpi('Sem vendedor no XML', num(data.unattributedCount), 'Vendas sem atribuição explícita', 'target')}</section>` +
    `<div class="nfe-breakdown">${nfeRanking(config.title, config.subtitle, config.rows, config.product, state.nfeLimit, { clientes: state.params.has('grupoClienteNfe') ? 'customer' : 'customerGroup', vendedores: 'seller', produtos: 'product' }[state.view])}${config.rows.length > state.nfeLimit ? `<button class="button nfe-more" data-nfe-more>Mostrar mais 50 · ${num(Math.min(state.nfeLimit, config.rows.length))} de ${num(config.rows.length)}</button>` : ''}</div>` +
    `<p class="nfe-note">${esc(config.note)} A consulta é atualizada automaticamente a partir dos arquivos disponíveis nas pastas.</p>`;
}
function nfeFiscal() {
  const data = state.nfeData;
  const returned = Number(state.incomingData?.returns?.linkedToSaleValue || 0);
  const real = Number(data.saleValue || 0) - returned;
  const difference = Number(data.value || 0) - real;
  const used = new Set(data.cfops.map((row) => row.name));
  const catalog = cfopCatalog.map((row) => ({
    ...row,
    used: row.codes.some((code) => used.has(code))
  }));
  $('#page').innerHTML =
    head(
      'Central fiscal',
      'Conciliação entre o valor fiscal das notas e o faturamento real por CFOP de cada item.',
      'MaxCompany / Fiscal'
    ) +
    nfeSource(data) +
    `<section class="kpis">${kpi('Faturamento real', bigMoney(real), money(real), 'wallet', true, 'faturamento')}${kpi('Valor fiscal emitido', bigMoney(data.value), money(data.value), 'document', false, 'emitidas')}${kpi('Diferença a investigar', bigMoney(difference), 'Fiscal menos realizado gerencial', 'target')}${kpi('CFOP distintos', num(data.cfops.length), 'Nos itens das notas', 'box')}</section>` +
    `<article class="panel reconciliation-panel">${panelHead('Ponte fiscal → faturamento real', 'Valores documentados, sem rateios ou estimativas')}<div class="reconciliation-list"><a href="${esc(href('emitidas'))}"><span>Valor fiscal emitido</span><strong>${money(data.value)}</strong></a><a href="${esc(href('emitidas', { efeito: 'nao-financeiro' }))}"><span>Itens sem efeito financeiro</span><strong>− ${money(data.nonFinancialValue || 0)}</strong></a><a href="${esc(href('emitidas', { efeito: 'pendente' }))}"><span>Sem classificação ou diferença entre vNF e itens</span><strong>− ${money(data.pendingClassificationValue || 0)}</strong></a><a href="${esc(href('emitidas', { operacao: 'outras' }))}"><span>Movimento financeiro que não é venda</span><strong>− ${money(Math.max(0, (data.financialMovementValue || 0) - data.saleValue))}</strong></a><a href="${esc(href('devolucoes'))}"><span>Devoluções financeiras confirmadas</span><strong>− ${money(returned)}</strong></a><a href="${esc(href('faturamento'))}"><span>Faturamento real</span><strong>${money(real)}</strong></a></div></article>` +
    `<div class="nfe-charts nfe-charts-secondary">${nfeRanking('Por UF de destino', 'Valor total das NF-e por UF', data.ufs, false, 28)}${nfeRanking('Por CFOP', 'Valor bruto dos itens por CFOP', data.cfops, true, 30)}</div>` +
    `<article class="panel cfop-reference">${panelHead('CFOPs configurados no Falco', 'Referência fornecida pela empresa · os códigos presentes neste período ficam destacados')}${table(
      [
        {
          title: 'CFOPs',
          render: (row) =>
            row.codes
              .map(
                (code) =>
                  `<span class="cfop-badge ${used.has(code) ? 'in-period' : ''}">${esc(code)}</span>`
              )
              .join(' ')
        },
        { title: 'Operação', render: (row) => esc(row.name) },
        { title: 'Classificação', render: (row) => `<strong>${esc(row.classification)}</strong>` },
        {
          title: 'Vendas faturadas',
          render: (row) =>
            `<span class="cfop-revenue ${row.codes.some((code) => FINANCIAL_CFOPS.has(code)) ? 'included' : 'excluded'}">${row.codes.some((code) => FINANCIAL_CFOPS.has(code)) ? 'Pode gerar financeiro' : 'Sem efeito financeiro'}</span>`
        }
      ],
      catalog.sort((a, b) => Number(b.used) - Number(a.used))
    )}</article>` +
    `<p class="nfe-note">O CFOP classifica cada item, mas a direção e a operação determinam se o movimento é venda, compra ou outra saída. UF usa vNF; CFOP usa vProd. A diferença entre vNF e itens sem rateio fica pendente. Notas canceladas são exibidas separadamente e já não compõem o valor fiscal autorizado acima.</p>`;
}
function incomingDashboard() {
  const data = state.incomingData;
  const purchases = data.documents.filter(
    (row) => row.full && row.fiscalOperation?.type === 'sale' && row.financial?.financialValue > 0
  );
  const aggregate = (key) => {
    const groups = new Map();
    for (const row of purchases) {
      const name = key(row);
      const group = groups.get(name) || { name, count: 0, value: 0 };
      group.count++;
      group.value += Number(row.financial?.financialValue) || 0;
      groups.set(name, group);
    }
    return [...groups.values()].sort((a, b) => b.value - a.value);
  };
  const byDate = new Map(aggregate((row) => row.date).map((row) => [row.name, row]));
  const rows = data.daily.map((row) => ({
    ...row,
    count: byDate.get(row.date)?.count || 0,
    value: byDate.get(row.date)?.value || 0
  }));
  const companies = aggregate((row) => row.company);
  const suppliers = aggregate((row) => row.supplier?.name || 'Fornecedor não identificado');
  const max = Math.max(1, ...rows.map((row) => row.value));
  const x = (index) => 52 + (index / Math.max(rows.length - 1, 1)) * 626;
  const y = (value) => 190 - (value / max) * 160;
  const path = rows
    .map((row, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)} ${y(row.value).toFixed(1)}`)
    .join(' ');
  const ticks = rows.length
    ? [...new Set([0, Math.floor((rows.length - 1) / 2), rows.length - 1])]
    : [];
  const companyMax = Math.max(1, ...companies.map((row) => row.value));
  const lastSync =
    data.lastSyncedAt ||
    data.sync
      .map((row) => row.updatedAt)
      .filter(Boolean)
      .sort()
      .at(-1);
  $('#page').innerHTML =
    head(
      'Compras documentadas',
      'Itens de compra com CFOP financeiro, separados do valor fiscal das entradas.',
      'MaxCompany / Entradas'
    ) +
    `<div class="nfe-source"><span class="nfe-live">Fonte: SEFAZ e XMLs importados do Falco</span><span>${data.sourcesAvailable} de ${data.sourcesTotal} ${data.sourcesTotal === 1 ? 'empresa' : 'empresas'} · Última atualização registrada ${lastSync ? new Date(lastSync).toLocaleString('pt-BR') : 'ainda não realizada'}</span></div>` +
    ((data.sync || []).some((row) => row.error)
      ? '<div class="notice">A consulta automática SEFAZ está indisponível em uma ou mais empresas. O coletor precisa executar na conta Windows com os certificados empresariais válidos. Os dados já sincronizados permanecem disponíveis.</div>'
      : '') +
    `<section class="kpis">${kpi('Compras financeiras', bigMoney(data.purchaseValue || 0), `${num(data.purchaseCount || 0)} NF-e com itens elegíveis`, 'wallet', true, href('recebidas', { operacao: 'compra' }))}${kpi('Valor fiscal de entradas', bigMoney(data.value), `${num(data.invoiceCount)} NF-e no período`, 'document', false, 'recebidas')}${kpi('XMLs completos', num(data.fullXmlCount), 'Com itens e classificação fiscal', 'box')}${kpi('Somente resumo', num(data.summaryOnlyCount), 'Sem itens para confirmar compra', 'target')}</section>` +
    `<div class="nfe-charts"><article class="panel nfe-trend">${panelHead('Compras por dia', 'Valor das NF-e classificadas como compra')}${rows.length ? `<svg class="nfe-line-chart" viewBox="0 0 720 230" role="img" aria-label="Valor diário das compras identificadas">${[0, 0.25, 0.5, 0.75, 1].map((part) => `<line x1="52" x2="678" y1="${y(max * part)}" y2="${y(max * part)}" stroke="#e4e5e9"/><text x="44" y="${y(max * part) + 4}" text-anchor="end">${short(max * part)}</text>`).join('')}<path d="${path}" fill="none" stroke="var(--accent)" stroke-width="3"/>${rows.map((row, index) => `<circle cx="${x(index)}" cy="${y(row.value)}" r="3" fill="var(--accent)"><title>${date(row.date)} · ${money(row.value)} · ${num(row.count)} compras</title></circle>`).join('')}${ticks.map((index) => `<text x="${x(index)}" y="218" text-anchor="${index === 0 ? 'start' : index === rows.length - 1 ? 'end' : 'middle'}">${date(rows[index].date)}</text>`).join('')}</svg>` : empty('Sem compras identificadas no período.')}</article><article class="panel nfe-companies">${panelHead('Compras por empresa', 'Valor das NF-e de compra')}${companies.length ? companies.map((row) => `<div class="nfe-company"><div><strong>${esc(row.name)}</strong><span>${num(row.count)} notas · ${money(row.value)}</span></div><div class="nfe-bar"><span style="width:${(row.value / companyMax) * 100}%"></span></div></div>`).join('') : empty('Nenhuma compra identificada no período.')}</article></div>` +
    `<div class="nfe-charts nfe-products-row">${nfeRanking('Fornecedores de compras', 'NF-e com CFOP de venda do fornecedor', suppliers, false, 12)}</div>` +
    `<p class="nfe-note">Compra financeira exige XML completo, autorizado e item com CFOP da regra gerencial. Devoluções, remessas e outras entradas ficam fora; resumos sem itens seguem pendentes. XMLs repetidos são deduplicados por empresa e chave. Compra não é faturamento nem custo da mercadoria vendida. ${link('dashboard', 'Ver visão executiva do grupo')}</p>`;
}
function maserpMetrics(data) {
  const report = data?.synchronization?.maserpSales;
  if (!report?.available) return null;
  const selectedCompany = Number(state.params.get('empresa') || 0);
  const ids = { 1: 1, 3: 2, 5: 3, 6: 4 };
  const names = { 1: 'MaxPlast', 2: 'MaxSafety', 3: 'MaxSupply', 4: 'MaxSupply · Filial ES' };
  const invoiceRows = (report.companies || []).filter(
    (row) => !selectedCompany || ids[row.companyCode] === selectedCompany
  );
  const commercialRows = (report.commercial || []).filter(
    (row) => !selectedCompany || ids[row.companyCode] === selectedCompany
  );
  const profitabilityRows = (report.profitability || []).filter(
    (row) => !selectedCompany || ids[row.companyCode] === selectedCompany
  );
  const sum = (rows, key) => rows.reduce((total, row) => total + Number(row[key] || 0), 0);
  const gross = sum(invoiceRows, 'gross');
  const returned = sum(invoiceRows, 'returned');
  const sales = sum(commercialRows, 'sales');
  const salesCost = sum(commercialRows, 'salesCost');
  const billed = sum(commercialRows, 'billed');
  const billedCost = sum(commercialRows, 'billedCost');
  const billedCostCoverage = sum(commercialRows, 'billedCostCoverage');
  const profitabilityCost = sum(profitabilityRows, 'cost');
  const profitabilityProfit = sum(profitabilityRows, 'profit');
  return {
    report,
    ids,
    names,
    invoiceRows,
    commercialRows,
    profitabilityRows,
    label: selectedCompany ? names[selectedCompany] : 'Todas as empresas',
    comparable: data?.period?.inicio === report.startDate && data?.period?.fim === report.endDate,
    invoices: sum(invoiceRows, 'count'),
    gross,
    returned,
    net: gross - returned,
    orders: sum(commercialRows, 'orders'),
    sales,
    salesCost,
    salesMarkup: salesCost ? ((sales - salesCost) / salesCost) * 100 : 0,
    salesWithRotation: sum(commercialRows, 'salesWithRotation'),
    salesWithoutRotation: sum(commercialRows, 'salesWithoutRotation'),
    billed,
    billedCost,
    billedCostCoverage,
    billedProfit: billedCostCoverage - billedCost,
    billedCoveragePct: billed ? (billedCostCoverage / billed) * 100 : 0,
    billedMarkup: billedCost ? ((billedCostCoverage - billedCost) / billedCost) * 100 : 0,
    billedWithRotation: sum(commercialRows, 'billedWithRotation'),
    billedWithoutRotation: sum(commercialRows, 'billedWithoutRotation'),
    profitabilityAvailable: profitabilityRows.length > 0,
    profitabilityGross: sum(profitabilityRows, 'gross'),
    profitabilityNet: sum(profitabilityRows, 'net'),
    profitabilityCost,
    profitabilityProfit,
    profitabilityReturned: sum(profitabilityRows, 'returned'),
    profitabilityExpenses: sum(profitabilityRows, 'expenses'),
    profitabilityMarkup: profitabilityCost ? (profitabilityProfit / profitabilityCost) * 100 : 0
  };
}
function maserpReportPanel(data) {
  const sync = data?.synchronization;
  const metrics = maserpMetrics(data);
  if (!metrics) {
    return `<article class="panel maserp-report-panel unavailable">${panelHead('Conciliação Falco', 'O coletor ainda não publicou o retrato dos relatórios do MASERP')}<p class="nfe-note">Os documentos XML continuam disponíveis. A conciliação comercial aparecerá após a próxima sincronização do servidor local.</p></article>`;
  }
  const { report, ids, names, invoiceRows, commercialRows } = metrics;
  const updated = sync?.updatedAt
    ? new Date(sync.updatedAt).toLocaleString('pt-BR')
    : 'a confirmar';
  const sefazRows = sync?.sefaz || [];
  const sefazErrors = sefazRows.filter((row) => row.error).length;
  const sefazAvailable = sefazRows.filter((row) => row.available).length;
  const sefazHeadline = sefazErrors
    ? sefazAvailable
      ? 'XMLs locais disponíveis'
      : 'Consulta oficial indisponível'
    : 'Captura acompanhada';
  const sefazDetail = sefazErrors
    ? `${num(sefazAvailable)}/${num(sefazRows.length)} fontes com arquivos · consulta oficial pendente em ${num(sefazErrors)}`
    : `${num(sefazRows.length)} empresa(s) monitorada(s) · atualização automática`;
  const rangeNote = metrics.comparable
    ? 'Mesmo período selecionado'
    : `Retrato de ${date(report.startDate)} a ${date(report.endDate)}; ajuste o filtro para comparar`;
  return `<section class="maserp-report-panel" aria-label="Conciliação entre relatórios do Falco"><div class="data-pipelines"><div class="pipeline-state ${sync?.fresh ? 'ok' : 'warn'}"><span>SAÍDAS · FALCO/MASERP</span><strong>${sync?.fresh ? 'Atualização ativa' : 'Aguardando coletor'}</strong><small>Concluída em ${esc(updated)}</small></div><div class="pipeline-state ${sefazErrors ? 'warn' : 'ok'}"><span>ENTRADAS · SEFAZ</span><strong>${esc(sefazHeadline)}</strong><small>${esc(sefazDetail)}</small></div></div><article class="panel value-bridge-panel">${panelHead('Do pedido ao resultado fiscal', `${rangeNote} · ${metrics.label}`)}<div class="value-bridge"><div class="bridge-group commercial"><div class="bridge-kicker">RELATÓRIO DE VENDAS E FATURAMENTO</div><div class="bridge-steps"><div><span>Venda em pedidos</span><strong>${money(metrics.sales)}</strong><small>Markup ${num(metrics.salesMarkup)}% · com giro ${money(metrics.salesWithRotation)}</small></div><b>→</b><div><span>Faturado no Falco</span><strong>${money(metrics.billed)}</strong><small>Markup ${num(metrics.billedMarkup)}% · com giro ${money(metrics.billedWithRotation)}</small></div></div></div><div class="bridge-group fiscal"><div class="bridge-kicker">RELATÓRIO DE NOTAS FISCAIS EMITIDAS</div><div class="bridge-steps"><div><span>NF-e emitidas</span><strong>${money(metrics.gross)}</strong><small>${num(metrics.invoices)} notas autorizadas</small></div><b>−</b><div><span>Devolvido</span><strong>${money(metrics.returned)}</strong><small>Quantidade devolvida × preço dos itens</small></div><b>=</b><div class="bridge-result"><span>Saldo fiscal</span><strong>${money(metrics.net)}</strong><small>NF-e menos valor devolvido</small></div></div></div></div><div class="metric-definition-grid"><div><strong>Venda</strong><span>Pedidos registrados no período, faturados ou não.</span></div><div><strong>Faturamento</strong><span>Parte desses pedidos já vinculada a nota no Falco.</span></div><div><strong>NF-e emitidas</strong><span>Valor fiscal total das notas autorizadas.</span></div><div><strong>Saldo fiscal</strong><span>NF-e emitidas menos devolução registrada nos itens.</span></div></div><details class="company-reconciliation"><summary>Ver valores por empresa</summary><div>${invoiceRows
    .map((row) => {
      const commercial = commercialRows.find((item) => item.companyCode === row.companyCode) || {};
      return `<div><strong>${esc(names[ids[row.companyCode]] || `Empresa ${row.companyCode}`)}</strong><span>Venda ${money(commercial.sales || 0)} · faturado ${money(commercial.billed || 0)} · NF-e ${money(row.gross)} · saldo ${money(row.gross - row.returned)}</span></div>`;
    })
    .join(
      ''
    )}</div></details><p class="nfe-note">As regras de CFOP continuam na análise dos XMLs. Os valores acima reproduzem as duas leituras do Falco sem misturar pedido, faturamento e documento fiscal.</p></article></section>`;
}
function nfeDashboard() {
  const data = state.nfeData;
  if (!data) return;
  const falco = maserpMetrics(data);
  const rows = data.daily;
  const mode = state.nfeChartMode || 'value';
  const metric = mode === 'value' ? 'value' : 'count';
  const maximum = Math.max(1, ...rows.map((row) => row[metric]));
  const x = (index) => 52 + (index / Math.max(rows.length - 1, 1)) * 626;
  const y = (value) => 190 - (value / maximum) * 160;
  const path = rows
    .map((row, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)} ${y(row[metric]).toFixed(1)}`)
    .join(' ');
  const ticks = rows.length
    ? [...new Set([0, Math.floor((rows.length - 1) / 2), rows.length - 1])]
    : [];
  const companyMax = Math.max(1, ...data.companies.map((company) => company.value));
  const returned = Number(state.incomingData?.returns?.linkedToSaleValue || 0);
  const real = Math.max(0, Number(data.saleValue || 0) - returned);
  const purchases = Number(state.incomingData?.purchaseValue || 0);
  const hasFalcoPeriod = Boolean(falco?.comparable && falco.commercialRows.length);
  const returnedByCompany = new Map();
  for (const row of state.incomingData?.returns?.documents || []) {
    const value = confirmedFinancialReturn(row);
    returnedByCompany.set(row.company, (returnedByCompany.get(row.company) || 0) + value);
  }
  const financialSeries = rows.map((row) => Number(row.saleValue || 0));
  const financialMax = Math.max(maximum, ...financialSeries);
  const financialPath = rows
    .map(
      (row, index) =>
        `${index ? 'L' : 'M'}${x(index).toFixed(1)} ${(190 - (financialSeries[index] / financialMax) * 160).toFixed(1)}`
    )
    .join(' ');
  $('#page').innerHTML =
    head(
      'Visão executiva MaxCompany',
      'Vendas faturadas, devoluções e movimentação fiscal das empresas do grupo, com atualização automática.',
      'MaxCompany / Inteligência'
    ) +
    nfeSource(data, true) +
    maserpReportPanel(data) +
    `<section class="kpis">${kpi(hasFalcoPeriod ? 'Faturado no Falco' : 'Vendas financeiras nos XMLs', bigMoney(hasFalcoPeriod ? falco.billed : data.saleValue), hasFalcoPeriod ? (falco.profitabilityAvailable ? `Lucro Falco ${money(falco.profitabilityProfit)} · ${num(falco.profitabilityMarkup)}% sobre custo` : 'Lucratividade aguardando sincronização') : money(data.saleValue), 'wallet', true, 'faturamento', 'Valor do relatório comercial e lucratividade oficial do Falco para o mesmo período selecionado.')}${kpi(hasFalcoPeriod ? 'Venda em pedidos' : 'Saldo gerencial dos XMLs', bigMoney(hasFalcoPeriod ? falco.sales : real), hasFalcoPeriod ? `Markup ${num(falco.salesMarkup)}% · ${num(falco.orders)} pedidos localizados` : 'Itens financeiros menos devoluções vinculadas', 'trend', false, 'faturamento')}${kpi(hasFalcoPeriod ? 'NF-e emitidas' : 'Valor fiscal emitido', bigMoney(hasFalcoPeriod ? falco.gross : data.value), hasFalcoPeriod ? `${num(falco.invoices)} notas no relatório fiscal` : money(data.value), 'document', false, 'emitidas')}${kpi(hasFalcoPeriod ? 'Saldo fiscal' : 'Compras financeiras', bigMoney(hasFalcoPeriod ? falco.net : purchases), hasFalcoPeriod ? `Após ${money(falco.returned)} devolvidos` : 'Entradas com efeito financeiro', 'box', false, hasFalcoPeriod ? 'devolucoes' : 'entradas')}</section>` +
    `<section class="kpis compact-kpis">${kpi('Itens financeiros nos XMLs', bigMoney(data.saleValue), 'CFOPs financeiros nas NF-e de saída', 'trend', false, href('emitidas', { operacao: 'venda', efeito: 'financeiro' }))}${kpi('Devoluções captadas no SEFAZ', bigMoney(returned), `${num(state.incomingData?.returns?.linkedToSaleCount || 0)} vínculos confirmados`, 'document', false, 'devolucoes')}${kpi('Compras financeiras', bigMoney(purchases), 'Entradas com efeito financeiro · não são receita', 'box', false, 'entradas')}${kpi('Canceladas', bigMoney(data.canceledValue || 0), `${num(data.canceledCount || 0)} NF-e destacadas`, 'document', false, 'canceladas')}</section>` +
    fiscalEventCards(data, state.incomingData) +
    `<div class="nfe-charts"><article class="panel nfe-trend">${panelHead('Fiscal × itens financeiros por dia', 'Emissão por data da NF-e · azul: valor fiscal · verde: itens com CFOP financeiro')}<div class="nfe-chart-switch"><button data-chart-mode="value" class="${mode === 'value' ? 'active' : ''}">Valor</button><button data-chart-mode="count" class="${mode === 'count' ? 'active' : ''}">Quantidade</button></div>${rows.length ? `<svg class="nfe-line-chart" viewBox="0 0 720 230" role="img" aria-label="Valor fiscal e itens financeiros por dia">${[0, 0.25, 0.5, 0.75, 1].map((part) => `<line x1="52" x2="678" y1="${y(maximum * part)}" y2="${y(maximum * part)}" stroke="#e4e5e9"/><text x="44" y="${y(maximum * part) + 4}" text-anchor="end">${mode === 'value' ? short(maximum * part) : num(maximum * part)}</text>`).join('')}<path d="${path}" fill="none" stroke="var(--accent)" stroke-width="3"/>${mode === 'value' ? `<path d="${financialPath}" fill="none" stroke="#13986f" stroke-width="3"/>` : ''}${rows.map((row, index) => `<circle cx="${x(index)}" cy="${y(row[metric])}" r="3" fill="var(--accent)"><title>${date(row.date)} · fiscal ${money(row.value)} · financeiro ${money(row.saleValue || 0)}</title></circle>`).join('')}${ticks.map((index) => `<text x="${x(index)}" y="218" text-anchor="${index === 0 ? 'start' : index === rows.length - 1 ? 'end' : 'middle'}">${date(rows[index].date)}</text>`).join('')}</svg>` : empty('Sem notas neste período.')}</article><article class="panel nfe-companies">${panelHead('XMLs por empresa', 'Itens financeiros e valor fiscal das NF-e autorizadas')}${data.companies.length ? data.companies.map((company) => `<div class="nfe-company"><div><strong>${esc(company.name)}</strong><span>Itens financeiros líquidos ${money((company.saleValue || 0) - (returnedByCompany.get(company.name) || 0))} · Fiscal ${money(company.value)} · ${num(company.count)} NF-e</span></div><div class="nfe-bar"><span style="width:${(company.value / companyMax) * 100}%"></span></div></div>`).join('') : empty('Nenhuma empresa com notas no período.')}</article></div>` +
    `<div class="nfe-charts nfe-charts-secondary">${nfeRanking('Vendas por vendedor', `${num(data.unattributedCount)} notas sem vendedor no XML`, data.sellers, false, 8, 'seller')}${nfeRanking('Principais clientes', 'Valor consolidado por grupo de CNPJs', data.customerGroups, false, 8, 'customerGroup')}</div>` +
    `<div class="nfe-charts nfe-charts-secondary nfe-products-row">${nfeRanking('Principais produtos', 'Itens de venda com CFOP financeiro', data.products, true, 8, 'product')}</div>` +
    `<div class="nfe-charts nfe-charts-secondary">${forecastPanel(monthWithin(data), null, state.incomingData?.returns?.documents?.filter((row) => row.date >= `${today().slice(0, 7)}-01` && row.date <= today()).reduce((sum, row) => sum + confirmedFinancialReturn(row), 0) ?? null)}${averagePanel({ ...data, value: data.saleValue }, 'vendas financeiras')}</div>` +
    `<p class="nfe-note">Venda, faturamento e NF-e são exibidos como bases separadas. A leitura por XML classifica cada item pelos CFOPs financeiros informados; devoluções captadas no SEFAZ só são abatidas quando o vínculo com a venda é confirmado. Compras, cancelamentos, remessas e transferências permanecem destacados e não entram como receita. ${num(state.incomingData?.summaryOnlyCount || 0)} entradas estão só em resumo.</p>`;
  document.querySelectorAll('.nfe-companies .nfe-company').forEach((node, index) => {
    const target = nfeDrilldown(data.companies[index], 'company');
    if (!target) return;
    const anchor = document.createElement('a');
    anchor.className = 'nfe-company nfe-company-link';
    anchor.href = target;
    anchor.innerHTML = `<img class="nfe-company-logo" src="${companyLogo(data.companies[index].name)}" alt=""><div class="nfe-company-data">${node.innerHTML}</div>`;
    node.replaceWith(anchor);
  });
}
let activeLoads = 0;
async function load(background = false) {
  if (!state.user) return;
  if (background && activeLoads > 0) return;
  activeLoads++;
  const seq = ++state.seq;
  $('#refresh').disabled = true;
  $('#page').setAttribute('aria-busy', 'true');
  $('#connection-indicator').setAttribute('aria-label', 'Verificando conexão com o ERP Falco');
  $('#data-source-status').textContent = 'Falco · Atualizando dados ao vivo';
  document.body.classList.add('is-updating');
  if (background) $('#sync-status').textContent = 'Atualizando dados…';
  if (!background)
    $('#page').innerHTML =
      `<div class="loading"><span class="spinner"></span>${state.view === 'entradas' ? 'Lendo documentos da SEFAZ…' : 'Lendo XMLs de NF-e…'}</div>`;
  try {
    if (['mostrador', 'metas'].includes(state.view)) {
      const period = displayPeriod(state.params.get('period') || 'month', today());
      const params = new URLSearchParams(state.params);
      if (state.view === 'mostrador') {
        params.set('inicio', period.start);
        params.set('fim', period.end);
      }
      const year = period.start.slice(0, 4);
      const [outgoing, incoming, targets, commissionRules] = await Promise.all([
        fetchJson(`/api/falco/nfe?${params}`),
        state.view === 'mostrador'
          ? fetchJson(`/api/falco/entradas?${params}`)
          : Promise.resolve(null),
        fetchJson(`/api/commercial/targets?start=${year}-01-01&end=${year}-12-31`),
        state.view === 'metas' ? fetchJson('/api/commercial/commissions') : Promise.resolve([])
      ]);
      if (seq !== state.seq) return;
      state.nfeData = outgoing;
      state.incomingData = incoming;
      state.targets = targets;
      state.commissionRules = commissionRules;
      if (state.view === 'mostrador') paintMostrador();
      else metasPage();
      $('#sync-status').textContent =
        `Dados consultados às ${new Date().toLocaleTimeString('pt-BR')}`;
      $('#notice').innerHTML = '';
      return;
    }
    if (state.view === 'usuarios') {
      const users = await fetchJson('/api/users');
      if (seq !== state.seq) return;
      renderUsers(users);
      $('#sync-status').textContent = 'Usuários atualizados';
      return;
    }
    if (state.view === 'busca') {
      const query = (state.params.get('q') || '').trim();
      if (!query || (!/^\d+$/.test(query) && query.length < 3)) searchDashboard();
      else {
        const offset = Number(state.params.get('offset') || 0);
        const data = await fetchJson(
          `/api/falco/busca?q=${encodeURIComponent(query)}&offset=${Math.max(0, offset)}`
        );
        if (seq !== state.seq) return;
        searchDashboard(data);
      }
      $('#sync-status').textContent = 'Busca atualizada';
      $('#data-source-status').textContent = 'Falco · Busca no acervo de NF-e';
      $('#notice').innerHTML = '';
      return;
    }
    if (state.view === 'relatorios') {
      render();
      $('#sync-status').textContent = 'Índice disponível';
      $('#connection-indicator').setAttribute('aria-label', 'Relatórios do Falco catalogados');
      $('#data-source-status').textContent = 'Índice de relatórios · Capturas do Falco';
      return;
    }
    if (
      [
        'dashboard',
        'faturamento',
        'dre',
        'devolucoes',
        'emitidas',
        'canceladas',
        'vendedores',
        'clientes',
        'produtos',
        'fiscal',
        'fretes',
        'impostos'
      ].includes(state.view)
    ) {
      state.nfeData = await fetchJson(`/api/falco/nfe?${state.params}`);
      if (seq !== state.seq) return;
      if (['dashboard', 'faturamento', 'dre', 'devolucoes', 'fiscal'].includes(state.view)) {
        state.incomingData = await fetchJson(`/api/falco/entradas?${state.params}`);
        if (seq !== state.seq) return;
      }
      if (state.view === 'faturamento' || state.view === 'dre') {
        if (state.view === 'faturamento') {
          state.targets = await fetchJson(
            `/api/commercial/targets?start=${state.params.get('inicio')}&end=${state.params.get('fim')}`
          ).catch(() => []);
          if (seq !== state.seq) return;
        }
        const monthStart = `${today().slice(0, 7)}-01`;
        const previous = previousMonthAligned(today());
        const monthScope = new URLSearchParams(state.params);
        monthScope.delete('inicio');
        monthScope.delete('fim');
        const suffix = monthScope.toString() ? `&${monthScope}` : '';
        [state.monthData, state.previousMonthData, state.monthIncomingData] = await Promise.all([
          state.params.get('inicio') === monthStart && state.params.get('fim') === today()
            ? Promise.resolve(state.nfeData)
            : fetchJson(`/api/falco/nfe?inicio=${monthStart}&fim=${today()}${suffix}`),
          fetchJson(`/api/falco/nfe?inicio=${previous.inicio}&fim=${previous.fim}${suffix}`),
          state.params.get('inicio') === monthStart && state.params.get('fim') === today()
            ? Promise.resolve(state.incomingData)
            : fetchJson(`/api/falco/entradas?inicio=${monthStart}&fim=${today()}${suffix}`)
        ]);
        if (seq !== state.seq) return;
        await loadPurchaseHistory(state.params);
        if (seq !== state.seq) return;
        await loadEquivalences();
        if (seq !== state.seq) return;
      }
      if (state.view === 'impostos') {
        state.incomingData = await fetchJson(`/api/falco/entradas?${state.params}`);
        if (seq !== state.seq) return;
      }
      showXmlCompanies();
      if (state.view === 'dashboard') nfeDashboard();
      else if (state.view === 'faturamento') revenueDashboard();
      else if (state.view === 'dre') dreDashboard();
      else if (state.view === 'devolucoes') returnsDashboard();
      else if (['emitidas', 'canceladas'].includes(state.view)) outgoingDocuments();
      else if (state.view === 'fretes') freightDashboard();
      else if (state.view === 'impostos') taxDashboard();
      else if (state.view === 'fiscal') nfeFiscal();
      else nfeBreakdown();
      const live = state.nfeData.sourcesAvailable === state.nfeData.sourcesTotal;
      $('#sync-status').textContent = live
        ? `NF-e verificadas às ${new Date(state.nfeData.checkedAt).toLocaleTimeString('pt-BR')}`
        : `Pastas indisponíveis · ${state.nfeData.sourcesAvailable}/${state.nfeData.sourcesTotal}`;
      $('#connection-indicator').setAttribute(
        'aria-label',
        live ? 'XMLs do Falco consultados' : 'Conexão parcial com pastas Falco'
      );
      $('#data-source-status').textContent = live
        ? 'Ao vivo · XMLs das pastas Falco'
        : 'Conexão parcial · últimos XMLs disponíveis';
      $('#refresh-cadence').textContent = 'Tela consulta as pastas a cada 10 s';
      if (state.nfeData.source === 'Supabase') showCloudFreshness(state.nfeData);
      $('#notice').innerHTML = '';
      return;
    }
    if (['entradas', 'recebidas'].includes(state.view)) {
      state.incomingData = await fetchJson(`/api/falco/entradas?${state.params}`);
      if (seq !== state.seq) return;
      showXmlCompanies();
      if (state.view === 'entradas') incomingDashboard();
      else incomingDocuments();
      $('#sync-status').textContent =
        `Painel atualizado · ${new Date(state.incomingData.checkedAt).toLocaleTimeString('pt-BR')}`;
      $('#connection-indicator').setAttribute('aria-label', 'Documentos da SEFAZ consultados');
      $('#data-source-status').textContent = 'SEFAZ · sincronização automática na janela oficial';
      $('#refresh-cadence').textContent = 'Tela consulta o acervo a cada 10 s';
      if (state.incomingData.source === 'Supabase') showCloudFreshness(state.incomingData);
      $('#notice').innerHTML = '';
      return;
    }
    if (legacyViews.has(state.view)) {
      await loadLegacy(seq);
      $('#sync-status').textContent = 'Consulta atualizada';
      $('#connection-indicator').setAttribute('aria-label', 'Conectado ao ERP Falco');
      $('#data-source-status').textContent = 'ERP Falco · Dados confirmados pela origem';
      $('#notice').innerHTML = '';
      return;
    }
    const data = await fetchJson(`/api/executive?${state.params}`);
    if (seq !== state.seq) return;
    state.data = data;
    saveSnapshot(data);
    $('#company').innerHTML =
      '<option value="">Todas as empresas</option>' +
      data.catalogo.empresas.map((e) => `<option value="${e.id}">${esc(e.nome)}</option>`).join('');
    $('#company').value = state.params.get('empresa') || '';
    renderCompanies(data.catalogo.empresas);
    $('#sync-status').textContent =
      `Atualizado às ${new Date(data.atualizadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    $('#connection-indicator').setAttribute('aria-label', 'Conectado ao ERP Falco');
    $('#data-source-status').textContent = 'Ao vivo · dados da origem Falco';
    $('#refresh-cadence').textContent = 'Tela consulta a origem a cada 10 s';
    $('#notice').innerHTML = '';
    render();
  } catch (error) {
    if (seq !== state.seq) return;
    if (error.message === 'Faça login para continuar') {
      showLogin('Sua sessão terminou. Entre novamente.');
      return;
    }
    const snapshot = readSnapshot(),
      sameScope = snapshot?.params === state.params.toString();
    $('#sync-status').textContent = 'Fonte Falco indisponível';
    $('#connection-indicator').setAttribute('aria-label', 'ERP Falco indisponível');
    $('#data-source-status').textContent = 'Falco indisponível · último instantâneo preservado';
    if (snapshot && sameScope && !legacyViews.has(state.view) && state.view !== 'dashboard') {
      state.data = snapshot.data;
      $('#company').innerHTML =
        '<option value="">Todas as empresas</option>' +
        snapshot.data.catalogo.empresas
          .map((e) => `<option value="${e.id}">${esc(e.nome)}</option>`)
          .join('');
      $('#company').value = state.params.get('empresa') || '';
      renderCompanies(snapshot.data.catalogo.empresas);
      render();
      $('#notice').innerHTML =
        `<div class="source-status" role="status"><div>${icon('shield')}</div><div><strong>Exibindo o último instantâneo confirmado</strong><span>Dados consultados em ${new Date(snapshot.savedAt).toLocaleString('pt-BR')}. A atualização será retomada assim que o ERP Falco responder.</span></div><button class="text-button" data-retry>Tentar agora</button></div>`;
    } else if (background)
      $('#notice').innerHTML =
        `<div class="source-status" role="status"><div>${icon('shield')}</div><div><strong>Atualização temporariamente indisponível</strong><span>Os dados já exibidos permanecem preservados.</span></div><button class="text-button" data-retry>Tentar agora</button></div>`;
    else
      $('#page').innerHTML =
        `<section class="source-unavailable"><div class="source-unavailable-icon">${icon('shield')}</div><div><span class="eyebrow">ERP Falco</span><h2>Aguardando a fonte de dados</h2><p>Assim que a conexão de consulta estiver disponível, os indicadores serão carregados automaticamente. Nenhuma alteração será feita no ERP.</p><button class="button primary" data-retry>Tentar reconectar</button></div></section>`;
  } finally {
    activeLoads--;
    if (seq === state.seq) {
      $('#refresh').disabled = false;
      $('#page').setAttribute('aria-busy', 'false');
      document.body.classList.remove('is-updating');
    }
  }
}
function showCloudFreshness(data) {
  const sync = data.synchronization || {};
  const text = sync.fresh
    ? 'Sincronização ativa'
    : sync.collecting
      ? 'Sincronização em andamento'
      : 'Sincronização atrasada';
  $('#sync-status').textContent = text;
  $('#connection-indicator').setAttribute('aria-label', text);
  $('#data-source-status').textContent = text + ' · último conjunto confirmado';
  $('#refresh-cadence').textContent =
    'Tela: 10 s · coletor: ciclo alvo de 30 s · SEFAZ: janela oficial';
}
function renderUsers(users) {
  $('#page').innerHTML =
    head('Usuários', 'Contas e permissões de acesso ao CRM.', 'MaxCompany / Acesso') +
    `<section class="panel user-panel">${panelHead('Cadastrar usuário', 'Acesso completo ou acesso fiscal restrito')}<form id="user-create" class="user-create"><label>Nome<input name="name" required minlength="3" autocomplete="off"></label><label>Senha<input name="password" type="password" required minlength="4" autocomplete="new-password"></label><label>Perfil<select name="role"><option value="admin">Acesso completo</option><option value="fiscal">Fiscal</option></select></label><button class="button primary">Cadastrar</button></form><div id="user-feedback" role="status"></div>${users.map((user) => `<div class="user-row" data-user-id="${esc(user.id)}"><strong>${esc(user.name)}</strong><label>Perfil<select class="user-role" ${user.id === state.user.id ? 'disabled' : ''}><option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Acesso completo</option><option value="fiscal" ${user.role === 'fiscal' ? 'selected' : ''}>Fiscal</option></select></label><form class="user-password"><label>Nova senha<input name="password" type="password" minlength="4" required autocomplete="new-password"></label><button class="button">Trocar senha</button></form>${user.id === state.user.id ? '' : '<button class="button quiet user-delete" type="button">Excluir</button>'}</div>`).join('')}</section>`;
}
async function refreshUsers() {
  renderUsers(await fetchJson('/api/users'));
}
function userError(error) {
  $('#user-feedback').textContent = error.message;
}
document.addEventListener('submit', async (event) => {
  const form = event.target;
  if (form.id !== 'user-create' && !form.classList.contains('user-password')) return;
  event.preventDefault();
  try {
    if (form.id === 'user-create') {
      await sendJson('/api/users', 'POST', Object.fromEntries(new FormData(form)));
    } else {
      const id = form.closest('[data-user-id]').dataset.userId;
      await sendJson(`/api/users/${id}`, 'PATCH', { password: new FormData(form).get('password') });
    }
    await refreshUsers();
    $('#user-feedback').textContent = 'Alteração salva.';
  } catch (error) {
    userError(error);
  }
});
document.addEventListener('change', async (event) => {
  if (!event.target.matches('.user-role')) return;
  try {
    await sendJson(`/api/users/${event.target.closest('[data-user-id]').dataset.userId}`, 'PATCH', {
      role: event.target.value
    });
    await refreshUsers();
    $('#user-feedback').textContent = 'Perfil atualizado.';
  } catch (error) {
    userError(error);
    await refreshUsers();
  }
});
document.addEventListener('click', async (event) => {
  const button = event.target.closest('.user-delete');
  if (!button) return;
  const row = button.closest('[data-user-id]');
  if (!window.confirm(`Excluir o acesso de ${row.querySelector('strong').textContent}?`)) return;
  try {
    await sendJson(`/api/users/${row.dataset.userId}`, 'DELETE');
    await refreshUsers();
    $('#user-feedback').textContent = 'Usuário excluído.';
  } catch (error) {
    userError(error);
  }
});
async function loadLegacy(seq) {
  const data = await fetchJson(
    `/api/lista/${state.view}?${state.params}&limite=200&busca=${encodeURIComponent(state.q)}`
  );
  if (seq !== state.seq) return;
  state.legacyRows = data.registros;
  renderContext();
  const finance = ['receber', 'pagar'].includes(state.view),
    withValue = data.registros.filter((r) => r.valor != null),
    total = withValue.reduce((n, r) => n + Number(r.valor || 0), 0),
    withStatus = data.registros.filter((r) => r.situacao != null || r.conclusao != null).length;
  $('#page').innerHTML =
    head(
      views[state.view],
      finance
        ? 'Títulos por vencimento no período. Valores nominais não representam saldo conciliado.'
        : 'Consulta dos documentos do ERP Falco no período e empresa selecionados.'
    ) +
    `<section class="kpis">${kpi('Registros carregados', num(data.registros.length), 'Até 200 por consulta', 'document')}${kpi('Valor nominal', withValue.length ? bigMoney(total) : 'Não disponível', `${withValue.length} registros com valor`, 'wallet', true)}${kpi('Com situação', num(withStatus), 'Status informado pelo ERP Falco', 'target')}${kpi('Período', `${date(state.params.get('inicio'))} — ${date(state.params.get('fim'))}`, 'Filtro ativo', 'dashboard')}</section><div class="notice">Esta consulta operacional aplica período e empresa. Os filtros comerciais de vendedor, grupo, cliente e produto das análises não se aplicam aqui. Até 200 registros por consulta.</div><section class="panel"><div class="toolbar"><label class="search-field">${icon('search')}<span class="sr-only">Buscar documentos</span><input id="legacy-search" value="${esc(state.q)}" placeholder="Buscar documento ou entidade"></label><button class="button" id="legacy-go">Buscar</button><span class="result-count">${data.registros.length} registros</span></div>${
      data.registros.length
        ? table(
            [
              { title: 'Código', render: (r) => esc(r.codigo) },
              { title: 'Data', render: (r) => date(r.data) },
              { title: 'Entidade', cls: 'name-cell', render: (r) => esc(r.entidade) },
              {
                title: 'Valor nominal / itens',
                num: true,
                render: (r) => (r.valor == null ? '—' : money(r.valor))
              },
              { title: 'Situação', render: (r) => esc(r.situacao ?? r.conclusao ?? '—') }
            ],
            data.registros
          )
        : empty()
    }</section>`;
  $('#legacy-go').onclick = () => {
    state.q = $('#legacy-search').value;
    load();
  };
  $('#legacy-search').onkeydown = (e) => {
    if (e.key === 'Enter') $('#legacy-go').click();
  };
}
function route() {
  if (!state.user) return;
  clearTimeout(searchTimer);
  const [view, query = ''] = location.hash.slice(1).split('?');
  if (view === 'relatorios') {
    location.hash = state.user.role === 'fiscal' ? '#emitidas' : '#dashboard';
    return;
  }
  if (state.user.role === 'fiscal' && !fiscalViews.has(view)) {
    location.hash = '#emitidas';
    if (view !== 'emitidas') return;
  }
  state.view = views[view] ? view : 'dashboard';
  document.body.dataset.view = state.view;
  state.params = new URLSearchParams(query);
  if (state.view === 'mostrador') {
    const period = displayPeriod(state.params.get('period') || 'month', today());
    state.params.set('inicio', period.start);
    state.params.set('fim', period.end);
    state.mostradorSignature = '';
  }
  if (!state.params.has('fim')) state.params.set('fim', today());
  if (!state.params.has('inicio'))
    state.params.set('inicio', `${state.params.get('fim').slice(0, 7)}-01`);
  state.q = '';
  state.page = 1;
  state.active = 'all';
  state.nfeLimit = 50;
  state.documentLimit = 60;
  state.selectedTax = null;
  state.sort = ['pedidos', 'compras'].includes(state.view) ? 'recent' : 'valor';
  $('#start').value = state.params.get('inicio');
  $('#end').value = state.params.get('fim');
  $('#preset').value = matchingPreset($('#start').value, $('#end').value, today());
  $('#financial-effect').value = state.params.get('efeito') || '';
  $('#cfop-filter').value = state.params.get('cfop') || '';
  updateMobileFilters();
  $('#role').value = state.params.get('papel') || 'interno';
  $('#global-search').value = state.view === 'busca' ? state.params.get('q') || '' : '';
  renderCompanies(xmlCompanies);
  $('#section-name').textContent = views[state.view];
  $('#navigation').innerHTML = (
    state.user.role === 'fiscal'
      ? [
          [
            'Fiscal',
            [
              ['emitidas', 'document'],
              ['recebidas', 'document'],
              ['impostos', 'document']
            ]
          ]
        ]
      : sections
  )
    .map(
      ([name, items]) =>
        `<div class="nav-label">${name}</div>${items.map(([v, ic]) => `<a class="nav-link ${state.view === v ? 'active' : ''}" title="${esc(views[v])}" ${state.view === v ? 'aria-current="page"' : ''} href="${esc(href(v))}">${icon(ic)}<span class="nav-text">${esc(views[v])}</span></a>`).join('')}`
    )
    .join('');
  $('#navigation .active')?.scrollIntoView({ block: 'nearest' });
  closeDrawer();
  closeFilters();
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  load();
}
function openDoc(id, buy) {
  const r = (buy ? state.data.compras : state.data.pedidos).find((r) => r.id === id);
  if (!r) return;
  $('#detail-title').textContent = `Pedido ${r.empresa}/${r.numero}${r.serie || ''}`;
  $('#detail-content').innerHTML =
    `<p>${date(r.dia)} · ${esc(r.status)}</p><h3>${link(buy ? 'fornecedores' : 'clientes', buy ? r.fornecedorNome : r.clienteNome, { [buy ? 'fornecedor' : 'cliente']: buy ? r.fornecedor : r.cliente })}</h3><p>Valor dos itens no recorte: <strong>${money(r.valor)}</strong></p>${table(
      [
        {
          title: 'Código / produto',
          cls: 'name-cell',
          render: (i) =>
            `${link(buy ? 'produtos-comprados' : 'produtos', i.produto, { produto: i.produto })}<br>${esc(i.nome)}`
        },
        { title: 'Quantidade', num: true, render: (i) => `${num(i.quantidade)} ${esc(i.unidade)}` },
        { title: 'Preço unitário', num: true, render: (i) => money(i.preco) },
        { title: 'Valor no recorte', num: true, render: (i) => money(i.valor) }
      ],
      r.itens
    )}<p>Itens correspondentes aos filtros ativos. Frete e ajustes do cabeçalho não estão incluídos.</p>`;
  $('#detail-dialog').showModal();
}
async function openInvoice(key, type, companyId, canceled = false) {
  const company = Number(companyId);
  const document = await fetchJson(
    `/api/falco/documento?tipo=${type}&empresa=${company}&chave=${key}`
  );
  const url = (format, download = false) =>
    `/api/falco/documento?tipo=${type}&empresa=${company}&chave=${key}&formato=${format}${download ? '&baixar=1' : ''}`;
  const party = type === 'saida' ? document.customer : document.supplier;
  const rows = Array.isArray(document.items) ? document.items : document.itemsDetail || [];
  const taxes = Object.entries(document.taxes || {}).filter(([, value]) => value > 0);
  $('#detail-title').textContent =
    `NF-e ${document.number || key.slice(25, 34)}/${document.series || key.slice(22, 25)}`;
  $('#detail-content').innerHTML =
    `<div class="invoice-meta"><span>${esc(document.company)} · ${date(document.date)}</span><strong>${money(document.amount)}</strong></div>` +
    (canceled
      ? '<p class="invoice-canceled">Cancelamento identificado nos XMLs. Esta nota não compõe os totais autorizados do dashboard.</p>'
      : '') +
    `<p>${esc(party?.name || 'Não identificado')} · ${esc(party?.id || '')}</p><p class="invoice-key">Chave ${key}</p>` +
    (document.fiscalOperation
      ? `<p class="notice"><strong>Operação:</strong> ${esc(type === 'entrada' && document.fiscalOperation.type === 'sale' ? 'Compra / entrada de fornecedor' : operationLabel(document.fiscalOperation.type))} · ${esc(type === 'entrada' && document.fiscalOperation.type === 'sale' ? 'CFOP de venda do fornecedor' : document.fiscalOperation.evidence)} · ${esc(document.operation || 'Natureza não informada')}${document.referencedKeys?.length ? `<br>NF-e referenciada: ${document.referencedKeys.map((ref) => `<a href="${esc(searchUrl(ref))}">${esc(ref)}</a>`).join(', ')}` : ''}</p>`
      : '') +
    `<div class="invoice-cfops">${[...new Set(rows.map((item) => item.cfop).filter(Boolean))].map((code) => `<span class="cfop-badge in-period">CFOP ${esc(code)} · ${esc(cfopDescription(code))}</span>`).join(' ')}</div>` +
    `<div class="document-status"><span class="${document.hasXml ? 'available' : 'missing'}">XML: ${document.hasXml ? 'Disponível' : 'Indisponível'}</span><span class="${document.hasDanfe || document.hasPdf ? 'available' : 'missing'}">DANFE: ${document.hasDanfe || document.hasPdf ? 'Disponível' : 'Indisponível'}</span><span>Status: ${esc(document.documentStatus || (canceled ? 'CANCELED' : 'AUTHORIZED'))}</span></div>` +
    `<div class="invoice-actions">${document.hasXml ? `<a class="button primary" href="${url('xml')}" target="_blank" rel="noopener">Ver XML</a><a class="button" href="${url('xml', true)}">Baixar XML</a>` : ''}${document.hasPdf ? `<a class="button" href="${url('pdf')}" target="_blank" rel="noopener">Ver DANFE</a><a class="button" href="${url('pdf', true)}">Baixar DANFE</a>` : document.hasDanfe ? `<a class="button" href="${url('danfe')}" target="_blank" rel="noopener">Ver / imprimir DANFE</a><a class="button" href="${url('danfe', true)}">Baixar DANFE</a>` : ''}</div>` +
    (type === 'entrada' && !document.full
      ? '<p class="notice">A SEFAZ disponibilizou apenas o resumo da NF-e. O XML completo é necessário para montar o DANFE; ainda não há dados suficientes nesta pasta.</p>'
      : '') +
    (document.full && rows.length
      ? `<h3>Itens da NF-e</h3>${table(
          [
            {
              title: 'Produto',
              render: (r) =>
                `${esc(r.name)}<small>${esc(r.code)} · NCM ${esc(r.ncm)} · CFOP ${esc(r.cfop)} · CST ${esc(r.cst)}${r.order ? ` · Pedido ${esc(r.order)}` : ''}</small>`
            },
            { title: 'Quantidade', num: true, render: (r) => `${num(r.quantity)} ${esc(r.unit)}` },
            { title: 'Valor', num: true, render: (r) => money(r.value) },
            { title: 'ICMS', num: true, render: (r) => money(r.taxes?.ICMS) }
          ],
          rows
        )}`
      : '') +
    (taxes.length
      ? `<h3>Tributos destacados nos itens</h3><div class="invoice-taxes">${taxes.map(([name, value]) => `<span>${esc(name)}</span><strong>${money(value)}</strong>`).join('')}</div>`
      : '') +
    (document.freight
      ? `<h3>Frete documentado</h3><p>${esc(document.freight.modality)} · ${money(document.freight.value)}${document.freight.carrier ? ` · ${esc(document.freight.carrier)}` : ''}</p>`
      : '');
  $('#detail-dialog').showModal();
}
document.addEventListener('click', (e) => {
  const deleteEquivalence = e.target.closest('[data-equivalence-delete]');
  if (deleteEquivalence) {
    deleteEquivalence.disabled = true;
    sendJson(
      `/api/commercial/equivalences?id=${encodeURIComponent(deleteEquivalence.dataset.equivalenceDelete)}`,
      'DELETE'
    )
      .then(() => {
        state.equivalencesAt = 0;
        load(true);
      })
      .catch((error) => {
        $('#notice').innerHTML = `<div class="notice">${esc(error.message)}</div>`;
        deleteEquivalence.disabled = false;
      });
    return;
  }
  const equivalence = e.target.closest('[data-equivalence]');
  if (equivalence) {
    equivalence.disabled = true;
    sendJson('/api/commercial/equivalences', 'POST', JSON.parse(equivalence.dataset.equivalence))
      .then(() => {
        state.equivalencesAt = 0;
        load(true);
      })
      .catch((error) => {
        $('#notice').innerHTML = `<div class="notice">${esc(error.message)}</div>`;
        equivalence.disabled = false;
      });
    return;
  }
  const displayCompany = e.target.closest('[data-display-company]');
  if (displayCompany) {
    changeCompany(displayCompany.dataset.displayCompany);
    return;
  }
  const displayPeriodButton = e.target.closest('[data-display-period]');
  if (displayPeriodButton) {
    const key = displayPeriodButton.dataset.displayPeriod;
    const period = displayPeriod(key, today());
    go('mostrador', { period: key, inicio: period.start, fim: period.end });
    return;
  }
  const displaySlide = e.target.closest('[data-display-slide]');
  const displaySort = e.target.closest('[data-display-sort]');
  if (displaySort) {
    state.mostradorSort = displaySort.dataset.displaySort;
    paintMostrador();
    return;
  }
  if (displaySlide) {
    state.mostradorSlide = Number(displaySlide.dataset.displaySlide);
    paintMostrador();
    return;
  }
  if (e.target.closest('[data-display-next], [data-display-prev]')) {
    state.mostradorSlide =
      (state.mostradorSlide + (e.target.closest('[data-display-next]') ? 1 : 4)) % 5;
    paintMostrador();
    return;
  }
  if (e.target.closest('[data-display-pause]')) {
    state.mostradorPaused = !state.mostradorPaused;
    paintMostrador();
    return;
  }
  if (e.target.closest('[data-display-fullscreen]')) {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
    return;
  }
  const deleteTarget = e.target.closest('[data-target-delete]');
  if (deleteTarget) {
    const button = deleteTarget;
    button.disabled = true;
    sendJson(
      `/api/commercial/targets?id=${encodeURIComponent(button.dataset.targetDelete)}`,
      'DELETE'
    )
      .then(() => load(true))
      .catch((error) => {
        $('#target-error').textContent = error.message;
        button.disabled = false;
      });
    return;
  }
  const deleteCommission = e.target.closest('[data-commission-delete]');
  if (deleteCommission) {
    deleteCommission.disabled = true;
    sendJson(
      `/api/commercial/commissions?id=${encodeURIComponent(deleteCommission.dataset.commissionDelete)}`,
      'DELETE'
    )
      .then(() => load(true))
      .catch((error) => {
        $('#seller-commission-error').textContent = error.message;
        deleteCommission.disabled = false;
      });
    return;
  }
  const invoice = e.target.closest('[data-invoice]');
  if (invoice) {
    openInvoice(
      invoice.dataset.invoice,
      invoice.dataset.invoiceType,
      invoice.dataset.invoiceCompany,
      invoice.dataset.invoiceCanceled === 'true'
    ).catch(() => {
      $('#notice').innerHTML =
        '<div class="notice">Não foi possível abrir esta NF-e agora. Tente novamente.</div>';
    });
    return;
  }
  const tax = e.target.closest('[data-tax]');
  if (tax) {
    state.selectedTax = tax.dataset.tax;
    state.documentLimit = 60;
    taxDashboard();
    return;
  }
  if (e.target.closest('[data-document-more]')) {
    state.documentLimit += 60;
    if (state.view === 'emitidas') outgoingDocuments();
    else if (state.view === 'recebidas') incomingDocuments();
    else if (state.view === 'fretes') freightDashboard();
    else if (state.view === 'impostos') taxDashboard();
    return;
  }
  if (e.target.closest('[data-nfe-more]')) {
    state.nfeLimit += 50;
    nfeBreakdown();
  }
  const chartMode = e.target.closest('[data-chart-mode]');
  if (chartMode && state.nfeData) {
    state.nfeChartMode = chartMode.dataset.chartMode;
    nfeDashboard();
  }
  const close = e.target.closest('[data-close]');
  if (close) close.closest('dialog').close();
  const clear = e.target.closest('[data-clear]');
  if (clear) go(state.view, { [clear.dataset.clear]: null });
  if (e.target.closest('#clear-all'))
    go(state.view, { vendedor: null, grupo: null, cliente: null, produto: null, fornecedor: null });
  const p = e.target.closest('[data-page]');
  if (p) {
    state.page += Number(p.dataset.page);
    paintTable();
  }
  const company = e.target.closest('[data-company]');
  if (company) changeCompany(company.dataset.company);
  const doc = e.target.closest('[data-doc]');
  if (doc) openDoc(doc.dataset.doc, doc.dataset.buy === 'true');
  if (e.target.closest('[data-retry]')) load();
  if (e.target.closest('dialog a')) e.target.closest('dialog').close();
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'target-scope') {
    $('#target-company-field').hidden = e.target.value !== 'company';
    $('#target-seller-field').hidden = e.target.value !== 'seller';
    return;
  }
  if (e.target.id === 'target-kind') {
    const period = $('#target-period');
    const value = period.value || `${today().slice(0, 7)}-01`;
    period.value =
      e.target.value === 'year'
        ? `${value.slice(0, 4)}-01-01`
        : e.target.value === 'quarter'
          ? `${value.slice(0, 4)}-${String(Math.floor((Number(value.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, '0')}-01`
          : `${value.slice(0, 7)}-01`;
    return;
  }
  const input = e.target.closest('[data-rate]');
  if (!input) return;
  try {
    parseRate(input.value);
    const next = structuredClone(state.rules);
    if (input.dataset.rate === 'geral') next.geral = input.value;
    else next[input.dataset.rate][input.dataset.id] = input.value;
    localStorage.setItem('max-crm-commission-v1', JSON.stringify(next));
    state.rules = next;
    input.setAttribute('aria-invalid', 'false');
    $('#rate-error').textContent = '';
    $('#commission-summary').innerHTML = commissionSummary();
    paintTable();
  } catch (error) {
    input.setAttribute('aria-invalid', 'true');
    $('#rate-error').textContent = error.message;
  }
});
document.addEventListener('submit', async (event) => {
  if (event.target.id === 'seller-commission-form') {
    event.preventDefault();
    const form = event.target;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await sendJson('/api/commercial/commissions', 'POST', Object.fromEntries(new FormData(form)));
      await load(true);
    } catch (error) {
      $('#seller-commission-error').textContent = error.message;
      button.disabled = false;
    }
    return;
  }
  if (event.target.id !== 'target-form') return;
  event.preventDefault();
  const form = event.target;
  const fields = new FormData(form);
  const scopeType = fields.get('scopeType');
  const companyNames = {
    1: 'MaxPlast',
    2: 'MaxSafety',
    3: 'MaxSupply',
    4: 'MaxSupply · Filial ES'
  };
  const sellerName = String(fields.get('sellerName') || '').trim();
  const companyKey = String(fields.get('companyKey') || '1');
  const body = {
    scopeType,
    scopeKey: scopeType === 'group' ? 'group' : scopeType === 'company' ? companyKey : sellerName,
    scopeName:
      scopeType === 'group'
        ? 'Grupo MaxCompany'
        : scopeType === 'company'
          ? companyNames[companyKey]
          : sellerName,
    periodKind: fields.get('periodKind'),
    periodStart: fields.get('periodStart'),
    amount: fields.get('amount')
  };
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await sendJson('/api/commercial/targets', 'POST', body);
    await load(true);
  } catch (error) {
    $('#target-error').textContent = error.message;
    button.disabled = false;
  }
});
$('#refresh').innerHTML = icon('refresh');
$('#global-search-icon').innerHTML = icon('search');
function runGlobalSearch() {
  const query = $('#global-search').value.trim();
  if (!query && state.view !== 'busca') return;
  const target = searchUrl(query);
  if (location.hash === target) load(true);
  else location.hash = target;
}
$('#global-search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runGlobalSearch, 450);
});
$('#global-search').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    clearTimeout(searchTimer);
    runGlobalSearch();
  }
});
$('#menu').innerHTML = icon('menu');
$('#sidebar-toggle').innerHTML = icon('arrow');
document.querySelectorAll('[data-close]').forEach((b) => (b.innerHTML = icon('close')));
setSidebar(state.collapsed);
$('#sidebar-toggle').onclick = () => setSidebar(!state.collapsed);
$('#menu').onclick = () => {
  const open = $('#sidebar').classList.toggle('open');
  $('#sidebar-scrim').hidden = !open;
  $('#menu').setAttribute('aria-expanded', String(open));
};
$('#sidebar-scrim').onclick = closeDrawer;
$('#mobile-filters').onclick = () => {
  const open = !document.body.classList.contains('filters-open');
  document.body.classList.toggle('filters-open', open);
  $('#filters-scrim').hidden = !open;
  $('#mobile-filters').setAttribute('aria-expanded', String(open));
};
$('#filters-scrim').onclick = closeFilters;
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeDrawer();
    closeFilters();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    $('#global-search').focus();
    $('#global-search').select();
  }
});
$('#method').onclick = () => $('#method-dialog').showModal();
$('#refresh').onclick = () => load(true);
$('#pause').setAttribute('aria-pressed', 'false');
$('#pause').onclick = () => {
  state.paused = !state.paused;
  $('#pause').textContent = state.paused ? 'Retomar' : 'Pausar';
  $('#pause').setAttribute('aria-pressed', String(state.paused));
};
$('#preset').onchange = (e) => {
  const dates = presetDates(e.target.value, today());
  if (!dates) return;
  [$('#start').value, $('#end').value] = dates;
  applyPeriod();
};
for (const id of ['#start', '#end'])
  $(id).onchange = () => {
    $('#preset').value = matchingPreset($('#start').value, $('#end').value, today());
    applyPeriod();
  };
function applyPeriod() {
  const start = $('#start'),
    end = $('#end');
  if (!start.reportValidity() || !end.reportValidity()) return;
  if (start.value > end.value || Date.parse(end.value) - Date.parse(start.value) > 365 * 86400000) {
    $('#notice').innerHTML =
      '<div class="notice">Selecione um período válido de 1 a 366 dias.</div>';
    return;
  }
  $('#notice').innerHTML = '';
  go(state.view, {
    inicio: start.value,
    fim: end.value,
    empresa: $('#company').value,
    papel: document.querySelector('.role-select').offsetParent ? $('#role').value : null,
    efeito: $('#financial-effect').value || null,
    cfop: $('#cfop-filter').value || null
  });
}
$('#financial-effect').onchange = applyPeriod;
$('#cfop-filter').onchange = () => {
  if ($('#cfop-filter').value && !/^\d{4}$/.test($('#cfop-filter').value)) {
    $('#cfop-filter').reportValidity();
    return;
  }
  applyPeriod();
};
function changeCompany(id) {
  $('#company').value = id;
  go(state.view, {
    empresa: id || null,
    grupoClienteNfe: null,
    clienteNfe: null,
    vendedorNfe: null,
    produtoNfe: null,
    cliente: null,
    vendedor: null,
    grupo: null,
    produto: null,
    fornecedor: null
  });
}
$('#role').onchange = () => go(state.view, { papel: $('#role').value });
$('#company').onchange = () => changeCompany($('#company').value);
window.addEventListener('hashchange', route);
$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    const user = await sendJson('/api/auth/login', 'POST', Object.fromEntries(new FormData(form)));
    form.reset();
    showApp(user);
  } catch (error) {
    $('#login-error').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
$('#logout').onclick = async () => {
  try {
    await sendJson('/api/auth/logout', 'POST');
  } finally {
    showLogin();
  }
};
bootstrap();
let resumeTimer;
function resumeLive() {
  if (document.hidden || state.paused) return;
  clearTimeout(resumeTimer);
  resumeTimer = setTimeout(() => load(true), 300);
}
document.addEventListener('visibilitychange', resumeLive);
window.addEventListener('online', resumeLive);
window.addEventListener('pageshow', resumeLive);
window.addEventListener('focus', resumeLive);
setInterval(() => {
  if (
    !state.paused &&
    !document.hidden &&
    !document.querySelector('dialog[open]') &&
    !['INPUT', 'SELECT'].includes(document.activeElement.tagName) &&
    !['comissoes', 'usuarios', 'mostrador', 'metas'].includes(state.view)
  )
    load(true);
}, 10000);
setInterval(() => {
  if (state.view === 'mostrador') paintMostrador();
}, 1000);
setInterval(() => {
  const display = document.querySelector('.display-shell');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (
    state.view === 'mostrador' &&
    !state.mostradorPaused &&
    !document.hidden &&
    !reducedMotion &&
    !display?.matches(':hover') &&
    !display?.matches(':focus-within')
  ) {
    state.mostradorSlide = (state.mostradorSlide + 1) % 5;
    paintMostrador();
  }
}, 20000);
setInterval(() => {
  if (state.view === 'mostrador' && !document.hidden && !state.paused) load(true);
}, 60000);
