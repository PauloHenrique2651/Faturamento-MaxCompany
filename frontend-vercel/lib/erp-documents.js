const ids = { 1: 1, 3: 2, 5: 3, 6: 4 };
const round = (n) => Math.round((Number(n) || 0) * 100) / 100;

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
