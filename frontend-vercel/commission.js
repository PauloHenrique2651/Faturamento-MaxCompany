export const emptyRules = () => ({ geral: '', grupos: {}, vendedores: {} });
export function parseRate(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const text = String(value).trim().replace(',', '.');
  if (!/^\d{1,3}(\.\d{1,4})?$/.test(text))
    throw new Error('Informe um percentual de 0 a 100, com até 4 casas decimais.');
  const rate = Number(text);
  if (rate > 100) throw new Error('O percentual deve estar entre 0 e 100.');
  return rate;
}
export function rateFor(seller, rules) {
  for (const [value, origem] of [
    [rules.vendedores?.[seller.id], 'Vendedor'],
    [rules.grupos?.[seller.grupo ?? 0], 'Grupo'],
    [rules.geral, 'Geral']
  ]) {
    const rate = parseRate(value);
    if (rate !== null) return { rate, origem };
  }
  return { rate: null, origem: 'Não definida' };
}
export function projectedCommission(seller, rules) {
  const result = rateFor(seller, rules);
  return {
    ...result,
    valor:
      result.rate === null
        ? null
        : Math.round((Math.round(seller.valor * 100) * result.rate) / 100) / 100
  };
}
