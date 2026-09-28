import { randomUUID } from 'node:crypto';

const validDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const validId = (value) => /^[0-9a-f-]{36}$/i.test(value);

export function validateTarget(body) {
  const scopeType = String(body.scopeType || '');
  const scopeKey = String(body.scopeKey || '').trim();
  const scopeName = String(body.scopeName || '').trim();
  const periodKind = String(body.periodKind || '');
  const periodStart = String(body.periodStart || '');
  const amount = Number(body.amount);
  if (!['group', 'company', 'seller'].includes(scopeType)) throw new Error('Escopo inválido.');
  if (!scopeKey || scopeKey.length > 100 || !scopeName || scopeName.length > 100)
    throw new Error('Informe o grupo, empresa ou vendedor.');
  if (scopeType === 'group' && scopeKey !== 'group') throw new Error('Grupo inválido.');
  if (scopeType === 'company' && !['1', '2', '3', '4'].includes(scopeKey))
    throw new Error('Empresa inválida.');
  if (!['month', 'quarter', 'year'].includes(periodKind) || !validDate(periodStart))
    throw new Error('Período inválido.');
  if (periodStart.slice(8) !== '01') throw new Error('A meta deve começar no primeiro dia.');
  if (periodKind === 'quarter' && !['01', '04', '07', '10'].includes(periodStart.slice(5, 7)))
    throw new Error('Trimestre inválido.');
  if (periodKind === 'year' && periodStart.slice(5, 7) !== '01') throw new Error('Ano inválido.');
  if (!Number.isFinite(amount) || amount < 0 || amount > 999999999999)
    throw new Error('Valor de meta inválido.');
  return {
    scope_type: scopeType,
    scope_key:
      scopeType === 'seller'
        ? scopeKey
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toUpperCase()
        : scopeKey,
    scope_name: scopeName,
    period_kind: periodKind,
    period_start: periodStart,
    amount: Math.round(amount * 100) / 100
  };
}

export async function salesTargetsRoute({ url, method, body, user, request }) {
  if (user.role !== 'admin') return { status: 403, body: { error: 'Acesso restrito.' } };
  if (method === 'GET') {
    const start = url.searchParams.get('start') || `${new Date().getUTCFullYear()}-01-01`;
    const end = url.searchParams.get('end') || `${new Date().getUTCFullYear()}-12-31`;
    if (!validDate(start) || !validDate(end) || end < start)
      return { status: 400, body: { error: 'Intervalo inválido.' } };
    const yearStart = `${start.slice(0, 4)}-01-01`;
    const rows = await request(
      `/rest/v1/sales_targets?period_start=gte.${yearStart}&period_start=lte.${end}&select=*&order=period_start.desc,scope_type,scope_name&limit=1000`
    );
    return { status: 200, body: rows };
  }
  if (method === 'POST') {
    let target;
    try {
      target = validateTarget(body);
    } catch (error) {
      return { status: 400, body: { error: error.message } };
    }
    const key = new URLSearchParams({
      scope_type: `eq.${target.scope_type}`,
      scope_key: `eq.${target.scope_key}`,
      period_kind: `eq.${target.period_kind}`,
      period_start: `eq.${target.period_start}`,
      select: 'id,created_by'
    });
    const existing = await request(`/rest/v1/sales_targets?${key}`);
    const record = {
      ...target,
      updated_by: user.id,
      updated_at: new Date().toISOString()
    };
    if (existing.length) {
      const updated = await request(`/rest/v1/sales_targets?id=eq.${existing[0].id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify(record)
      });
      return { status: 200, body: updated[0] };
    }
    const created = await request('/rest/v1/sales_targets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ id: randomUUID(), ...record, created_by: user.id })
    });
    return { status: 201, body: created[0] };
  }
  if (method === 'DELETE') {
    const id = url.searchParams.get('id') || '';
    if (!validId(id)) return { status: 400, body: { error: 'Meta inválida.' } };
    await request(`/rest/v1/sales_targets?id=eq.${id}`, { method: 'DELETE' });
    return { status: 200, body: { ok: true } };
  }
  return { status: 405, body: { error: 'Método inválido.' } };
}
