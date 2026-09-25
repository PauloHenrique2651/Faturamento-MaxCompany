// A finalidade da NF-e é a evidência principal. CFOP e natureza refinam a
// classificação gerencial; ausência de evidência nunca é promovida a venda.
const outgoingReturnCfops = new Set(['5201', '5202', '6201', '6202']);
const industrialReturnCfops = new Set(['5902', '6902']);
const transferCfops = new Set(['5151', '5152', '5155', '5156', '6151', '6152', '6155', '6156']);
const bonusCfops = new Set(['5910', '6910']);
const saleCfops = new Set([
  '5101',
  '5102',
  '5103',
  '5104',
  '5105',
  '5106',
  '5109',
  '5110',
  '5111',
  '5112',
  '5113',
  '5114',
  '5115',
  '5116',
  '5117',
  '5118',
  '5119',
  '5120',
  '5122',
  '5123',
  '5124',
  '5125',
  '5401',
  '5402',
  '5403',
  '5405',
  '6101',
  '6102',
  '6103',
  '6104',
  '6105',
  '6106',
  '6107',
  '6108',
  '6109',
  '6110',
  '6111',
  '6112',
  '6113',
  '6114',
  '6115',
  '6116',
  '6117',
  '6118',
  '6119',
  '6120',
  '6122',
  '6123',
  '6124',
  '6125',
  '6401',
  '6402',
  '6403',
  '6404',
  '7101',
  '7102',
  '7105',
  '7106'
]);

function category(cfop) {
  if (industrialReturnCfops.has(cfop)) return 'industrial-return';
  if (outgoingReturnCfops.has(cfop)) return 'return';
  if (transferCfops.has(cfop)) return 'transfer';
  if (bonusCfops.has(cfop)) return 'bonus';
  if (saleCfops.has(cfop)) return 'sale';
  return 'other';
}

export function classifyFiscalOperation({ purpose, operation, items = [] }) {
  const cfops = [...new Set(items.map((item) => String(item.cfop || '')).filter(Boolean))];
  if (String(purpose) === '4') return { type: 'return', evidence: 'finNFe=4', cfops };
  if (String(purpose) === '2') return { type: 'complementary', evidence: 'finNFe=2', cfops };
  if (String(purpose) === '3') return { type: 'adjustment', evidence: 'finNFe=3', cfops };
  const name = String(operation || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (!cfops.length) return { type: 'unknown', evidence: 'CFOP não informado', cfops };
  const categories = [...new Set(cfops.map(category))];
  if (categories.length > 1)
    return { type: 'mixed', evidence: 'CFOPs de operações diferentes', cfops };
  const type = categories[0];
  const evidence = {
    sale: 'CFOP de venda',
    return: name.includes('devoluc') ? 'natureza e CFOP de devolução' : 'CFOP de devolução',
    transfer: 'CFOP de transferência',
    bonus: 'CFOP de bonificação',
    'industrial-return': 'CFOP de retorno de industrialização',
    other: String(purpose) === '1' ? 'CFOP fora das regras comerciais' : 'finalidade não informada'
  }[type];
  return { type, evidence, cfops };
}
