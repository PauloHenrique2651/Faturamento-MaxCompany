import { profitabilityComposition } from './lib/profitability.js';
import { selectMaserpReport, commercialBilled } from './lib/maserp-periods.js';
import { commercialPerformance, selectedDisplayPeriod } from './lib/commercial-performance.js';
import {
  escapeHtml as esc,
  formatMoney as money,
  formatNumber as number,
  todayInBrazil
} from './lib/format.js';

const companies = [
  { id: '', name: 'Grupo MaxCompany', logo: '/brand/max-company-white.webp' },
  { id: '1', name: 'MaxPlast', logo: '/brand/maxplast-color.webp' },
  { id: '2', name: 'MaxSafety', logo: '/brand/maxsafety-color.webp' },
  { id: '3', name: 'MaxSupply', logo: '/brand/maxsupply-color.webp' },
  { id: '4', name: 'MaxSupply · Filial ES', logo: '/brand/maxsupply-color.webp' }
];
const periods = [
  ['today', 'Hoje'],
  ['week', 'Semana'],
  ['month', 'Mês'],
  ['quarter', 'Trimestre'],
  ['year', 'Ano']
];
const slides = ['Resumo', 'Evolução', 'Vendedores', 'Clientes e produtos', 'Critérios'];

function link(view, params, changes = {}) {
  const query = new URLSearchParams(params);
  query.delete('period');
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === '') query.delete(key);
    else query.set(key, String(value));
  }
  return `#${view}?${query}`;
}

function stamp(date) {
  return date
    ? new Date(date).toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
      })
    : 'Ainda não sincronizado';
}

function metric(title, value, detail = '', cls = '') {
  return `<div class="display-metric ${cls}"><span>${esc(title)}</span><strong>${value}</strong>${detail ? `<small>${esc(detail)}</small>` : ''}</div>`;
}

function shortMoney(value) {
  const amount = Number(value || 0);
  if (Math.abs(amount) >= 1000000) return `R$ ${number(amount / 1000000)} mi`;
  if (Math.abs(amount) >= 1000) return `R$ ${number(amount / 1000)} mil`;
  return money(amount);
}

function falcoMetrics(outgoing, selectedCompany) {
  const report = selectMaserpReport(outgoing?.synchronization, outgoing?.period);
  if (
    !report?.available ||
    outgoing?.period?.inicio !== report.startDate ||
    outgoing?.period?.fim !== report.endDate
  )
    return null;
  const companyIds = { 1: 1, 3: 2, 5: 3, 6: 4 };
  const filter = (rows) =>
    (rows || []).filter(
      (row) => !selectedCompany || companyIds[row.companyCode] === Number(selectedCompany)
    );
  const invoices = filter(report.companies);
  const commercial = filter(report.commercial);
  const profitability = filter(report.profitability);
  const sellerProfitability = filter(report.sellerProfitability);
  const incomingFreights = filter(report.incomingFreights);
  const sum = (rows, key) => rows.reduce((total, row) => total + Number(row[key] || 0), 0);
  const sales = sum(commercial, 'sales');
  const salesCost = sum(commercial, 'salesCost');
  const billed = commercial.reduce((total, row) => total + commercialBilled(row), 0);
  const billedCost = sum(commercial, 'billedCost');
  const billedCostCoverage = sum(commercial, 'billedCostCoverage');
  const gross = outgoing.salesReturns?.available
    ? outgoing.salesReturns.gross
    : sum(invoices, 'gross');
  const returned = outgoing.salesReturns?.available
    ? outgoing.salesReturns.value
    : sum(invoices, 'returned');
  const profitabilityCost = sum(profitability, 'cost');
  const profitabilityGrossProfit = sum(profitability, 'profit');
  const incomingFreightExpense = sum(incomingFreights, 'value');
  const profitabilityProfit = profitabilityGrossProfit - incomingFreightExpense;
  const profitabilityExpenses = sum(profitability, 'expenses') + incomingFreightExpense;
  return {
    sales,
    pending: sum(commercial, 'pending'),
    pendingOrders: sum(commercial, 'pendingOrders'),
    billed,
    gross,
    returned,
    net: gross - returned,
    invoices: outgoing.salesReturns?.available
      ? outgoing.salesReturns.invoiceCount
      : sum(invoices, 'count'),
    orders: sum(commercial, 'orders'),
    composition: profitabilityComposition(profitability, incomingFreights),
    profitabilityAvailable: report.available,
    profitabilityGross: sum(profitability, 'gross'),
    profitabilityNet: sum(profitability, 'net'),
    profitabilityCost,
    profitabilityGrossProfit,
    profitabilityProfit,
    profitabilityReturned: sum(profitability, 'returned'),
    profitabilityExpenses,
    falcoExpenses: sum(profitability, 'expenses'),
    incomingFreightExpense,
    profitabilityMarkup: profitabilityCost ? (profitabilityProfit / profitabilityCost) * 100 : null,
    sellerProfitability,
    billedCostCoverage,
    billedProfit: billedCostCoverage - billedCost,
    billedCoveragePct: billed ? (billedCostCoverage / billed) * 100 : null,
    billedMarkup: billedCost ? ((billedCostCoverage - billedCost) / billedCost) * 100 : null,
    salesMarkup: salesCost ? ((sales - salesCost) / salesCost) * 100 : null
  };
}

