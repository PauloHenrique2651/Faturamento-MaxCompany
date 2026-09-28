const safe = (value, max = 200) =>
  String(value || '')
    .trim()
    .slice(0, max);
const validId = (value) => /^[0-9a-f-]{36}$/i.test(value);

export function validateEquivalence(body) {
  const companyId = Number(body.companyId);
  const saleCode = safe(body.saleCode, 100);
  const saleName = safe(body.saleName);
  const supplierId = safe(body.supplierId, 20).replace(/\D/g, '');
  const purchaseCode = safe(body.purchaseCode, 100);
  const purchaseName = safe(body.purchaseName);
  const ncm = safe(body.ncm, 8);
  const unit = safe(body.unit, 10).toUpperCase();
  if (![1, 2, 3, 4].includes(companyId) || !saleCode || !purchaseCode || !saleName || !purchaseName)
    throw new Error('Informe os dois códigos e a empresa.');
  if (!/^\d{14}$/.test(supplierId) || !/^\d{8}$/.test(ncm) || !unit)
    throw new Error('CNPJ, NCM ou unidade inválidos.');
  return {
    company_id: companyId,
    sale_code: saleCode,
    sale_name: saleName,
    purchase_supplier_id: supplierId,
    purchase_code: purchaseCode,
    purchase_name: purchaseName,
    ncm,
    unit
  };
}

export async function equivalencesRoute({ url, method, body, user, request }) {
  if (user.role !== 'admin') return { status: 403, body: { error: 'Acesso restrito.' } };
  if (method === 'GET') {
    const rows = await request(
      '/rest/v1/product_equivalences?select=*&order=approved_at.desc&limit=2000'
    );
    return { status: 200, body: rows };
  }
  if (method === 'POST') {
    let fields;
    try {
      fields = validateEquivalence(body);
    } catch (error) {
      return { status: 400, body: { error: error.message } };
    }
    const rows = await request(
      '/rest/v1/product_equivalences?on_conflict=company_id,sale_code,purchase_supplier_id,purchase_code',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=representation'
        },
        body: JSON.stringify({
          ...fields,
          approved_by: user.id,
          approved_at: new Date().toISOString()
        })
      }
    );
    return { status: 200, body: rows[0] };
  }
  if (method === 'DELETE') {
    const id = url.searchParams.get('id') || '';
    if (!validId(id)) return { status: 400, body: { error: 'Equivalência inválida.' } };
    await request(`/rest/v1/product_equivalences?id=eq.${id}`, { method: 'DELETE' });
    return { status: 200, body: { ok: true } };
  }
  return { status: 405, body: { error: 'Método inválido.' } };
}
