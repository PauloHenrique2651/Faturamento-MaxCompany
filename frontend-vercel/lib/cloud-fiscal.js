const money = (value) => Math.round((Number(value) || 0) * 100) / 100;
const normalized = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
export const invoiceItems = (row) =>
  Array.isArray(row.itemsDetail) ? row.itemsDetail : Array.isArray(row.items) ? row.items : [];

export function customerGroupFor(row) {
  if (row.customerGroup?.id) return row.customerGroup;
  const customer = row.customer || {};
  const name = normalized(customer.name);
  if (/\bGLOBO COMUNICACAO\b/.test(name)) return { id: 'grupo:globo', name: 'Grupo Globo' };
  if (/\bCSN\b|\b(?:COMPANHIA|CIA) SIDERURGICA NACIONAL\b/.test(name))
    return { id: 'grupo:csn', name: 'Grupo CSN' };
  if (/\bBAKER HUGHES\b/.test(name)) return { id: 'grupo:baker-hughes', name: 'Baker Hughes' };
  const cnpj = String(customer.id || '').replace(/\D/g, '');
  return {
    id: cnpj.length === 14 ? 'cnpj:' + cnpj.slice(0, 8) : 'cadastro:' + customer.id,
    name: customer.name || 'Não identificado'
  };
}

export function scopedDocuments(rows, params) {
  return rows.filter(
    (row) =>
      (!params.get('clienteNfe') || row.customer?.id === params.get('clienteNfe')) &&
      (!params.get('grupoClienteNfe') ||
        customerGroupFor(row).id === params.get('grupoClienteNfe')) &&
      (!params.get('vendedorNfe') ||
        normalized(row.seller) === normalized(params.get('vendedorNfe'))) &&
      (!params.get('produtoNfe') ||
        invoiceItems(row).some((item) => (item.code || item.name) === params.get('produtoNfe')))
  );
}

export function fiscalBreakdown(documents, daily, scope = {}) {
  const products = new Map(),
    customers = new Map(),
    groups = new Map(),
    sellers = new Map();
  const ufs = new Map(),
    cfops = new Map(),
    modalities = new Map(),
    carriers = new Map(),
    regimes = new Map();
  let unattributedCount = 0,
    discountValue = 0,
    creditDocuments = 0;
  const add = (map, id, fields, value, quantity = 0) => {
    const entry = map.get(id) || { ...fields, count: 0, value: 0, quantity: 0 };
    entry.count++;
    entry.value += Number(value) || 0;
    entry.quantity += Number(quantity) || 0;
    map.set(id, entry);
    return entry;
  };
  for (const row of documents) {
    const items = invoiceItems(row);
    const sale = row.fiscalOperation?.type === 'sale';
    const party = row.customer || { id: '', name: 'Não identificado' };
    discountValue += Number(
      row.discount ?? items.reduce((sum, item) => sum + (Number(item.discount) || 0), 0)
    );
    if (row.simpleIcmsCredit > 0) creditDocuments++;
    add(ufs, row.uf || 'Não informado', { name: row.uf || 'Não informado' }, row.value);
    const freight = row.freight || {};
    add(
      modalities,
      freight.modality || 'Não identificado',
      { name: freight.modality || 'Não identificado' },
      freight.value
    );
    if (freight.carrier)
      add(
        carriers,
        freight.carrierCnpj || freight.carrier,
        { name: freight.carrier },
        freight.value
      );
    const regime = regimes.get(row.company) || {
      name: row.company,
      normal: 0,
      simples: 0,
      unknown: 0,
      value: 0
    };
    if (['1', '4'].includes(row.taxRegime)) regime.simples++;
    else if (row.taxRegime === '3') regime.normal++;
    else regime.unknown++;
    regime.value += Number(row.value) || 0;
    regimes.set(row.company, regime);
    if (sale) {
      const customer = add(
        customers,
        party.id || party.name,
        { id: party.id, name: party.registeredName || party.name, registrations: new Set() },
        row.value
      );
      customer.registrations.add(party.name);
      const identity = customerGroupFor(row);
      const group = add(
        groups,
        identity.id,
        { ...identity, cnpjs: new Set(), registrations: new Set() },
        row.value
      );
      group.cnpjs.add(party.id);
      group.registrations.add(party.name);
      if (row.seller)
        add(
          sellers,
          normalized(row.seller),
          { id: normalized(row.seller), name: row.seller },
          row.value
        );
      else unattributedCount++;
    }
    for (const item of items) {
      add(
        cfops,
        item.cfop || 'Não informado',
        { name: item.cfop || 'Não informado' },
        item.value,
        item.quantity
      );
      if (sale)
        add(
          products,
          row.company + ':' + (item.code || item.name),
          { id: item.code || item.name, name: item.name, company: row.company },
          item.value,
          item.quantity
        );
    }
  }
  const ranked = (map) =>
    [...map.values()]
      .map((row) => ({ ...row, value: money(row.value) }))
      .sort((a, b) => b.value - a.value);
  const returns = documents.filter((row) => row.fiscalOperation?.type === 'return');
  const returnValue = money(returns.reduce((sum, row) => sum + row.value, 0));
  const salesByDay = new Map(),
    returnsByDay = new Map();
  for (const row of documents) {
    const map =
      row.fiscalOperation?.type === 'sale'
        ? salesByDay
        : row.fiscalOperation?.type === 'return'
          ? returnsByDay
          : null;
    if (map) map.set(row.date, (map.get(row.date) || 0) + row.value);
  }
  return {
    scope: {
      ...scope,
      customerName:
        documents.find((row) => row.customer?.id === scope.customerId)?.customer?.name || null,
      customerGroupName:
        [...groups.values()].find((row) => row.id === scope.customerGroupId)?.name || null
    },
    customers: ranked(customers).map((row) => ({ ...row, registrations: [...row.registrations] })),
    customerGroups: ranked(groups).map(({ cnpjs, registrations, ...row }) => ({
      ...row,
      cnpjCount: cnpjs.size,
      registrationCount: registrations.size
    })),
    sellers: ranked(sellers),
    products: ranked(products),
    ufs: ranked(ufs),
    cfops: ranked(cfops),
    freightModalities: ranked(modalities),
    carriers: ranked(carriers),
    taxRegimes: ranked(regimes),
    customerCount: customers.size,
    customerGroupCount: groups.size,
    sellerCount: sellers.size,
    unattributedCount,
    discountValue: money(discountValue),
    simpleIcmsCreditDocumentCount: creditDocuments,
    returns: {
      count: returns.length,
      value: returnValue,
      documents: returns,
      itemCount: returns.reduce((sum, row) => sum + invoiceItems(row).length, 0),
      quantity: money(
        returns.reduce(
          (sum, row) =>
            sum + invoiceItems(row).reduce((n, item) => n + (Number(item.quantity) || 0), 0),
          0
        )
      ),
      customerCount: new Set(returns.map((row) => row.customer?.id)).size,
      daily: daily.map((row) => ({
        date: row.date,
        total: row.value,
        value: money(returnsByDay.get(row.date)),
        sale: money(salesByDay.get(row.date))
      }))
    }
  };
}