function sampleIndexes(length, count = 5) {
  if (length <= count) return Array.from({ length }, (_, index) => index);
  return [
    ...new Set(
      Array.from({ length: count }, (_, index) => Math.round((index * (length - 1)) / (count - 1)))
    )
  ];
}

function cumulativeChart(daily) {
  if (!daily.length) return '<p class="display-empty">Nenhuma NF-e de venda no período.</p>';
  const width = 900,
    height = 260,
    left = 68,
    right = 874,
    top = 28,
    bottom = 210;
  const maximum = Math.max(1, ...daily.map((row) => Math.max(row.cumulative, row.target || 0)));
  const x = (index) => left + ((right - left) * index) / Math.max(1, daily.length - 1);
  const y = (value) => bottom - ((bottom - top) * Math.max(0, value)) / maximum;
  const path = (field) =>
    daily
      .filter((row) => row[field] !== null)
      .map(
        (row, index) =>
          `${index ? 'L' : 'M'}${x(daily.indexOf(row)).toFixed(1)},${y(row[field]).toFixed(1)}`
      )
      .join(' ');
  const actual = path('cumulative');
  const target = path('target');
  const last = daily.at(-1);
  const area = `${actual} L${right},${bottom} L${left},${bottom} Z`;
  const ticks = sampleIndexes(daily.length);
  const milestones = sampleIndexes(daily.length, 6)
    .map((index) => {
      const row = daily[index];
      return `<circle class="chart-milestone" style="--i:${index}" cx="${x(index)}" cy="${y(row.cumulative)}" r="4" tabindex="0" aria-label="${esc(row.date)}: ${esc(money(row.cumulative))} acumulados"><title>${esc(row.date)} · ${esc(money(row.cumulative))}</title></circle>`;
    })
    .join('');
  return `<div class="display-chart-head"><div><span class="display-eyebrow">MOVIMENTO FISCAL</span><h2>Acumulado financeiro <span>por emissão de NF-e</span></h2></div><div class="display-legend"><span><i class="actual"></i>Realizado</span>${target ? '<span><i class="goal"></i>Meta</span>' : ''}</div></div><svg class="display-chart" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="cumulative-title cumulative-description"><title id="cumulative-title">Evolução acumulada dos itens financeiros</title><desc id="cumulative-description">O valor acumulado encerra em ${esc(money(last.cumulative))} no dia ${esc(last.date)}.</desc><defs><linearGradient id="display-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8bcbed" stop-opacity=".28"/><stop offset="1" stop-color="#8bcbed" stop-opacity="0"/></linearGradient></defs>${[0, 0.25, 0.5, 0.75, 1].map((part) => `<line x1="${left}" x2="${right}" y1="${y(maximum * part)}" y2="${y(maximum * part)}"/><text x="${left - 10}" y="${y(maximum * part) + 4}" text-anchor="end">${esc(shortMoney(maximum * part).replace('R$ ', ''))}</text>`).join('')}<path class="actual-area" d="${area}"/>${target ? `<path class="goal-line" pathLength="1" d="${target}"/>` : ''}<path class="actual-line" pathLength="1" d="${actual}"/>${milestones}<g class="chart-end-label" transform="translate(${Math.max(left + 88, right - 142)},${Math.max(top, y(last.cumulative) - 42)})"><rect width="142" height="30"/><text x="71" y="20" text-anchor="middle">${esc(shortMoney(last.cumulative))}</text></g>${ticks.map((index) => `<text x="${x(index)}" y="${height - 10}" text-anchor="${index === 0 ? 'start' : index === daily.length - 1 ? 'end' : 'middle'}">${esc(daily[index].date.slice(8) + '/' + daily[index].date.slice(5, 7))}</text>`).join('')}</svg>`;
}

