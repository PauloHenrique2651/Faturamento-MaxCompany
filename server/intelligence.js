import { runQuery, sql } from './db.js';

const snapshots = new Map();
const refreshMs = Math.max(10, Number(process.env.MASERP_REFRESH_SECONDS || 10)) * 1000;
const query = `
SELECT ven_codigo id, RTRIM(ven_nome) nome, ven_ativo_BT ativo, ven_grupovendedor_IN grupo, ven_tipovendedor_IN tipo FROM vendedor;
SELECT grv_grupovendedor_IN id,RTRIM(grv_descricao_VC) nome FROM grupovendedor_T;
SELECT emp_empresa_IN id,RTRIM(emp_fantasia_VC) nome FROM empresa_T;
SELECT p.emp_empresa_IN empresa,p.ped_pedido_IN numero,RTRIM(p.ped_serie_CH) serie,
 CONVERT(char(10),p.ped_datainclusao_DT,23) dia,p.cli_cliente_IN cliente,RTRIM(c.cli_nomerazao) clienteNome,
 p.ven_vendedor_SI interno,p.ped_vendedorexterno_IN externo,p.ped_objetivo_IN objetivo,
 p.sit_situacao_IN situacao,RTRIM(s.sit_descricao_VC) status,
 i.ite_sequencia_IN sequencia,i.pro_produto_IN produto,RTRIM(i.ite_descricao_VC) produtoNome,
 RTRIM(i.ite_unidade_CH) unidade,i.for_fornecedor_IN fornecedor,
 i.ite_quantidade_NM quantidade,i.ite_quantidadecancelada_NM cancelada,i.ite_preco_MN preco
FROM pedido_T p JOIN itenspedido_T i ON i.emp_empresa_IN=p.emp_empresa_IN AND i.ped_pedido_IN=p.ped_pedido_IN AND i.ped_serie_CH=p.ped_serie_CH
LEFT JOIN cliente c ON c.cli_codigo=p.cli_cliente_IN LEFT JOIN situacao_T s ON s.sit_codigo_IN=p.sit_situacao_IN
WHERE p.ped_datainclusao_DT>=@inicio AND p.ped_datainclusao_DT<DATEADD(day,1,@fim)
 AND p.ped_dataexclusao_DT IS NULL AND ISNULL(p.sit_situacao_IN,0) NOT IN (4,15,19);
SELECT p.emp_empresa_IN empresa,p.ped_pedido_IN numero,CONVERT(char(10),p.ped_datainclusao_DT,23) dia,
 p.for_fornecedor_IN fornecedor,RTRIM(f.for_razao) fornecedorNome,i.pro_produto_IN produto,
 RTRIM(i.ite_descricao_VC) produtoNome,RTRIM(i.ite_unidade_CH) unidade,
 i.ite_quantidade_NM quantidade,i.ite_preco_MN preco,i.ite_quantidadeentregue_NM entregue
FROM pedidocompra_T p JOIN itenspedidocompra_T i ON i.emp_empresa_IN=p.emp_empresa_IN AND i.ped_pedido_IN=p.ped_pedido_IN
LEFT JOIN fornecedor f ON f.for_codigo=p.for_fornecedor_IN
WHERE p.ped_datainclusao_DT>=@inicio AND p.ped_datainclusao_DT<DATEADD(day,1,@fim) AND p.ped_dataexclusao_DT IS NULL;
`;

