const ids = { 1: 1, 3: 2, 5: 3, 6: 4 };
const round = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function applyProductReferences(rows, references, direction, catalog = []) {
  const index = new Map();
  const supplierIndex = new Map();
  const supplierKey = (id, code, ncm, unit) =>
    `${String(id || '').replace(/\D/g, '')}/${String(code || '').trim()}/${String(ncm || '').replace(/\D/g, '')}/${String(
      unit || ''
    )
      .trim()
      .toUpperCase()}`;
  for (const ref of catalog) {
    const key = supplierKey(ref.supplierId, ref.supplierCode, ref.ncm, ref.unit);
    const list = supplierIndex.get(key) || [];
    list.push(ref);
    supplierIndex.set(key, list);
  }
  for (const ref of references) {
    const key = `${ids[ref.companyCode]}/${ref.direction}/${String(ref.accessKey).trim()}/${ref.sequence}`;
    const list = index.get(key) || [];
    list.push(ref);
    index.set(key, list);
  }
  return rows.map((row) => {
    const id =
      row.companyId ||
      { MaxPlast: 1, MaxSafety: 2, MaxSupply: 3, 'MaxSupply · Filial ES': 4 }[row.company];
    const detail = Array.isArray(row.itemsDetail)
      ? row.itemsDetail
      : Array.isArray(row.items)
        ? row.items
        : null;
    if (!detail) return row;
    const itemsDetail = detail.map((item, position) => {
      const list =
        index.get(`${id}/${direction}/${row.key}/${item.line || item.sequence || position + 1}`) ||
        [];
      const valid = list.filter(
        (ref) =>
          Number(ref.productId) > 0 &&
          String(ref.unit || '')
            .trim()
            .toUpperCase() ===
            String(item.unit || '')
              .trim()
              .toUpperCase() &&
          Math.abs(Number(ref.quantity) - Number(item.quantity)) < 0.00001 &&
          Math.abs(Number(ref.price) * Number(ref.quantity) - Number(item.value)) <= 0.03 &&
          (!String(ref.ncm || '').trim() ||
            String(ref.ncm).replace(/\D/g, '') === String(item.ncm).replace(/\D/g, ''))
      );
      const productIds = new Set(valid.map((ref) => Number(ref.productId)));
      const supplierIds = new Set(
        direction === 'incoming'
          ? (supplierIndex.get(supplierKey(row.supplier?.id, item.code, item.ncm, item.unit)) || [])
              .map((ref) => Number(ref.productId))
              .filter((id) => id > 0)
          : []
      );
      // Remove ligação antiga se a revisão atual deixou de comprová-la.
      const { erpProductId, erpProductSource, ...base } = item;
      return productIds.size === 1
        ? { ...base, erpProductId: [...productIds][0], erpProductSource: 'MASERP: nota e item' }
        : productIds.size === 0 && supplierIds.size === 1
          ? {
              ...base,
              erpProductId: [...supplierIds][0],
              erpProductSource: 'MASERP: cadastro do fornecedor'
            }
          : base;
    });
    return {
      ...row,
      companyId: id,
      itemsDetail,
      ...(Array.isArray(row.items) ? { items: itemsDetail } : {})
    };
  });
}

export function applyInvoiceStates(rows, states) {
  const map = new Map(
    states.map((state) => [`${ids[state.companyCode]}/${state.accessKey}`, state])
  );
  return rows.map((row) => {
    const id =
      row.companyId ||
      { MaxPlast: 1, MaxSafety: 2, MaxSupply: 3, 'MaxSupply · Filial ES': 4 }[row.company];
    const state = map.get(`${id}/${row.key}`);
    if (!state) return row;
    const returnedValue = state.canceled || !state.normalSale ? 0 : round(state.returnedValue);
    return {
      ...row,
      seller: state.sellerName || row.seller,
      canceled: Boolean(row.canceled || state.canceled),
      erp: {
        normalSale: state.normalSale,
        gross: round(state.gross),
        returnedValue,
        netValue: round(state.gross - returnedValue),
        orderNumber: state.orderNumber,
        orderSeries: state.orderSeries,
        sellerCode: state.sellerCode,
        returnedItems: state.returnedItems || []
      }
    };
  });
}

export function registeredSalesReturns(documents) {
  const sales = documents.filter((row) => !row.canceled && row.erp?.normalSale);
  const returned = sales.filter((row) => row.erp.returnedValue > 0);
  const gross = round(sales.reduce((sum, row) => sum + row.erp.gross, 0));
  const value = round(returned.reduce((sum, row) => sum + row.erp.returnedValue, 0));
  return {
    available: sales.length > 0,
    count: returned.length,
    value,
    gross,
    net: round(gross - value),
    invoiceCount: sales.length,
    documents: returned
  };
}

export function saleReturnsValue(outgoing, incoming) {
  return outgoing?.salesReturns?.available
    ? outgoing.salesReturns.value
    : Number(incoming?.returns?.linkedToSaleValue || 0);
}

export function returnKind(row) {
  if (row.saleReference) return 'sales';
  if (row.fiscalOperation?.type === 'return' && (row.direction === 'incoming' || row.supplier))
    return 'sales';
  const kind = row.fiscalOperation?.returnKind;
  if (kind) return kind;
  const codes =
    row.fiscalOperation?.cfops || (row.itemsDetail || []).map((item) => String(item.cfop));
  if (
    codes.some((code) =>
      ['1201', '1202', '2201', '2202', '3201', '3202', '1410', '1411', '2410', '2411'].includes(
        code
      )
    )
  )
    return 'sales';
  if (row.fiscalOperation?.type === 'return')
    return row.direction === 'incoming' || row.supplier ? 'sales' : 'purchase';
  return null;
}
