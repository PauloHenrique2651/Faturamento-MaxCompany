const normalize = (value) =>
  String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
const validId = (value) => /^[0-9a-f-]{36}$/i.test(value);

export function validateCommission(body) {
  const sellerName = String(body.sellerName || '').trim();
  const ratePercent = Number(body.ratePercent);
  if (!sellerName || sellerName.length > 100) throw new Error('Informe o vendedor.');
  if (
    body.ratePercent === '' ||
    !Number.isFinite(ratePercent) ||
    ratePercent < 0 ||
    ratePercent > 100
  )
    throw new Error('Informe um percentual entre 0 e 100.');
  return {
    seller_key: normalize(sellerName),
    seller_name: sellerName,
    rate_percent: Math.round(ratePercent * 10000) / 10000
  };
}

export async function sellerCommissionsRoute({ url, method, body, user, request }) {
  if (user.role !== 'admin') return { status: 403, body: { error: 'Acesso restrito.' } };
  if (method === 'GET') {
    const rows = await request(
      '/rest/v1/seller_commission_rules?select=*&order=seller_name&limit=2000'
    );
    return { status: 200, body: rows };
  }
  if (method === 'POST') {
    let fields;
    try {
      fields = validateCommission(body);
    } catch (error) {
      return { status: 400, body: { error: error.message } };
    }
    const rows = await request('/rest/v1/seller_commission_rules?on_conflict=seller_key', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation'
      },
      body: JSON.stringify({ ...fields, updated_by: user.id, updated_at: new Date().toISOString() })
    });
    return { status: 200, body: rows[0] };
  }
  if (method === 'DELETE') {
    const id = url.searchParams.get('id') || '';
    if (!validId(id)) return { status: 400, body: { error: 'Regra inválida.' } };
    await request(`/rest/v1/seller_commission_rules?id=eq.${id}`, { method: 'DELETE' });
    return { status: 200, body: { ok: true } };
  }
  return { status: 405, body: { error: 'Método inválido.' } };
}