const addDays = (s, n) =>
  new Date(Date.parse(`${s}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
export function parseFilters(
  params,
  today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
) {
  const fim = params.get('fim') || today,
    inicio = params.get('inicio') || addDays(fim, -29);
  for (const v of [inicio, fim])
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
      !Number.isFinite(Date.parse(v)) ||
      new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) !== v
    )
      throw new Error('Período inválido');
  const dias = Math.round((Date.parse(fim) - Date.parse(inicio)) / 86400000) + 1;
  if (dias < 1 || dias > 366) throw new Error('Selecione entre 1 e 366 dias');
  const f = {
    inicio,
    fim,
    dias,
    anteriorInicio: addDays(inicio, -dias),
    anteriorFim: addDays(inicio, -1),
    papel: params.get('papel') === 'externo' ? 'externo' : 'interno'
  };
  for (const k of ['empresa', 'vendedor', 'grupo', 'cliente', 'produto', 'fornecedor']) {
    const value = params.get(k);
    f[k] = value == null || value === '' ? null : Number(value);
    if (f[k] !== null && (!Number.isSafeInteger(f[k]) || f[k] < 0))
      throw new Error('Filtro inválido');
  }
  return f;
}
export function lineCents(row) {
  return Math.round(
    Math.max(0, Number(row.quantidade || 0) - Number(row.cancelada || 0)) *
      Number(row.preco || 0) *
      100
  );
}
const sum = (rows) => rows.reduce((n, r) => n + r.centavos, 0) / 100;
function aggregate(rows, key, name) {
  const map = new Map();
  for (const r of rows) {
    const id = r[key] ?? 0;
    if (!map.has(id))
      map.set(id, {
        id,
        nome:
          key === 'produto' && id === 0
            ? 'Itens sem código de produto'
            : r[name] || `Sem identificação (${id})`,
        centavos: 0,
        quantidade: 0,
        orders: new Set(),
        clients: new Set(),
        unidades: new Set()
      });
    const g = map.get(id);
    g.centavos += r.centavos;
    g.quantidade += Math.max(0, Number(r.quantidade || 0) - Number(r.cancelada || 0));
    g.orders.add(r.chave);
    g.clients.add(r.cliente);
    if (r.unidade) g.unidades.add(r.unidade);
  }
  return [...map.values()]
    .map((g) => ({
      id: g.id,
      nome: g.nome,
      valor: g.centavos / 100,
      quantidade: g.quantidade,
      pedidos: g.orders.size,
      clientes: g.clients.size,
      unidade: g.unidades.size === 1 ? [...g.unidades][0] : 'Mistas'
    }))
    .sort((a, b) => b.valor - a.valor);
}
function orders(rows, isPurchase = false) {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.chave))
      map.set(r.chave, {
        id: r.chave,
        numero: r.numero,
        empresa: r.empresa,
        serie: r.serie,
        dia: r.dia,
        cliente: r.cliente,
        clienteNome: r.clienteNome,
        vendedor: r.vendedor,
        fornecedor: r.fornecedor,
        fornecedorNome: r.fornecedorNome,
        status: r.status || 'Pedido de compra',
        centavos: 0,
        itens: []
      });
    const d = map.get(r.chave);
    d.centavos += r.centavos;
    d.itens.push({
      produto: r.produto,
      nome: r.produtoNome,
      unidade: r.unidade,
      quantidade: r.quantidade,
      cancelada: r.cancelada || 0,
      preco: r.preco,
      valor: r.centavos / 100
    });
  }
  return [...map.values()]
    .map(({ centavos, ...r }) => ({ ...r, valor: centavos / 100 }))
    .sort((a, b) => b.dia.localeCompare(a.dia) || b.numero - a.numero);
}
export function buildIntelligence(raw, f) {
  const [vendedores, grupos, empresas, sales, purchases] = raw;
  const sellerMap = new Map(vendedores.map((v) => [v.id, v]));
  const common = (r) =>
    (f.empresa === null || r.empresa === f.empresa) &&
    (f.produto === null || (r.produto ?? 0) === f.produto) &&
    (f.fornecedor === null || (r.fornecedor ?? 0) === f.fornecedor);
  const selected = sales
    .map((r) => ({
      ...r,
      vendedor: r[f.papel] || 0,
      vendedorNome: sellerMap.get(r[f.papel])?.nome || 'Sem vendedor',
      grupo: sellerMap.get(r[f.papel])?.grupo ?? 0,
      centavos: lineCents(r),
      chave: `${r.empresa}/${r.numero}/${r.serie}`
    }))
    .filter(
      (r) =>
        common(r) &&
        (f.cliente === null || r.cliente === f.cliente) &&
        (f.vendedor === null || r.vendedor === f.vendedor) &&
        (f.grupo === null || r.grupo === f.grupo)
    );
  const atual = selected.filter((r) => r.dia >= f.inicio && r.dia <= f.fim),
    anterior = selected.filter((r) => r.dia >= f.anteriorInicio && r.dia < f.inicio);
  const bySeller = aggregate(atual, 'vendedor', 'vendedorNome'),
    prevSeller = new Map(
      aggregate(anterior, 'vendedor', 'vendedorNome').map((v) => [v.id, v.valor])
    );
  const scope = vendedores.filter(
    (v) =>
      (f.grupo === null || (v.grupo ?? 0) === f.grupo) &&
      (f.vendedor === null || v.id === f.vendedor)
  );
  const ranking = scope.map((v) => ({
    ...v,
    ...(bySeller.find((r) => r.id === v.id) || {
      valor: 0,
      pedidos: 0,
      clientes: 0,
      quantidade: 0
    }),
    anterior: prevSeller.get(v.id) || 0
  }));
  if (bySeller.some((v) => v.id === 0))
    ranking.push({
      ...bySeller.find((v) => v.id === 0),
      grupo: 0,
      ativo: false,
      anterior: prevSeller.get(0) || 0
    });
  ranking.sort((a, b) => b.valor - a.valor);
  const canBuy = f.vendedor === null && f.grupo === null && f.cliente === null;
  const compra = purchases
    .filter((r) => canBuy && common(r) && r.dia >= f.inicio && r.dia <= f.fim)
    .map((r) => ({ ...r, centavos: lineCents(r), chave: `${r.empresa}/${r.numero}` }));
  const days = [];
  for (let i = 0; i < f.dias; i++) {
    const dia = addDays(f.inicio, i);
    days.push({ dia, valor: 0, anterior: 0 });
  }
  const currentDay = new Map(),
    previousDay = new Map();
  for (const r of atual) currentDay.set(r.dia, (currentDay.get(r.dia) || 0) + r.centavos);
  for (const r of anterior) previousDay.set(r.dia, (previousDay.get(r.dia) || 0) + r.centavos);
  for (let i = 0; i < days.length; i++) {
    days[i].valor = (currentDay.get(days[i].dia) || 0) / 100;
    days[i].anterior = (previousDay.get(addDays(f.anteriorInicio, i)) || 0) / 100;
  }
  const docs = orders(atual),
    compraDocs = orders(compra, true);
  return {
    filtros: f,
    catalogo: { vendedores, grupos, empresas },
    indicadores: {
      vendas: sum(atual),
      anterior: sum(anterior),
      pedidos: docs.length,
      pedidosAnterior: new Set(anterior.map((r) => r.chave)).size,
      clientes: new Set(atual.map((r) => r.cliente)).size,
      clientesAnterior: new Set(anterior.map((r) => r.cliente)).size,
      produtos: new Set(atual.map((r) => r.produto)).size,
      compras: canBuy ? sum(compra) : null,
      objetivos: [...new Set(atual.map((r) => r.objetivo))],
      devolucoesSinalizadas: new Set(
        atual.filter((r) => [57, 58].includes(r.situacao)).map((r) => r.chave)
      ).size
    },
    serie: days,
    vendedores: ranking,
    clientes: aggregate(atual, 'cliente', 'clienteNome'),
    produtos: aggregate(atual, 'produto', 'produtoNome'),
    fornecedores: aggregate(compra, 'fornecedor', 'fornecedorNome'),
    produtosComprados: aggregate(compra, 'produto', 'produtoNome'),
    pedidos: docs,
    compras: compraDocs,
    comprasDisponiveis: canBuy,
    atualizadoEm: raw.atualizadoEm
  };
}
export async function intelligence(params) {
  const f = parseFilters(params),
    key = `${f.anteriorInicio}:${f.fim}`;
  let cached = snapshots.get(key);
  if (!cached || Date.now() - cached.at > refreshMs) {
    const promise = runQuery(query, {
      inicio: { type: sql.Date, value: f.anteriorInicio },
      fim: { type: sql.Date, value: f.fim }
    })
      .then((raw) => {
        raw.atualizadoEm = new Date().toISOString();
        return raw;
      })
      .catch((e) => {
        snapshots.delete(key);
        throw e;
      });
    cached = { at: Date.now(), promise };
    snapshots.set(key, cached);
    if (snapshots.size > 4) snapshots.delete(snapshots.keys().next().value);
  }
  return buildIntelligence(await cached.promise, f);
}
