// Referência das configurações Falco fornecidas pelo usuário em 26/09/2026.
// O tipo operacional "Venda" do ERP não determina receita comercial.
export const cfopCatalog = [
  {
    codes: ['5102', '6102', '7102', '5405', '6404'],
    name: 'Venda normal / isenta / sem impostos',
    classification: 'Venda',
    revenue: true
  },
  {
    codes: ['1102', '2102', '3102', '1403', '2403'],
    name: 'Entrada normal',
    classification: 'Compra',
    revenue: false
  },
  {
    codes: ['5201', '6201', '7201', '5410', '6410', '5202', '6202', '7202'],
    name: 'Devolução de compra',
    classification: 'Devolução a fornecedor',
    revenue: false
  },
  {
    codes: ['1202', '2202', '3202', '1411', '2411'],
    name: 'Devolução de venda',
    classification: 'Devolução de cliente',
    revenue: false
  },
  {
    codes: ['1353', '2353', '3353'],
    name: 'Entrada de frete em estabelecimento comercial',
    classification: 'Entrada de frete',
    revenue: false
  },
  {
    codes: ['5353', '6353'],
    name: 'Saída de frete em estabelecimento comercial',
    classification: 'Serviço de transporte',
    revenue: false
  },
  {
    codes: ['1152', '2152', '1409'],
    name: 'Entrada de transferência',
    classification: 'Transferência',
    revenue: false
  },
  {
    codes: ['5152', '6152', '5409', '6409'],
    name: 'Saída de transferência',
    classification: 'Transferência',
    revenue: false
  },
  {
    codes: ['5910', '6910'],
    name: 'Saída de brinde',
    classification: 'Brinde / bonificação',
    revenue: false
  },
  {
    codes: ['1910', '2910'],
    name: 'Entrada de brinde',
    classification: 'Brinde recebido',
    revenue: false
  },
  {
    codes: ['1912', '2912', '5912', '6912'],
    name: 'Entrada / saída de demonstração',
    classification: 'Demonstração',
    revenue: false
  },
  {
    codes: ['1917', '2917', '5917', '6917'],
    name: 'Entrada / remessa em consignação',
    classification: 'Consignação sem venda',
    revenue: false
  },
  {
    codes: ['5901', '6901'],
    name: 'Remessa para industrialização por encomenda',
    classification: 'Remessa de industrialização',
    revenue: false
  },
  {
    codes: ['5902', '6902'],
    name: 'Retorno de remessa para industrialização',
    classification: 'Retorno de industrialização',
    revenue: false
  },
  {
    codes: ['1901', '2901'],
    name: 'Entrada para industrialização por encomenda',
    classification: 'Industrialização recebida',
    revenue: false
  },
  {
    codes: ['5915', '6915'],
    name: 'Remessa de mercadoria / bem para conserto ou reparo',
    classification: 'Remessa para conserto',
    revenue: false
  },
  {
    codes: ['5916', '6916'],
    name: 'Retorno de mercadoria / bem recebido para conserto',
    classification: 'Retorno de conserto',
    revenue: false
  },
  {
    codes: ['5922', '6922'],
    name: 'Simples faturamento para entrega futura',
    classification: 'Faturamento antecipado · conciliar',
    revenue: false
  },
  {
    codes: ['5113', '6113'],
    name: 'Faturamento de consignação',
    classification: 'Venda',
    revenue: true
  },
  {
    codes: ['5949', '6949', '7949'],
    name: 'Outras saídas / simples remessa',
    classification: 'Outras operações',
    revenue: false
  },
  {
    codes: ['5923', '6923'],
    name: 'Remessa por conta e ordem de terceiros',
    classification: 'Remessa por conta e ordem',
    revenue: false
  },
  {
    codes: ['5118', '6118', '5119', '6119'],
    name: 'Venda por conta e ordem',
    classification: 'Venda',
    revenue: true
  },
  {
    codes: ['5911', '6911'],
    name: 'Saída de amostra grátis',
    classification: 'Amostra grátis',
    revenue: false
  },
  {
    codes: ['5206', '6206', '7206'],
    name: 'Anulação de aquisição de serviço de transporte',
    classification: 'Anulação de transporte',
    revenue: false
  },
  {
    codes: ['5114', '6114'],
    name: 'Venda de mercadoria adquirida de terceiros',
    classification: 'Venda',
    revenue: true
  },
  {
    codes: ['5116', '6116', '5117', '6117'],
    name: 'Venda originada de encomenda para entrega futura',
    classification: 'Venda · conferir faturamento anterior',
    revenue: true
  },
  {
    codes: ['5908', '6908'],
    name: 'Remessa para locação',
    classification: 'Remessa para locação',
    revenue: false
  },
  {
    codes: ['1556', '2556', '3556'],
    name: 'Compra de material para uso ou consumo',
    classification: 'Uso e consumo',
    revenue: false
  }
];

export function cfopDescription(code) {
  return (
    cfopCatalog.find((row) => row.codes.includes(String(code)))?.classification ||
    'Consultar operação fiscal'
  );
}
