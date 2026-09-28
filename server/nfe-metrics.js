export const taxNames = [
  'ICMS',
  'ICMS-ST',
  'FCP',
  'FCP-ST',
  'DIFAL',
  'IPI',
  'PIS',
  'COFINS',
  'ISS',
  'II'
];

const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const round = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const branches = (node) =>
  Object.values(node || {}).filter((value) => value && typeof value === 'object');
const first = (nodes, field) => {
  for (const node of nodes) if (node?.[field] != null) return number(node[field]);
  return 0;
};

export function itemTaxes(imposto = {}) {
  const icms = branches(imposto.ICMS);
  const ipi = branches(imposto.IPI);
  const pis = branches(imposto.PIS);
  const cofins = branches(imposto.COFINS);
  const iss = branches(imposto.ISSQN);
  const ii = branches(imposto.II);
  const destination = branches(imposto.ICMSUFDest);
  return {
    ICMS: first(icms, 'vICMS'),
    'ICMS-ST': first(icms, 'vICMSST') || first(icms, 'vST'),
    FCP: first(icms, 'vFCP'),
    'FCP-ST': first(icms, 'vFCPST'),
    DIFAL: first(destination.length ? destination : [imposto.ICMSUFDest], 'vICMSUFDest'),
    IPI: first(ipi, 'vIPI'),
    PIS: first(pis, 'vPIS'),
    COFINS: first(cofins, 'vCOFINS'),
    ISS: first(iss.length ? iss : [imposto.ISSQN], 'vISSQN'),
    II: first(ii.length ? ii : [imposto.II], 'vII')
  };
}

export function taxTotals(items) {
  const totals = Object.fromEntries(taxNames.map((name) => [name, 0]));
  for (const item of items) {
    for (const name of taxNames) totals[name] += number(item.taxes?.[name]);
  }
  return Object.fromEntries(Object.entries(totals).map(([name, amount]) => [name, round(amount)]));
}

export function freightInfo(invoice) {
  const code = String(invoice.transp?.modFrete ?? '');
  const modality =
    {
      0: 'CIF',
      1: 'FOB',
      2: 'Terceiros',
      3: 'Próprio remetente',
      4: 'Próprio destinatário',
      9: 'Sem frete'
    }[code] || 'Não identificado';
  return {
    code,
    modality,
    value: number(invoice.total?.ICMSTot?.vFrete),
    carrier: String(invoice.transp?.transporta?.xNome || '').trim(),
    carrierCnpj: String(invoice.transp?.transporta?.CNPJ || '').trim()
  };
}

export function xmlItems(invoice) {
  const details = Array.isArray(invoice.det) ? invoice.det : invoice.det ? [invoice.det] : [];
  return details.map((detail, index) => {
    const product = detail.prod || {};
    const tax = detail.imposto || {};
    const icmsBranch = branches(tax.ICMS)[0] || {};
    const ipiBranch = branches(tax.IPI)[0] || {};
    return {
      line: Number(detail['@_nItem']) || index + 1,
      code: String(product.cProd || ''),
      gtin: /^\d{8,14}$/.test(String(product.cEAN || '')) ? String(product.cEAN) : '',
      order: String(product.xPed || ''),
      name: String(product.xProd || '').trim(),
      ncm: String(product.NCM || ''),
      cfop: String(product.CFOP || ''),
      cst: String(icmsBranch.CST || icmsBranch.CSOSN || ''),
      quantity: number(product.qCom),
      unit: String(product.uCom || ''),
      value: number(product.vProd),
      discount: number(product.vDesc),
      taxBase: number(icmsBranch.vBC),
      icmsRate: number(icmsBranch.pICMS),
      ipiRate: number(ipiBranch.pIPI),
      simpleIcmsCredit: number(icmsBranch.vCredICMSSN),
      taxes: itemTaxes(tax)
    };
  });
}
