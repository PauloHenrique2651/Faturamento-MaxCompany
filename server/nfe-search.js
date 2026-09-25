export function normalizeSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim();
}

export function searchQuery(value) {
  const raw = String(value || '').trim();
  const digits = raw.replace(/\D/g, '');
  const cnpj = digits.length === 14 && /^[\d.\/-]+$/.test(raw) ? digits : null;
  const note = raw.match(/^(\d{1,9})(?:\s*[/.-]\s*(\d{1,3}))?$/);
  return {
    raw,
    key: digits.length === 44 && /^[\d\s.\/-]+$/.test(raw) ? digits : null,
    cnpj,
    number: !cnpj && note ? String(Number(note[1])) : null,
    series: note?.[2] ? String(Number(note[2])) : null,
    terms: normalizeSearch(raw).split(/\s+/).filter(Boolean)
  };
}

export function keyMatchesNumber(key, query) {
  if (query.key) return key === query.key;
  if (!query.number) return true;
  const number = String(Number(key.slice(25, 34)));
  const series = String(Number(key.slice(22, 25)));
  return number === query.number && (!query.series || series === query.series);
}

export function matchesInvoice(row, query) {
  if (query.key) return row.key === query.key;
  if (query.cnpj)
    return [row.customer?.id, row.supplier?.id, row.freight?.carrierCnpj].some(
      (id) => String(id || '').replace(/\D/g, '') === query.cnpj
    );
  if (query.number)
    return (
      String(Number(row.number)) === query.number &&
      (!query.series || String(Number(row.series)) === query.series)
    );
  const text = normalizeSearch(
    [
      row.key,
      row.number,
      row.series,
      row.company,
      row.customer?.id,
      row.customer?.name,
      row.customer?.registeredName,
      row.supplier?.id,
      row.supplier?.name,
      row.seller,
      row.operation,
      row.freight?.carrier,
      row.freight?.carrierCnpj,
      ...(row.referencedKeys || []),
      ...(row.items || []).flatMap((item) => [
        item.code,
        item.order,
        item.name,
        item.ncm,
        item.cfop
      ])
    ].join(' ')
  );
  return query.terms.every((term) => text.includes(term));
}

export function searchContext(row, query) {
  if (query.key || query.number) return 'NF-e';
  const fields = [
    ['Cliente', [row.customer?.id, row.customer?.name, row.customer?.registeredName]],
    ['Fornecedor', [row.supplier?.id, row.supplier?.name]],
    ['Vendedor', [row.seller]],
    ['Transportadora', [row.freight?.carrier, row.freight?.carrierCnpj]],
    ['Produto', (row.items || []).flatMap((item) => [item.code, item.name, item.ncm, item.cfop])],
    ['Pedido', (row.items || []).map((item) => item.order)]
  ];
  for (const [label, values] of fields) {
    if (
      values.some((value) => {
        const text = normalizeSearch(value);
        return query.terms.every((term) => text.includes(term));
      })
    )
      return label;
  }
  return 'NF-e';
}
