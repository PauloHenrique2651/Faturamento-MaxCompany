// Nomes transcritos das duas capturas do menu de relatórios do Falco.
// `view` aponta apenas para uma consulta relacionada já implementada no CRM;
// não significa reprodução fiel do relatório original.
const groups = [
  [
    'Comercial',
    [
      ['Relação de produtos sem giro para comissão'],
      ['Relatório de Atividade na Carteira', 'clientes'],
      ['Relatório de Carteira Cliente', 'clientes'],
      ['Relatório de Clientes', 'clientes'],
      ['Relatório de Clientes Negativos Com Pedidos em Aberto'],
      ['Relatório de comissão', 'comissoes'],
      ['Relatório de Conversão de Orçamento em Pedido', 'orcamentos'],
      ['Relatório de Descontos e Abatimentos elevados'],
      ['Relatório de Extratos Excluídos'],
      ['Relatório de Lucroatividade'],
      ['Relatório de Lucratividade por Vendedor', 'vendedores'],
      ['Relatório de Motivos de Perda'],
      ['Relatório de Orçamentos/Pedidos de Venda - Motivos de Perda'],
      ['Relatório de Pedido de Venda', 'pedidos'],
      ['Relatório de Pedidos Cancelados', 'pedidos'],
      ['Relatório de Pedidos Conferidos', 'pedidos'],
      ['Relatório de Pedidos Entregues Fora do Prazo', 'expedicao'],
      ['Relatório de Pedidos Separados no Período', 'expedicao'],
      ['Relatório de Produtos/Pedidos de Venda Abertos com Estoque Na Filial'],
      ['Relatório de Vendas e Faturamento'],
      ['Relatório de Vendas por vendedor', 'vendedores'],
      ['Relatório Preço de Venda X Preço de Compra']
    ]
  ],
  [
    'Compras, fornecedores e estoque',
    [
      ['Relatório de Anexos do Fornecedor'],
      ['Relatório de Coleta de Fornecedor'],
      ['Relatório de Compras Analítico', 'compras'],
      ['Relatório de Créditos fornecedor'],
      ['Relatório de Entrega do Fornecedor', 'recebimento'],
      ['Relatório de Fornecedor,Cliente Por Vendedor'],
      ['Relatório de Fornecedores', 'fornecedores'],
      ['Relatório de Histórico de Saldo de Produto'],
      ['Relatório de Pendência de Cadastro'],
      ['Relatório de Produtos Alternativos e Acessórios'],
      ['Relatório de Produtos com Lote'],
      ['Relatório de Produtos sem giro'],
      ['Relatório de Rastreio de Documentos'],
      ['Relatório de Romaneio', 'expedicao'],
      ['Relatório de Sell-Out'],
      ['Relatório Prazo de Compras X Prazo de Vendas'],
      ['Relatório Razão Analítico']
    ]
  ],
  [
    'Financeiro',
    [
      ['Relatório de Adiantamentos'],
      ['Relatório de Boletos Baixados no Caixa'],
      ['Relatório de Caixa'],
      ['Relatório de Canhoto'],
      ['Relatório de Cheques Detalhado'],
      ['Relatório de Cobrança de Taxas Bancárias'],
      ['Relatório de Contas a Pagar Mês a Mês', 'pagar'],
      ['Relatório de Contas a Receber', 'receber'],
      ['Relatório de Contratos', 'contratos'],
      ['Relatório de Fluxo de Caixa - Duplicatas'],
      ['Relatório de Grupos de Cobrança'],
      ['Relatório de Títulos divergentes Baixa Banco / Baixa pro Cliente'],
      ['Relatório de Títulos nas Carteiras'],
      ['Relatório Follow-Up Cobrança']
    ]
  ],
  [
    'Fiscal e documentos',
    [
      ['Relatório de Anexos de Notas Fiscais de Entrada'],
      ['Relatório de Carta de Correção Eletrônica'],
      ['Relatório de Controle de Validade - CA'],
      ['Relatório de Desoneração da Folha de Pagamento'],
      ['Relatório de Endereços'],
      ['Relatório de faturamento por cliente', 'dashboard'],
      ['Relatório de faturamento por produto', 'dashboard'],
      ['Relatório de Nota Fiscais X CFOP'],
      ['Relatório de Notas com Convênio/Protocolo e Benefício Fiscal'],
      ['Relatório de Notas Fiscais com ST'],
      ['Relatório de Notas Fiscais de Entrada de Serviço'],
      ['Relatório de Notas Fiscais Emitidas', 'dashboard'],
      ['Relatório de Notas X CFOP'],
      ['Relatório de UF X CFOP'],
      ['Relatório Restituição de impostos']
    ]
  ],
  [
    'Operação e qualidade',
    [
      ['Relatório de Avaliações Gerais do Recebimento', 'recebimento'],
      ['Relatório de Autorização de Devolução'],
      ['Relatório de Obras'],
      ['Relatório de Pedido de Venda de Serviço']
    ]
  ]
];

const fileViews = new Map([
  ['Relatório de Vendas por vendedor', 'vendedores'],
  ['Relatório de faturamento por cliente', 'clientes'],
  ['Relatório de faturamento por produto', 'produtos'],
  ['Relatório de Notas Fiscais Emitidas', 'dashboard'],
  ['Relatório de Nota Fiscais X CFOP', 'fiscal'],
  ['Relatório de Notas X CFOP', 'fiscal'],
  ['Relatório de UF X CFOP', 'fiscal']
]);

export const reports = groups.flatMap(([group, entries]) =>
  entries.map(([name]) => ({ group, name, view: fileViews.get(name) || null }))
);

export const reportGroups = groups.map(([name]) => name);
