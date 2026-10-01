export const viewLabels = {
  busca: 'Busca global',
  dashboard: 'Executivo',
  mostrador: 'Mostrador comercial',
  metas: 'Metas comerciais',
  faturamento: 'Faturamento',
  pedidos: 'Pedidos',
  dre: 'DRE gerencial',
  devolucoes: 'Devoluções',
  emitidas: 'NF-e emitidas',
  canceladas: 'NF-e canceladas',
  entradas: 'Compras e entradas',
  recebidas: 'NF-e recebidas',
  fretes: 'Fretes',
  impostos: 'Impostos destacados',
  vendedores: 'Vendas por vendedor',
  clientes: 'Clientes nas NF-e',
  produtos: 'Produtos nas NF-e',
  fiscal: 'CFOPs e classificação',
  usuarios: 'Usuários'
};

export const navigationSections = [
  [
    'Inteligência',
    [
      ['dashboard', 'dashboard'],
      ['mostrador', 'dashboard'],
      ['metas', 'trend'],
      ['faturamento', 'trend'],
      ['pedidos', 'document'],
      ['dre', 'wallet'],
      ['devolucoes', 'document'],
      ['fretes', 'box'],
      ['impostos', 'document']
    ]
  ],
  [
    'Documentos e comercial',
    [
      ['emitidas', 'document'],
      ['canceladas', 'document'],
      ['entradas', 'document'],
      ['recebidas', 'document'],
      ['vendedores', 'users'],
      ['clientes', 'users'],
      ['produtos', 'box'],
      ['fiscal', 'document']
    ]
  ],
  ['Acesso', [['usuarios', 'users']]]
];
