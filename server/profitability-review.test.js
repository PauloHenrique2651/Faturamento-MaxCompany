import test from 'node:test';
import assert from 'node:assert/strict';
import { profitabilityComposition } from '../public/lib/profitability.js';
import { historicalPage, historicalReportPeriod } from './reconciliation-plan.js';
test('lucro recompõe vendas antes de despesas, sem usar compras ou descontar despesas duas vezes', () => {
  const c = profitabilityComposition(
    [{ gross: 95, net: 90, returned: 5, expenses: 5, cost: 60, profit: 30 }],
    [{ value: 2 }]
  );
  assert.equal(c.sales, 100);
  assert.equal(c.sales - c.returned - c.expenses - c.cost, c.profit);
  assert.equal(c.profit, 30);
  assert.equal(c.freight, 2);
  assert.equal(c.margin, (30 / 95) * 100);
  assert.equal(c.reconciled, true);
  assert.equal(profitabilityComposition([{ net: 90, cost: 60, profit: 29 }]).reconciled, false);
  assert.equal(profitabilityComposition([]).markup, null);
});
test('revisão histórica percorre páginas sem ficar presa nos primeiros 500 documentos', () => {
  const state = {};
  assert.equal(historicalPage(state, Array(500), '2026-10-01').nextOffset, 500);
  assert.equal(historicalPage(state, Array(500), '2026-10-01').nextOffset, 1000);
  assert.equal(historicalPage(state, Array(10), '2026-10-01').completed, true);
  assert.equal(state.historicalCloudOffset, 0);
  assert.equal(state.lastHistoricalCloudSweepAt, '2026-10-01');
});
test('relatórios históricos revisam os últimos 12 meses com limite de cadência e retomam após falha', () => {
  const now = Date.parse('2026-10-01T12:00:00Z');
  const state = {};
  assert.deepEqual(historicalReportPeriod(state, '2020-01-01', '2026-10-01', now), [
    '2026-08-01',
    '2026-08-31'
  ]);
  state.lastHistoricalReportAt = '2026-10-01T12:00:00Z';
  assert.equal(historicalReportPeriod(state, '2020-01-01', '2026-10-01', now + 299000), null);
  state.historicalReportAttempts = { '2026-08': state.lastHistoricalReportAt };
  assert.deepEqual(historicalReportPeriod(state, '2020-01-01', '2026-10-01', now + 300000), [
    '2026-07-01',
    '2026-07-31'
  ]);
  assert.equal(historicalReportPeriod({}, '2026-09-01', '2026-10-01', now), null);
});

test('Total Geral and Total final of the Falco report show expenses exactly once', () => {
  const c = profitabilityComposition(
    [{ net: 3404195.86, returned: 724363.94, expenses: 250, cost: 2218781.4, profit: 1185414.46 }],
    [{ value: 22753.91 }]
  );
  assert.equal(c.notesSubtotal, 4128559.8);
  assert.equal(c.totalWithExpenses, 3404445.86);
  assert.equal(c.sales, 4128809.8);
  assert.equal(c.profit, 1185414.46);
  assert.equal(c.reconciled, true);
  assert.ok(Math.abs(c.totalWithExpenses - c.expenses - c.cost - c.profit) < 0.001);
});