export function searchDocuments(rows, raw, offset = 0, limit = 40) {
  const query = String(raw || '').trim();
  const digits = query.replace(/\D/g, '');
  const numeric = /^[\d\s./-]+$/.test(query);
  const note = query.match(/^(\d{1,9})(?:\s*[/.-]\s*(\d{1,3}))?$/);
  const terms = normalized(query).split(/\s+/).filter(Boolean);
  const matches = rows.filter((row) => {
    if (!query) return false;
    if (numeric && digits.length === 44) return row.key === digits;
    if (numeric && digits.length === 14)
      return [row.customer?.id, row.supplier?.id, row.freight?.carrierCnpj].includes(digits);
    if (note)
      return (
        Number(row.number) === Number(note[1]) &&
        (!note[2] || Number(row.series) === Number(note[2]))
      );
    const text = normalized(
      [
        row.key,
        row.number,
        row.company,
        row.customer?.id,
        row.customer?.name,
        row.supplier?.id,
        row.supplier?.name,
        row.seller,
        row.operation,
        ...(row.referencedKeys || []),
        ...invoiceItems(row).flatMap((item) => [
          item.code,
          item.name,
          item.ncm,
          item.cfop,
          item.order
        ])
      ].join(' ')
    );
    return terms.every((term) => text.includes(term));
  });
  return {
    query,
    total: matches.length,
    offset,
    limit,
    sources: ['saida', 'entrada'],
    checkedAt: new Date().toISOString(),
    items: matches.slice(offset, offset + limit).map((row) => ({
      key: row.key,
      company: row.company,
      companyId: row.companyId,
      type: row.direction === 'incoming' ? 'entrada' : 'saida',
      number: row.number,
      series: row.series,
      date: row.date,
      value: row.value,
      canceled: row.canceled,
      party: row.direction === 'incoming' ? row.supplier?.name : row.customer?.name,
      seller: row.seller,
      context: 'NF-e'
    }))
  };
}
