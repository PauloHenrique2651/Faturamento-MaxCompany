import { commercialPerformance, displayPeriod } from './lib/commercial-performance.js';
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
const slides = ['Visão geral', 'Vendedores', 'Clientes e produtos', 'Critérios'];

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

function cumulativeChart(daily) {
  if (!daily.length) return '<p class="display-empty">Nenhuma NF-e de venda no período.</p>';
  const width = 920,
    height = 220,
    left = 54,
    right = 906,
    top = 16,
    bottom = 178;
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
  return `<div class="display-chart-head"><h2>Faturamento acumulado <span>vs. meta acumulada</span></h2><div><i class="actual"></i> Realizado ${target ? '<i class="goal"></i> Meta' : ''}</div></div><svg class="display-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Evolução acumulada do faturamento líquido e da meta">${[0, 0.5, 1].map((part) => `<line x1="${left}" x2="${right}" y1="${y(maximum * part)}" y2="${y(maximum * part)}"/><text x="3" y="${y(maximum * part) + 4}">${number((maximum * part) / 1000)} mil</text>`).join('')}${target ? `<path class="goal-line" d="${target}"/>` : ''}<path class="actual-line" d="${actual}"/><circle class="actual-dot" cx="${x(daily.length - 1)}" cy="${y(last.cumulative)}" r="5"/><text x="${left}" y="${height - 7}">${esc(daily[0].date.slice(8) + '/' + daily[0].date.slice(5, 7))}</text><text x="${right}" y="${height - 7}" text-anchor="end">${esc(last.date.slice(8) + '/' + last.date.slice(5, 7))}</text></svg>`;
}

function sellerRows(sellers, sort, params, limit = 10) {
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
        return `<a class="display-rank-row ${index < 3 ? 'top' : ''}" href="${esc(url)}"><span class="display-position">${String(index + 1).padStart(2, '0')}</span><span class="display-rank-name">${esc(row.name)}<small>${number(row.count)} NF-e · ${esc(progress)}</small></span><span class="display-rank-value">${money(row.net)}<i style="width:${Math.max(2, (row.net / max) * 100)}%"></i></span></a>`;
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
          `<a class="display-concise-row" href="${esc(link(view, params, { [key]: row.id || row.name }))}"><span>${String(index + 1).padStart(2, '0')}</span><strong title="${esc(row.name)}">${esc(row.name)}</strong><em>${money(row.value)}</em><i style="width:${Math.max(2, (row.value / max) * 100)}%"></i></a>`
      )
      .join('') || '<p class="display-empty">Sem registros no período.</p>'
  );
}

