import {
  selectMaserpReport,
  commercialBilled,
  monthlyReportPeriods
} from '../public/lib/maserp-periods.js';
import test from 'node:test';
import assert from 'node:assert/strict';
test('virada de mês conserva relatório histórico e nunca usa outra base de período', () => {
  const sept = { available: true, startDate: '2026-09-01', endDate: '2026-09-30' };
  const oct = { available: true, startDate: '2026-10-01', endDate: '2026-10-01' };
  const sync = { maserpSales: oct, maserpReports: { '2026-09': sept } };
  assert.equal(selectMaserpReport(sync, { inicio: '2026-09-01', fim: '2026-09-30' }), sept);
  assert.equal(selectMaserpReport(sync, { inicio: '2026-09-01', fim: '2026-09-29' }), null);
  assert.deepEqual(monthlyReportPeriods('2026-01-01'), [
    ['2026-01-01', '2026-01-01'],
    ['2025-12-01', '2025-12-31']
  ]);
});
test('faturamento comercial não usa o total fiscal legado', () => {
  assert.equal(commercialBilled({ billed: 3891549.7, cohortBilled: 2688556.73 }), 2688556.73);
  assert.equal(commercialBilled({ billed: 20, cohortBilled: 0 }), 0);
  assert.equal(commercialBilled({ billed: 100 }), 100);
});
