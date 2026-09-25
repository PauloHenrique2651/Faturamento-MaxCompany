import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFilters, lineCents, buildIntelligence } from './intelligence.js';
import { parseRate, rateFor, projectedCommission } from '../public/commission.js';
test('dates: defaults, leap years and invalid intervals', () => {
  const f = parseFilters(new URLSearchParams(), '2026-09-10');
  assert.equal(f.dias, 30);
  assert.equal(f.inicio, '2026-08-12');
  assert.equal(f.anteriorFim, '2026-08-11');
  for (const p of [
    'inicio=2026-02-30',
    'inicio=2026-09-11&fim=2026-09-10',
    'inicio=2024-01-01&fim=2026-09-10',
    'empresa=abc'
  ])
    assert.throws(() => parseFilters(new URLSearchParams(p), '2026-09-10'));
});
test('commission rates: blank is undefined; zero is a rule', () => {
  assert.equal(parseRate(''), null);
  assert.equal(parseRate('0'), 0);
  assert.equal(parseRate('2,5'), 2.5);
  for (const v of ['-1', '101', 'NaN', 'abc', '2.00001']) assert.throws(() => parseRate(v));
  const v = { id: 1, grupo: 2, valor: 100.05 };
  assert.equal(rateFor(v, { geral: '3', grupos: { 2: '4' }, vendedores: { 1: '0' } }).rate, 0);
  assert.equal(rateFor(v, { geral: '3', grupos: { 2: '4' }, vendedores: { 1: '' } }).rate, 4);
  assert.equal(projectedCommission(v, { geral: '2,5' }).valor, 2.5);
  assert.equal(projectedCommission(v, {}).valor, null);
});
test('line arithmetic nets canceled quantity and clamps invalid negative quantities', () => {
  assert.equal(lineCents({ quantidade: 3, cancelada: 1, preco: 10.125 }), 2025);
  assert.equal(lineCents({ quantidade: 1, cancelada: 2, preco: 10 }), 0);
});
test('all dimensions reconcile; selected seller and purchase applicability', () => {
  const sellers = [
    { id: 1, nome: 'A', grupo: 1, ativo: true },
    { id: 2, nome: 'B', grupo: null, ativo: false }
  ];
  const row = {
    empresa: 1,
    numero: 1,
    serie: 'A',
    dia: '2026-09-10',
    cliente: 1,
    clienteNome: 'C',
    interno: 1,
    externo: 2,
    produto: 10,
    produtoNome: 'P',
    quantidade: 2,
    preco: 25,
    fornecedor: 3,
    unidade: 'UN'
  };
  const raw = [
    sellers,
    [{ id: 1, nome: 'Padrão' }],
    [{ id: 1, nome: 'E' }],
    [row, { ...row, numero: 2, produto: 11, preco: 10 }],
    [{ ...row, fornecedorNome: 'F' }]
  ];
  const f = parseFilters(new URLSearchParams(), '2026-09-10'),
    d = buildIntelligence(raw, f);
  for (const key of ['vendedores', 'clientes', 'produtos', 'pedidos'])
    assert.equal(
      d[key].reduce((s, r) => s + r.valor, 0),
      70
    );
  assert.equal(d.indicadores.pedidos, 2);
  assert.equal(
    d.serie.reduce((s, r) => s + r.valor, 0),
    70
  );
  const filtered = buildIntelligence(raw, { ...f, vendedor: 1 });
  assert.equal(filtered.indicadores.vendas, 70);
  assert.equal(filtered.comprasDisponiveis, false);
  assert.equal(filtered.indicadores.compras, null);
  assert.equal(
    buildIntelligence(raw, { ...f, papel: 'externo' }).vendedores.find((v) => v.id === 2).valor,
    70
  );
  assert.equal(buildIntelligence(raw, { ...f, produto: 10 }).indicadores.vendas, 50);
  assert.equal(buildIntelligence(raw, { ...f, grupo: 0 }).indicadores.vendas, 0);
});
