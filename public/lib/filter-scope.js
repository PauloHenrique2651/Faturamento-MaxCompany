export const fiscalFilterViews = new Set([
  'dashboard',
  'faturamento',
  'dre',
  'devolucoes',
  'emitidas',
  'canceladas',
  'entradas',
  'recebidas',
  'fretes',
  'impostos',
  'vendedores',
  'clientes',
  'produtos',
  'fiscal',
  'mostrador'
]);
export function filterBasis(view) {
  if (['carteira', 'pagar'].includes(view)) return 'Período por vencimento';
  if (view === 'pedidos') return 'Período pela criação do pedido';
  if (view === 'metas') return 'Metas vigentes no período · vendas pela emissão';
  return 'Período pela emissão da nota';
}
export function validPeriod(start, end) {
  const day = (v) =>
    /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    Number.isFinite(Date.parse(v + 'T12:00:00Z')) &&
    new Date(v + 'T12:00:00Z').toISOString().slice(0, 10) === v;
  return (
    day(start) && day(end) && start <= end && Date.parse(end) - Date.parse(start) <= 365 * 86400000
  );
}
export function scopeNavigation(view, source) {
  const p = new URLSearchParams(source);
  if (!fiscalFilterViews.has(view)) {
    p.delete('cfop');
    p.delete('efeito');
  }
  if (view === 'pagar') p.set('aba', 'pagar');
  else if (view !== 'carteira') p.delete('aba');
  return p;
}
export function searchScope(rows, params) {
  const start = params.get('inicio'),
    end = params.get('fim'),
    company = params.get('empresa');
  return rows.filter(
    (r) =>
      (!start || r.date >= start) &&
      (!end || r.date <= end) &&
      (!company || String(r.companyId) === company)
  );
}
export function targetsInScope(rows, params) {
  const start = params.get('inicio'),
    end = params.get('fim'),
    company = params.get('empresa');
  return rows.filter((r) => {
    const months = r.period_kind === 'year' ? 12 : r.period_kind === 'quarter' ? 3 : 1;
    const d = new Date(r.period_start + 'T12:00:00Z');
    const stop = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 0, 12))
      .toISOString()
      .slice(0, 10);
    return (
      r.period_start <= end &&
      stop >= start &&
      (!company || r.scope_type !== 'company' || String(r.scope_key) === company)
    );
  });
}
