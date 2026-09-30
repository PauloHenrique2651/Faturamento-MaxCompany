import {
  FINANCIAL_CFOPS,
  financialSaleItemValue,
  financialSaleValue,
  financialPurchaseValue
} from './financial-cfops.js';

const round = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const normalize = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
const items = (document) =>
  Array.isArray(document.itemsDetail)
    ? document.itemsDetail
    : Array.isArray(document.items)
      ? document.items
      : [];
const unitPrice = (item) => {
  const quantity = Number(item.quantity);
  const value = Number(item.value) - Number(item.discount || 0);
  return quantity > 0 && value > 0 ? value / quantity : null;
};
const itemKeys = (item) => {
  const ncm = String(item.ncm || '').trim();
  const unit = normalize(item.unit);
  if (!ncm || !unit) return [];
  const keys = [];
  if (Number(item.erpProductId) > 0) keys.push(`erp:${ncm}:${unit}:${item.erpProductId}`);
  if (/^\d{8,14}$/.test(String(item.gtin || ''))) keys.push(`gtin:${ncm}:${unit}:${item.gtin}`);
  const name = normalize(item.name);
  if (name.length >= 12) keys.push(`name:${ncm}:${unit}:${name}`);
  return keys;
};

const companyId = (document) =>
  Number(document.companyId) ||
  {
    MaxPlast: 1,
    MaxSafety: 2,
    MaxSupply: 3,
    'MaxSupply - Filial ES': 4,
    'MaxSupply · Filial ES': 4
  }[document.company];
const tokens = (value) =>
  new Set(
    normalize(value)
      .split(' ')
      .filter((word) => word.length > 2)
  );
const similarity = (left, right) => {
  const a = tokens(left),
    b = tokens(right);
  return [...a].filter((word) => b.has(word)).length / Math.max(1, a.size, b.size);
};

export function purchaseSuggestions(outgoing, incoming, equivalences = []) {
  const purchasesByNcm = new Map();
  for (const document of incoming?.documents || []) {
    if (financialPurchaseValue(document) <= 0) continue;
    for (const item of items(document)) {
      if (!FINANCIAL_CFOPS.has(String(item.cfop || ''))) continue;
      if (!item.code || !item.ncm || !item.unit || unitPrice(item) === null) continue;
      const key = `${companyId(document)}:${item.ncm}:${normalize(item.unit)}`;
      const list = purchasesByNcm.get(key) || [];
      list.push({ document, item });
      purchasesByNcm.set(key, list);
    }
  }
  const seen = new Set();
  const suggestions = [];
  for (const sale of outgoing?.documents || []) {
    if (financialSaleValue(sale) <= 0) continue;
    for (const item of items(sale)) {
      if (financialSaleItemValue(sale, item) <= 0) continue;
      const saleKey = `${companyId(sale)}:${item.code}:${item.ncm}:${normalize(item.unit)}`;
      if (!item.code || seen.has(saleKey)) continue;
      seen.add(saleKey);
      let best = null;
      for (const candidate of purchasesByNcm.get(
        `${companyId(sale)}:${item.ncm}:${normalize(item.unit)}`
      ) || []) {
        if (candidate.document.date >= sale.date) continue;
        if (
          equivalences.some(
            (row) =>
              row.company_id === companyId(sale) &&
              row.sale_code === String(item.code) &&
              row.purchase_supplier_id ===
                String(candidate.document.supplier?.id || '').replace(/\D/g, '') &&
              row.purchase_code === String(candidate.item.code)
          )
        )
          continue;
        if (item.erpProductId && candidate.item.erpProductId) continue;
        const score = similarity(item.name, candidate.item.name);
        if (score >= 0.7 && (!best || score > best.score))
          best = { sale, item, purchase: candidate.document, purchaseItem: candidate.item, score };
      }
      if (best) suggestions.push(best);
    }
  }
  return suggestions.sort((a, b) => b.score - a.score).slice(0, 30);
}