function dailyRhythmChart(daily) {
  if (!daily.length) return '<p class="display-empty">Sem movimento diário no período.</p>';
  const width = 420,
    height = 260,
    left = 12,
    right = 408,
    top = 32,
    bottom = 210;
  const values = daily.map((row) => Math.max(0, Number(row.sales || 0)));
  const peak = Math.max(0, ...values);
  const maximum = Math.max(1, ...values);
  const average = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const step = (right - left) / Math.max(1, values.length);
  const barWidth = Math.max(3, Math.min(16, step * 0.58));
  const y = (value) => bottom - ((bottom - top) * value) / maximum;
  const bars = daily
    .map((row, index) => {
      const value = values[index];
      const barHeight = Math.max(value ? 2 : 0, bottom - y(value));
      const x = left + index * step + (step - barWidth) / 2;
      return `<rect class="rhythm-bar" style="--i:${index}" x="${x.toFixed(1)}" y="${(bottom - barHeight).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" tabindex="0" aria-label="${esc(row.date)}: ${esc(money(row.sales))} em vendas"><title>${esc(row.date)} · vendas ${esc(money(row.sales))} · devoluções ${esc(money(row.returns))}</title></rect>`;
    })
    .join('');
  const bestIndex = values.indexOf(peak);
  const last = daily.at(-1);
  return `<div class="display-chart-head compact"><div><span class="display-eyebrow">PULSO DIÁRIO</span><h2>Vendas por emissão</h2></div><strong>${shortMoney(average)}<small>/ dia corrido</small></strong></div><svg class="display-chart rhythm-chart" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="rhythm-title rhythm-description"><title id="rhythm-title">Vendas financeiras por dia de emissão</title><desc id="rhythm-description">Média diária de ${esc(money(average))}. Melhor dia ${esc(daily[bestIndex].date)} com ${esc(money(peak))}.</desc><line class="average-line" x1="${left}" x2="${right}" y1="${y(average)}" y2="${y(average)}"/><text class="average-label" x="${right}" y="${y(average) - 7}" text-anchor="end">média ${esc(shortMoney(average))}</text>${bars}<text x="${left}" y="${height - 10}">${esc(daily[0].date.slice(8) + '/' + daily[0].date.slice(5, 7))}</text><text x="${right}" y="${height - 10}" text-anchor="end">${esc(last.date.slice(8) + '/' + last.date.slice(5, 7))}</text></svg><p class="display-chart-note">Pico de vendas em <strong>${esc(daily[bestIndex].date.slice(8) + '/' + daily[bestIndex].date.slice(5, 7))}</strong> · ${esc(shortMoney(peak))}</p>`;
}

