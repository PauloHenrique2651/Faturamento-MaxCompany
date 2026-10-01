import test from 'node:test';
import assert from 'node:assert/strict';
import { cashFlow } from '../public/lib/cash-flow.js';
import { financeProjection } from '../public/lib/finance-projection.js';
import {
  scopeNavigation,
  searchScope,
  validPeriod,
  targetsInScope
} from '../public/lib/filter-scope.js';
import { presetDates } from '../public/lib/analysis.js';
const period = { inicio: '2026-10-01', fim: '2026-10-31', today: '2026-10-10' };
test('projeção concilia com as carteiras, exclui atrasados e antecipados e inclui bloqueados uma vez', () => {
  const flow = cashFlow(
    [
      { companyCode: 1, invoiceNumber: 1, amount: 100.15, dueOn: '2026-10-15' },
      { companyCode: 1, invoiceNumber: 2, amount: 200.2, dueOn: '2026-10-31' },
      { companyCode: 1, invoiceNumber: 3, amount: 400, dueOn: '2026-10-09' },
      { companyCode: 1, invoiceNumber: 4, amount: 800, dueOn: '2026-10-15', anticipated: true },
      { companyCode: 5, invoiceNumber: 5, amount: 1600, dueOn: '2026-10-15' }
    ],
    [
      { companyCode: 1, titleNumber: 1, amount: 50.1, dueOn: '2026-10-15', blocked: true },
      { companyCode: 1, titleNumber: 2, amount: 75.25, dueOn: '2026-10-31' },
      { companyCode: 1, titleNumber: 3, amount: 300, dueOn: '2026-10-09' }
    ],
    { ...period, company: '1' }
  );
  const rows = financeProjection(flow, period),
    end = rows.at(-1);
  assert.equal(rows.length, 22);
  assert.equal(rows[0].date, period.today);
  assert.equal(rows[4].net, 0);
  assert.equal(rows[5].net, 50.05);
  assert.equal(end.received, 300.35);
  assert.equal(end.paid, 125.35);
  assert.equal(end.net, 175);
  assert.equal(Number(flow.balance.toFixed(2)), end.net);
  const daily = financeProjection(flow, { ...period, mode: 'daily' });
  assert.equal(daily[6].net, 0);
  assert.equal(daily.at(-1).net, 124.95);
  assert.equal(flow.blocked, 50.1);
  assert.equal(flow.overdueReceivable, 400);
  assert.equal(flow.anticipated, 800);
  assert.deepEqual(financeProjection(flow, { ...period, fim: '2026-10-09' }), []);
});
test('navegação conserva vencimentos e empresa, retira CFOP de carteiras e mantém links legados a pagar', () => {
  const params = new URLSearchParams(
    'inicio=2026-10-01&fim=2026-10-31&empresa=3&cfop=5102&efeito=financeiro'
  );
  const p = scopeNavigation('pagar', params);
  assert.equal(p.get('aba'), 'pagar');
  assert.equal(p.get('empresa'), '3');
  assert.equal(p.get('fim'), '2026-10-31');
  assert.equal(p.has('cfop'), false);
  assert.equal(p.has('efeito'), false);
  assert.equal(scopeNavigation('emitidas', p).has('aba'), false);
  assert.equal(scopeNavigation('carteira', p).get('aba'), 'pagar');
});
test('busca limita documentos à emissão e empresa antes de paginar e metas respeitam sobreposição de período', () => {
  const params = new URLSearchParams('inicio=2026-10-01&fim=2026-10-31&empresa=2');
  const rows = [
    { date: '2026-09-30', companyId: 2 },
    { date: '2026-10-01', companyId: 2 },
    { date: '2026-10-15', companyId: 3 }
  ];
  assert.deepEqual(searchScope(rows, params), [rows[1]]);
  const targets = [
    { period_kind: 'year', period_start: '2026-01-01', scope_type: 'group' },
    { period_kind: 'month', period_start: '2026-09-01', scope_type: 'group' },
    { period_kind: 'quarter', period_start: '2026-10-01', scope_type: 'company', scope_key: 2 },
    { period_kind: 'month', period_start: '2026-10-01', scope_type: 'company', scope_key: 3 }
  ];
  assert.deepEqual(targetsInScope(targets, params), [targets[0], targets[2]]);
});
test('datas rejeitam calendário inválido e permitem ano bissexto, próximos vencimentos atravessam ano', () => {
  assert.equal(validPeriod('2026-02-30', '2026-03-01'), false);
  assert.equal(validPeriod('2026-10-31', '2026-10-01'), false);
  assert.equal(validPeriod('2024-01-01', '2024-12-31'), true);
  assert.equal(validPeriod('2024-01-01', '2025-01-01'), false);
  assert.deepEqual(presetDates('next-30', '2026-12-20'), ['2026-12-20', '2027-01-18']);
});