export function reconcilePurchases(outgoing, incoming, options = {}) {
  const lookbackDays = options.lookbackDays || 365;
  const equivalences = options.equivalences || [];
  const sales = (outgoing?.documents || []).filter((row) => financialSaleValue(row) > 0);
  const purchases = (incoming?.documents || []).filter((row) => financialPurchaseValue(row) > 0);
  const index = new Map();
  for (const row of purchases) {
    for (const item of items(row)) {
      if (!FINANCIAL_CFOPS.has(String(item.cfop || ''))) continue;
      const price = unitPrice(item);
      if (price === null) continue;
      const mapped = equivalences
        .filter(
          (entry) =>
            entry.company_id === companyId(row) &&
            entry.purchase_supplier_id === String(row.supplier?.id || '').replace(/\D/g, '') &&
            entry.purchase_code === String(item.code) &&
            entry.ncm === String(item.ncm) &&
            normalize(entry.unit) === normalize(item.unit)
        )
        .map((entry) => `mapped:${entry.ncm}:${normalize(entry.unit)}:${entry.sale_code}`);
      for (const key of [...itemKeys(item), ...mapped]) {
        const scoped = `${companyId(row)}:${key}`;
        const list = index.get(scoped) || [];
        list.push({ date: row.date, price, document: row, item });
        index.set(scoped, list);
      }
    }
  }
  for (const list of index.values()) list.sort((a, b) => b.date.localeCompare(a.date));
  const matches = [];
  let saleLines = 0;
  let unmatchedLines = 0;
  let ambiguousLines = 0;
  for (const sale of sales) {
    for (const item of items(sale)) {
      if (financialSaleItemValue(sale, item) <= 0) continue;
      const salePrice = unitPrice(item);
      if (salePrice === null) continue;
      saleLines++;
      let match = null;
      let ambiguous = false;
      const keys = [...itemKeys(item), `mapped:${item.ncm}:${normalize(item.unit)}:${item.code}`];
      for (const key of keys) {
        const candidates = (index.get(`${companyId(sale)}:${key}`) || []).filter((candidate) => {
          if (
            item.erpProductId &&
            candidate.item.erpProductId &&
            Number(item.erpProductId) !== Number(candidate.item.erpProductId)
          )
            return false;
          const days = (Date.parse(sale.date) - Date.parse(candidate.date)) / 86400000;
          return days > 0 && days <= lookbackDays;
        });
        if (!candidates.length) continue;
        const sameDay = candidates.filter((candidate) => candidate.date === candidates[0].date);
        const prices = sameDay.map((candidate) => candidate.price);
        if (Math.max(...prices) / Math.min(...prices) > 1.01) {
          ambiguous = true;
          break;
        }
        match = {
          ...candidates[0],
          basis: key.startsWith('erp:')
            ? 'Código interno MASERP, NCM e unidade'
            : key.startsWith('gtin:')
              ? 'GTIN, NCM e unidade'
              : key.startsWith('mapped:')
                ? 'Equivalência aprovada, NCM e unidade'
                : 'Descrição exata, NCM e unidade'
        };
        break;
      }
      if (ambiguous) {
        ambiguousLines++;
        continue;
      }
      if (!match) {
        unmatchedLines++;
        continue;
      }
      const quantity = Number(item.quantity);
      const saleValue = round(salePrice * quantity);
      const purchaseValue = round(match.price * quantity);
      matches.push({
        saleKey: sale.key,
        saleCompany: sale.company,
        saleCompanyId: companyId(sale),
        saleNumber: sale.number,
        saleDate: sale.date,
        itemName: item.name,
        itemCode: item.code,
        erpProductId: item.erpProductId || null,
        ncm: item.ncm,
        quantity,
        unit: item.unit,
        saleValue,
        purchaseUnitPrice: round(match.price),
        purchaseReferenceValue: purchaseValue,
        difference: round(saleValue - purchaseValue),
        purchaseKey: match.document.key,
        purchaseNumber: match.document.number,
        purchaseDate: match.date,
        supplier: match.document.supplier?.name || '',
        basis: match.basis
      });
    }
  }
  const sum = (field) => round(matches.reduce((total, row) => total + row[field], 0));
  return {
    saleDocuments: sales.length,
    purchaseDocuments: purchases.length,
    saleLines,
    matchedLines: matches.length,
    unmatchedLines,
    ambiguousLines,
    matchedSaleValue: sum('saleValue'),
    purchaseReferenceValue: sum('purchaseReferenceValue'),
    difference: sum('difference'),
    matches
  };
}
