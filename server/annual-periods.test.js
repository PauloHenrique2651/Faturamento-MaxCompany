import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveMaserpReport,
  selectMaserpReport,
  orderAtDate
} from '../public/lib/maserp-periods.js';
import { ordersRoute } from './order-route.js';
const report = {
  available: true,
  startDate: '2025-01-01',
  endDate: '2026-10-01',
  checkedAt: '2026-10-01T15:00:00Z',
  incomingFreights: [{ entryDate: new Date('2026-02-01T10:00:00Z'), value: 3 }],
  periodFacts: {
    companies: [
      { companyCode: 1, date: '2026-01-05', count: 1, gross: 40, returned: 0 },
      { companyCode: 1, date: '2026-02-01', count: 1, gross: 60, returned: 10 }
    ],
    profitability: [
      {
        companyCode: 1,
        date: '2026-01-05',
        net: 40,
        cost: 20,
        profit: 20,
        returned: 0,
        expenses: 0
      },
      {
        companyCode: 1,
        date: '2026-02-01',
        net: 50,
        cost: 30,
        profit: 20,
        returned: 10,
        expenses: 0
      }
    ],
    sellerProfitability: [
      {
        companyCode: 1,
        date: '2026-02-01',
        sellerCode: 2,
        sellerName: 'A',
        internal: true,
        count: 1,
        sales: 50,
        cost: 30,
        profit: 20
      }
    ],
    commercial: [
      {
        companyCode: 1,
        date: '2026-01-02',
        orders: 1,
        sales: 100,
        salesCost: 60,
        timeline: [
          { date: '2026-01-05', billed: 40, pending: 60, pendingOrders: 1 },
          { date: '2026-02-01', billed: 100, pending: 0, pendingOrders: 0 }
        ]
      },
      { companyCode: 1, date: '2026-02-02', orders: 1, sales: 10, salesCost: 5, timeline: [] }
    ]
  }
};
test('annual and custom periods retain billing cutoff, returns and the official profit base', () => {
  const jan = deriveMaserpReport(report, { inicio: '2026-01-01', fim: '2026-01-31' });
  assert.equal(jan.commercial[0].billed, 40);
  assert.equal(jan.commercial[0].pending, 60);
  assert.equal(jan.profitability[0].profit, 20);
  assert.equal(jan.incomingFreights.length, 0);
  const year = deriveMaserpReport(report, { inicio: '2026-01-01', fim: '2026-10-01' });
  assert.equal(year.commercial[0].billed, 100);
  assert.equal(year.commercial[0].pending, 10);
  assert.equal(year.commercial[0].pendingOrders, 1);
  assert.equal(year.companies[0].gross, 100);
  assert.equal(year.profitability[0].profit, 40);
  assert.equal(year.incomingFreights[0].value, 3);
  assert.equal(year.sellerProfitability[0].internal, true);
  assert.equal(deriveMaserpReport(report, { inicio: '2024-01-01', fim: '2026-10-01' }), null);
  assert.equal(deriveMaserpReport(report, { inicio: '2026-10-01', fim: '2026-10-02' }), null);
  assert.equal(
    deriveMaserpReport(report, { inicio: '2026-03-01', fim: '2026-03-02' }).commercial.length,
    0
  );
});
test('the most recently reconciled annual facts replace a stale matching monthly snapshot', () => {
  const old = {
    available: true,
    startDate: '2026-01-01',
    endDate: '2026-01-31',
    checkedAt: '2026-09-01',
    commercial: [{ billed: 0 }]
  };
  assert.equal(
    selectMaserpReport(
      { maserpReports: { year: report, jan: old } },
      { inicio: old.startDate, fim: old.endDate }
    ).commercial[0].billed,
    40
  );
  const fresh = { ...old, checkedAt: '2026-10-01T16:00:00Z' };
  assert.equal(
    selectMaserpReport(
      { maserpReports: { year: report, jan: fresh } },
      { inicio: old.startDate, fim: old.endDate }
    ),
    fresh
  );
});
test('order custom filters and PDFs use the same date cutoff as the indicators', async () => {
  const order = {
    id: '1/1/A',
    companyCode: 1,
    number: 1,
    series: 'A',
    date: '2026-01-02',
    total: 100,
    billed: 100,
    pending: 0,
    billingTimeline: report.periodFacts.commercial[0].timeline,
    invoices: [
      { date: '2026-01-05', number: 1 },
      { date: '2026-02-01', number: 2 }
    ],
    items: []
  };
  assert.equal(orderAtDate(order, '2026-01-31').billed, 40);
  assert.equal(orderAtDate(order, '2026-01-31').invoices.length, 1);
  const result = await ordersRoute({
    url: new URL('https://crm?inicio=2026-01-02&fim=2026-01-31'),
    user: { role: 'admin' },
    reports: {
      year: {
        ...report,
        orderCatalog: { path: 'orders/catalog/2025-01/' + 'a'.repeat(24) + '.json' }
      }
    },
    download: async () =>
      new Response(JSON.stringify([order, { ...order, id: '1/2/A', date: '2026-02-02' }]))
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.orders.length, 1);
  assert.equal(result.body.orders[0].pending, 60);
});

test('screen summaries send only the requested figures, preserving full history in the collector', async () => {
  const { summarySynchronization } = await import('../public/lib/maserp-periods.js');
  const s = summarySynchronization(
    { fresh: true, maserpReports: { year: report } },
    { inicio: '2026-01-01', fim: '2026-01-31' }
  );
  assert.equal(s.fresh, true);
  assert.equal(s.maserpSales.commercial[0].billed, 40);
  assert.ok(!s.maserpSales.periodFacts);
  assert.ok(!s.maserpSales.orders);
  assert.deepEqual(s.maserpReports, {});
  assert.ok(report.periodFacts.commercial.length);
});