function sellerRows(sellers, sort, params, profitability = [], limit = 10) {
  if (sort === 'profit') {
    const consolidated = new Map();
    for (const row of profitability) {
      const key = String(row.sellerName || 'Não identificado')
        .trim()
        .toLocaleUpperCase('pt-BR');
      const current = consolidated.get(key) || {
        name: row.sellerName || 'Não identificado',
        count: 0,
        sales: 0,
        cost: 0,
        profit: 0
      };
      current.count += Number(row.count || 0);
      current.sales += Number(row.sales || 0);
      current.cost += Number(row.cost || 0);
      current.profit += Number(row.profit || 0);
      consolidated.set(key, current);
    }
    const rows = [...consolidated.values()].sort((a, b) => b.profit - a.profit);
    const max = Math.max(1, ...rows.map((row) => Math.abs(row.profit)));
    return (
      rows
        .slice(0, limit)
        .map((row, index) => {
          const markup = row.cost ? (row.profit / row.cost) * 100 : null;
          const url = link('vendedores', params, { vendedorNfe: row.name });
          return `<a class="display-rank-row profit ${row.profit < 0 ? 'loss' : ''} ${index < 3 ? 'top' : ''}" style="--i:${index}" href="${esc(url)}"><span class="display-position">${String(index + 1).padStart(2, '0')}</span><span class="display-rank-name">${esc(row.name)}<small>${number(row.count)} notas · vendas ${money(row.sales)} · ${markup === null ? 'sem custo' : `${number(markup)}% sobre custo`}</small></span><span class="display-rank-value">${money(row.profit)}<i style="--bar-width:${Math.max(2, (Math.abs(row.profit) / max) * 100)}%"></i></span></a>`;
        })
        .join('') || '<p class="display-empty">Sem lucratividade por vendedor neste período.</p>'
    );
  }
  const rows = [...sellers];
  if (sort === 'goal')
    rows.sort((a, b) => (b.target ? b.net / b.target : -1) - (a.target ? a.net / a.target : -1));
  if (sort === 'ticket') rows.sort((a, b) => b.net / b.count - a.net / a.count);
  const max = Math.max(1, ...rows.map((row) => row.net));
  return (
    rows
      .slice(0, limit)
      .map((row, index) => {
        const url = link('vendedores', params, { vendedorNfe: row.name });
        const progress = row.target
          ? `${number((row.net / row.target) * 100)}% da meta`
          : 'Meta não cadastrada';
        return `<a class="display-rank-row ${index < 3 ? 'top' : ''}" style="--i:${index}" href="${esc(url)}"><span class="display-position">${String(index + 1).padStart(2, '0')}</span><span class="display-rank-name">${esc(row.name)}<small>${number(row.count)} NF-e · devolvido ${money(row.returns)} · ${esc(progress)}</small></span><span class="display-rank-value">${money(row.net)}<i style="--bar-width:${Math.max(2, (row.net / max) * 100)}%"></i></span></a>`;
      })
      .join('') ||
    '<p class="display-empty">Nenhuma venda com vendedor identificado neste período.</p>'
  );
}

function conciseRanking(rows, params, view, key) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    rows
      .slice(0, 6)
      .map(
        (row, index) =>
          `<a class="display-concise-row" style="--i:${index}" href="${esc(link(view, params, { [key]: row.id || row.name }))}"><span>${String(index + 1).padStart(2, '0')}</span><strong title="${esc(row.name)}">${esc(row.name)}</strong><em>${money(row.value)}</em><i style="--bar-width:${Math.max(2, (row.value / max) * 100)}%"></i></a>`
      )
      .join('') || '<p class="display-empty">Sem registros no período.</p>'
  );
}

