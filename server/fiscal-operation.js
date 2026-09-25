// A finalidade da NF-e é a evidência principal. Os CFOPs abaixo são usados
// apenas como apoio para XMLs antigos sem a finalidade preenchida.
const outgoingReturnCfops = new Set(['5201', '5202', '6201', '6202']);
const industrialReturnCfops = new Set(['5902', '6902']);
const saleCfops = new Set(['5101', '5102', '5405', '6101', '6102', '6108', '7102']);

export function classifyFiscalOperation({ purpose, operation, items = [] }) {
  const cfops = [...new Set(items.map((item) => String(item.cfop || '')).filter(Boolean))];
  if (cfops.some((cfop) => industrialReturnCfops.has(cfop))) {
    const type = cfops.every((cfop) => industrialReturnCfops.has(cfop))
      ? 'industrial-return'
      : 'mixed';
    return { type, evidence: 'CFOP de retorno de industrialização', cfops };
  }
  if (String(purpose) === '4') return { type: 'return', evidence: 'finNFe=4', cfops };
  const name = String(operation || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (cfops.length && cfops.every((cfop) => outgoingReturnCfops.has(cfop)))
    return {
      type: 'return',
      evidence: name.includes('devoluc')
        ? 'natureza e CFOP de devolução'
        : 'CFOP de devolução de compra',
      cfops
    };
  if (cfops.length && cfops.every((cfop) => saleCfops.has(cfop)))
    return { type: 'sale', evidence: 'CFOP de venda', cfops };
  if (cfops.some((cfop) => outgoingReturnCfops.has(cfop)))
    return { type: 'mixed', evidence: 'CFOPs de operações diferentes', cfops };
  return {
    type: 'other',
    evidence: String(purpose) === '1' ? 'finNFe=1' : 'sem indicação de devolução',
    cfops
  };
}