export function renderMostrador(outgoing, incoming, targets, params, options = {}) {
  const today = todayInBrazil();
  const periodKey = params.get('period') || 'month';
  const period = displayPeriod(periodKey, today);
  const selectedCompany = params.get('empresa') || '';
  const company = companies.find((row) => row.id === selectedCompany) || companies[0];
  const result = commercialPerformance(
    outgoing,
    incoming,
    targets,
    period,
    selectedCompany ? Number(selectedCompany) : null
  );
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
  const ranking = sellerRows(result.sellers, sort, params);
  const html = `<div class="display-shell">
    <header class="display-header"><div class="display-identity"><img src="${company.logo}" alt=""/><div><span>GRUPO MAXCOMPANY</span><strong>Performance comercial</strong><small>${esc(company.name)} · ${esc(period.label)}</small></div></div><div class="display-status ${fresh ? 'fresh' : 'stale'}"><span class="display-status-dot"></span><div><strong>${status}</strong><small>Última sincronização ${esc(stamp(checked))}</small></div></div><div class="display-clock" id="display-clock"></div><div class="display-actions"><button type="button" data-display-fullscreen aria-label="Alternar tela cheia">Tela cheia</button><a href="#dashboard">Voltar ao CRM</a></div></header>
    <div class="display-controls"><div class="display-companies" role="group" aria-label="Empresa">${companies.map((row) => `<button type="button" data-display-company="${row.id}" class="${row.id === selectedCompany ? 'active' : ''}">${esc(row.name)}</button>`).join('')}</div><div class="display-periods" role="group" aria-label="Período">${periods.map(([id, label]) => `<button type="button" data-display-period="${id}" class="${id === periodKey ? 'active' : ''}">${label}</button>`).join('')}</div></div>
    <section class="display-slide ${slide === 0 ? 'active' : ''}" data-slide="0"><div class="display-overview"><div class="display-hero"><span class="display-kicker">FATURAMENTO LÍQUIDO DOCUMENTADO</span><strong>${money(result.net)}</strong><p>NF-e de venda autorizadas menos devoluções recebidas vinculadas às vendas.</p><div class="display-hero-strip"><span>Vendas faturadas <b>${money(result.gross)}</b></span><span>Devoluções confirmadas <b>${money(result.returned)}</b></span></div></div><div class="display-goal"><span class="display-kicker">${esc(targetNote)}</span><strong>${targetValue}</strong>${result.target === null ? `<p>Defina a meta em Metas comerciais.</p><a href="#metas">Abrir metas</a>` : `<div class="display-progress"><i style="width:${Math.min(100, Math.max(0, result.progress))}%"></i></div><b>${number(result.progress)}% realizado</b><p>Faltam <strong>${money(result.gap)}</strong></p>`}</div></div><div class="display-metrics">${metric('Projeção de fechamento', result.projection === null ? 'Aguardando histórico' : money(result.projection), 'Estimativa pelo ritmo recente e pelos dias úteis')}${metric('Dias úteis restantes', String(result.remaining), 'Até o fim do período')}${metric('Ritmo atual', `${money(result.average)}/dia`, pace, result.requiredDaily !== null && result.average < result.requiredDaily ? 'attention' : '')}${metric('Necessário por dia', result.requiredDaily === null ? '—' : `${money(result.requiredDaily)}/dia`, result.target === null ? 'Meta não cadastrada' : 'Para atingir a meta')}${metric('Vendas hoje', money(result.today), 'Pela data de emissão da NF-e')}${metric('Ticket por NF-e', result.sellers.length || outgoing?.operations?.length ? money(result.gross / Math.max(1, outgoing?.operations?.find((row) => row.type === 'sale')?.count || 0)) : '—', 'Vendas faturadas ÷ NF-e de venda')}</div><div class="display-chart-wrap">${cumulativeChart(result.daily)}</div></section>
    <section class="display-slide ${slide === 1 ? 'active' : ''}" data-slide="1"><div class="display-section-head"><div><span class="display-kicker">EQUIPE COMERCIAL</span><h1>Ranking de vendedores</h1><p>Vendas identificadas no XML; devoluções vinculadas são abatidas quando o vendedor original está no período.</p></div><div class="display-sort" role="group" aria-label="Ordenar ranking"><button data-display-sort="net" class="${sort === 'net' ? 'active' : ''}">Faturamento</button><button data-display-sort="goal" class="${sort === 'goal' ? 'active' : ''}">% da meta</button><button data-display-sort="ticket" class="${sort === 'ticket' ? 'active' : ''}">Ticket</button></div></div><div class="display-ranking">${ranking}</div><p class="display-footnote">${number(outgoing?.unattributedCount || 0)} NF-e de venda sem vendedor identificável. Metas individuais só aparecem após cadastro.</p></section>
    <section class="display-slide ${slide === 2 ? 'active' : ''}" data-slide="2"><div class="display-section-head"><div><span class="display-kicker">CARTEIRA E MIX</span><h1>Quem impulsiona o resultado</h1></div></div><div class="display-double"><article><h2>Principais grupos de clientes</h2>${conciseRanking(result.topCustomers, params, 'clientes', 'grupoClienteNfe')}</article><article><h2>Produtos por valor bruto dos itens</h2>${conciseRanking(outgoing?.products || [], params, 'produtos', 'produtoNfe')}</article></div></section>
    <section class="display-slide ${slide === 3 ? 'active' : ''}" data-slide="3"><div class="display-section-head"><div><span class="display-kicker">COMPOSIÇÃO</span><h1>Critério do resultado</h1></div></div><div class="display-reconciliation"><div><span>NF-e de venda autorizadas</span><strong>${money(result.gross)}</strong></div><div><span>Devoluções de clientes com vínculo confirmado</span><strong>− ${money(result.returned)}</strong></div><div class="total"><span>Faturamento líquido documentado</span><strong>${money(result.net)}</strong></div></div><div class="display-trust"><article><h2>Fatos verificados</h2><p>Vendas identificadas por CFOP. Cancelamentos excluídos das notas autorizadas. Devoluções abatidas somente com referência confirmada à venda.</p></article><article><h2>Custo, margem e markup</h2><p>Aguardam conciliação de custo por produto e estoque. Entradas da SEFAZ mostram compras e devoluções, mas não determinam o custo da unidade vendida.</p></article><article><h2>Atualização</h2><p>Última sincronização: ${esc(stamp(checked))}. A tela consulta o banco do CRM a cada minuto; o coletor fiscal atualiza os documentos separadamente.</p></article></div></section>
    <footer class="display-footer"><nav aria-label="Telas do mostrador">${slides.map((name, index) => `<button type="button" data-display-slide="${index}" class="${index === slide ? 'active' : ''}" aria-label="${esc(name)}">${String(index + 1).padStart(2, '0')} <span>${esc(name)}</span></button>`).join('')}</nav><div><button type="button" data-display-prev aria-label="Tela anterior">Anterior</button><button type="button" data-display-pause>${options.paused ? 'Retomar' : 'Pausar'} rotação</button><button type="button" data-display-next aria-label="Próxima tela">Próxima</button></div></footer>
  </div>`;
  const signature = JSON.stringify({
    periodKey,
    selectedCompany,
    slide,
    sort,
    paused: options.paused,
    target: result.target,
    net: result.net,
    returned: result.returned,
    sellers: result.sellers.map((row) => [row.key, row.net, row.target]),
    customers: result.topCustomers.map((row) => [row.id, row.value]),
    products: (outgoing?.products || []).slice(0, 6).map((row) => [row.id, row.value]),
    checked,
    fresh
  });
  return { html, signature, result };
}