export function renderMostrador(outgoing, incoming, targets, params, options = {}) {
  const today = todayInBrazil();
  const periodKey = params.get('period') || 'month';
  const period = selectedDisplayPeriod(periodKey, today, params.get('inicio'), params.get('fim'));
  const selectedCompany = params.get('empresa') || '';
  const company = companies.find((row) => row.id === selectedCompany) || companies[0];
  const result = commercialPerformance(
    outgoing,
    incoming,
    targets,
    period,
    selectedCompany ? Number(selectedCompany) : null
  );
  const hasEntityFilter = [
    'vendedorNfe',
    'clienteNfe',
    'grupoClienteNfe',
    'produtoNfe',
    'cfop',
    'efeito'
  ].some((key) => params.has(key));
  const falco = hasEntityFilter ? null : falcoMetrics(outgoing, selectedCompany);
  const slide = options.slide || 0;
  const sort = options.sort || 'net';
  const fresh =
    outgoing?.synchronization?.fresh ??
    (outgoing?.sourcesTotal > 0 && outgoing?.sourcesAvailable === outgoing?.sourcesTotal);
  const checked =
    outgoing?.synchronization?.updatedAt || outgoing?.lastSyncedAt || outgoing?.checkedAt;
  const status = fresh ? 'Sincronizado' : 'Dados desatualizados';
  const monthly = periodKey === 'month';
  const targetNote = monthly ? 'Meta do mês' : `Meta proporcional · ${period.label.toLowerCase()}`;
  const targetValue = result.target === null ? 'Meta não cadastrada' : money(result.target);
  const pace =
    result.requiredDaily === null
      ? 'Cadastre uma meta para calcular o ritmo necessário.'
      : result.average >= result.requiredDaily
        ? 'Acima do ritmo necessário'
        : 'Abaixo do ritmo necessário';
  const ranking = sellerRows(result.sellers, sort, params, falco?.sellerProfitability);
  const c = falco?.composition;
  const purchased = Number(incoming?.purchaseValue || 0);
  const purchaseCount = Number(incoming?.purchaseCount || 0);
  const profitMarkup =
    falco?.profitabilityMarkup === null || falco?.profitabilityMarkup === undefined
      ? '—'
      : `${number(falco.profitabilityMarkup)}%`;
  const ticket = falco?.invoices
    ? money(falco.gross / falco.invoices)
    : result.sellers.length || outgoing?.operations?.length
      ? money(
          result.gross /
            Math.max(1, outgoing?.operations?.find((row) => row.type === 'sale')?.count || 0)
        )
      : '—';
  const html = `<div class="display-shell ${options.paused ? 'is-paused' : ''}">
    <header class="display-header"><div class="display-identity"><img src="${company.logo}" alt=""/><div><span>GRUPO MAXCOMPANY</span><strong>Performance comercial</strong><small>${esc(company.name)} · ${esc(period.label)}</small></div></div><div class="display-status ${fresh ? 'fresh' : 'stale'}"><span class="display-status-dot"></span><div><strong>${status}</strong><small>Última sincronização ${esc(stamp(checked))}</small></div></div><div class="display-clock" id="display-clock"></div><div class="display-actions"><button type="button" data-display-fullscreen aria-label="Alternar tela cheia">Tela cheia</button><a href="${esc(link('dashboard', params))}">Voltar ao CRM</a></div></header>
    <div class="display-controls"><div class="display-companies" role="group" aria-label="Empresa">${companies.map((row) => `<button type="button" data-display-company="${row.id}" class="${row.id === selectedCompany ? 'active' : ''}">${esc(row.name)}</button>`).join('')}</div><div class="display-periods" role="group" aria-label="Período">${periods.map(([id, label]) => `<button type="button" data-display-period="${id}" class="${id === periodKey ? 'active' : ''}">${label}</button>`).join('')}</div></div>
    <section class="display-slide ${slide === 0 ? 'active' : ''}" data-slide="0">
      <article class="display-profit-card display-profit-priority"><span class="display-kicker">LUCRO DAS VENDAS</span>
        ${c ? `<strong>${money(c.profit)}</strong><div class="display-profit-rate"><span>Após custos, despesas e frete</span><b>${profitMarkup} sobre o custo</b></div>${c.reconciled ? '' : `<p>Conciliação pendente: diferença ${money(c.difference)}</p>`}` : '<strong class="display-no-profit">Aguardando relatório do período</strong>'}
      </article>
      <div class="display-operation-context">
        <a href="${esc(link('emitidas', params, { operacao: 'venda' }))}"><span>Vendas faturadas</span><strong>${money(c?.sales ?? result.gross)}</strong><small>Antes das devoluções</small></a>
        <a href="${esc(link('entradas', params))}"><span>Compras</span><strong>${money(purchased)}</strong><small>Não são o custo das vendas</small></a>
        <a href="${esc(link('canceladas', params))}"><span>Notas canceladas</span><strong>${money(outgoing?.canceledValue || 0)}</strong><small>Já excluídas das vendas</small></a>
        <a href="${esc(link('devolucoes', params, { tipoDevolucao: 'venda' }))}"><span>Vendas devolvidas</span><strong>${money(c?.returned ?? result.returned)}</strong></a>
        <div><span>Custo das vendas</span><strong>${c ? money(c.cost) : '—'}</strong><small>Custo apurado pelo Falco</small></div>
        <a href="${esc(link('fretes', params))}"><span>Frete de entrada</span><strong>${c ? money(c.freight) : '—'}</strong><small>Descontado do lucro</small></a>
      </div>
      <article class="display-hero display-commercial-panel"><span class="display-kicker">PEDIDOS DO PERÍODO</span><div class="display-commercial-flow"><a class="display-flow-card orders" href="${esc(link('faturamento', params))}"><span>Pedidos a faturar</span><b>${falco ? money(falco.pending) : '—'}</b><small>${falco ? number(falco.pendingOrders) + ' pedidos com valor pendente' : 'Aguardando relatório'}</small></a><a class="display-flow-card billed" href="${esc(link('faturamento', params))}"><span>Já faturado desses pedidos</span><b>${falco ? money(falco.billed) : '—'}</b><small>Somente pedidos criados no período selecionado</small></a></div></article>

    </section>
    <section class="display-slide ${slide === 1 ? 'active' : ''}" data-slide="1"><div class="display-section-head"><div><span class="display-kicker">RITMO E TENDÊNCIA</span><h1>Evolução do período</h1><p>Valores fiscais por data de emissão. Confira o horário da última sincronização no cabeçalho.</p></div></div><div class="display-metrics">${metric('Projeção de fechamento', result.projection === null ? 'Aguardando histórico' : money(result.projection), 'Estimativa pelo ritmo recente e dias úteis')}${metric('Dias úteis restantes', String(result.remaining), 'Até o fim do período')}${metric('Ritmo fiscal médio', `${money(result.average)}/dia`, pace, result.requiredDaily !== null && result.average < result.requiredDaily ? 'attention' : '')}${metric('Necessário por dia', result.requiredDaily === null ? '—' : `${money(result.requiredDaily)}/dia`, result.target === null ? 'Meta não cadastrada' : 'Para atingir a meta')}${metric('Movimento hoje', money(result.today), 'Pela data de emissão da NF-e')}${metric('Ticket médio fiscal', ticket, 'Valor fiscal ÷ quantidade de NF-e')}</div><div class="display-chart-grid"><article class="display-chart-wrap">${cumulativeChart(result.daily)}</article><article class="display-chart-wrap rhythm-panel">${dailyRhythmChart(result.daily)}</article></div></section>
    <section class="display-slide ${slide === 2 ? 'active' : ''}" data-slide="2"><div class="display-section-head"><div><span class="display-kicker">EQUIPE COMERCIAL</span><h1>${sort === 'profit' ? 'Lucratividade por vendedor' : 'Ranking de vendedores'}</h1><p>${sort === 'profit' ? 'Lucro, custo e vendas conforme o Relatório de Lucratividade por Vendedor do Falco.' : 'Vendas e devoluções registradas nas notas de origem do Falco.'}</p></div><div class="display-sort" role="group" aria-label="Variação do ranking"><button data-display-sort="net" class="${sort === 'net' ? 'active' : ''}">Vendas após devoluções</button><button data-display-sort="profit" class="${sort === 'profit' ? 'active' : ''}">Lucro Falco</button><button data-display-sort="goal" class="${sort === 'goal' ? 'active' : ''}">% da meta</button><button data-display-sort="ticket" class="${sort === 'ticket' ? 'active' : ''}">Ticket</button></div></div><div class="display-ranking">${ranking}</div><p class="display-footnote">${sort === 'profit' ? 'O percentual é lucro dividido pelo custo. Fretes de entrada permanecem na conciliação geral porque não possuem rateio por vendedor.' : `${number(outgoing?.unattributedCount || 0)} NF-e de venda sem vendedor identificável. Metas individuais aparecem após cadastro.`}</p></section>
    <section class="display-slide ${slide === 3 ? 'active' : ''}" data-slide="3"><div class="display-section-head"><div><span class="display-kicker">CARTEIRA E MIX</span><h1>Clientes e produtos</h1><p>Maiores valores documentados no período.</p></div></div><div class="display-double"><article><h2>Principais grupos de clientes</h2>${conciseRanking(result.topCustomers, params, 'clientes', 'grupoClienteNfe')}</article><article><h2>Produtos por valor bruto dos itens</h2>${conciseRanking(outgoing?.products || [], params, 'produtos', 'produtoNfe')}</article></div></section>
    <section class="display-slide ${slide === 4 ? 'active' : ''}" data-slide="4"><div class="display-section-head"><div><span class="display-kicker">COMPOSIÇÃO E FONTES</span><h1>Critérios dos indicadores</h1></div></div><div class="display-reconciliation"><div><span>NF-e de venda autorizadas</span><strong>${money(result.gross)}</strong></div><div><span>Devoluções de clientes com vínculo confirmado</span><strong>− ${money(result.returned)}</strong></div><div class="total"><span>Vendas após devoluções</span><strong>${money(result.net)}</strong></div></div><div class="display-trust"><article><h2>Fiscal e comercial</h2><p>Faturamento comercial são valores dos pedidos vinculados a notas. O saldo fiscal usa as NF-e de venda identificadas por CFOP. Cancelamentos são excluídos das notas autorizadas; devoluções reduzem o total somente com referência confirmada.</p></article><article><h2>Lucratividade</h2><p>Reproduz o Relatório de Lucratividade do Falco e abate os conhecimentos de frete de entrada como outras despesas. O percentual é o lucro após frete dividido pelo custo das vendas. Compras permanecem separadas.</p></article><article><h2>Atualização</h2><p>Última sincronização: ${esc(stamp(checked))}. O mostrador consulta o CRM a cada 10 segundos; as pastas fiscais e a SEFAZ seguem a cadência dos coletores.</p></article></div></section>
    <footer class="display-footer"><nav aria-label="Telas do mostrador">${slides.map((name, index) => `<button type="button" data-display-slide="${index}" class="${index === slide ? 'active' : ''}" aria-label="${esc(name)}">${String(index + 1).padStart(2, '0')} <span>${esc(name)}</span></button>`).join('')}</nav><div class="display-rotation" aria-hidden="true"><i></i><span>${options.paused ? 'PAUSADO' : 'PRÓXIMA TELA'}</span></div><div><button type="button" data-display-prev aria-label="Tela anterior">Anterior</button><button type="button" data-display-pause>${options.paused ? 'Retomar' : 'Pausar'} rotação</button><button type="button" data-display-next aria-label="Próxima tela">Próxima</button></div></footer>
  </div>`;
  const signature = JSON.stringify({
    periodKey,
    selectedCompany,
    slide,
    sort,
    paused: options.paused,
    target: result.target,
    net: result.net,
    purchased,
    purchaseCount,
    canceled: outgoing?.canceledValue,
    falco: falco && [
      falco.pending,
      falco.pendingOrders,
      falco.billed,
      falco.profitabilityProfit,
      falco.profitabilityCost,
      falco.profitabilityNet,
      falco.profitabilityExpenses,
      falco.sellerProfitability?.map((row) => [row.companyCode, row.sellerCode, row.profit]),
      falco.gross,
      falco.returned
    ],
    returned: result.returned,
    sellers: result.sellers.map((row) => [row.key, row.net, row.target]),
    customers: result.topCustomers.map((row) => [row.id, row.value]),
    products: (outgoing?.products || []).slice(0, 6).map((row) => [row.id, row.value]),
    checked,
    fresh
  });
  return { html, signature, result };
}
