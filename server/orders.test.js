import test from 'node:test';
import assert from 'node:assert/strict';
import { ordersRoute, validOrderStoragePath } from './order-route.js';
import { publishOrderCatalogs } from './order-files.js';
import { selectOrders, orderNumber } from '../public/ui/orders.js';
const orders = [
  {
    id: '1/101/A',
    companyCode: 1,
    number: 101,
    series: 'A',
    date: '2026-09-01',
    customer: 'Água Azul',
    seller: 'Tiago',
    total: 100,
    billed: 40,
    pending: 60,
    items: []
  },
  {
    id: '5/101/A',
    companyCode: 5,
    number: 101,
    series: 'A',
    date: '2026-09-02',
    customer: 'Braskem',
    seller: 'Tiago',
    total: 80,
    billed: 80,
    pending: 0,
    items: []
  }
];
test('order catalogs contain orders only and skip unchanged uploads', async () => {
  const state = {},
    uploads = [];
  const upload = async (path, content, type) =>
    uploads.push({ path, orders: JSON.parse(content), type });
  const report = {
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    orders: orders.map((o) => ({ ...o, attachments: ['omit'], attachmentRecords: ['omit'] }))
  };
  await publishOrderCatalogs([report], state, upload);
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].type, 'application/json');
  assert.equal(report.orderCatalog.count, 2);
  assert.ok(!report.orders);
  assert.ok(validOrderStoragePath(report.orderCatalog.path));
  assert.ok(uploads[0].orders.every((o) => !('attachments' in o) && !('attachmentRecords' in o)));
  report.orders = orders;
  await publishOrderCatalogs([report], state, upload);
  assert.equal(uploads.length, 1);
  report.orders = [{ ...orders[0], billed: 100, pending: 0 }, orders[1]];
  await publishOrderCatalogs([report], state, upload);
  assert.equal(uploads.length, 2);
});
test('order route requires authorization and the exact reviewed period', async () => {
  const base = {
    url: new URL('https://crm/api/commercial/orders?inicio=2026-09-01&fim=2026-09-30'),
    user: { role: 'admin' },
    reports: {
      sep: {
        startDate: '2026-09-01',
        endDate: '2026-09-30',
        checkedAt: '2026-10-01T12:00:00Z',
        orderCatalog: { path: 'orders/catalog/2026-09/' + 'a'.repeat(24) + '.json' }
      }
    },
    download: async () => new Response(JSON.stringify(orders))
  };
  assert.equal((await ordersRoute({ ...base, user: { role: 'fiscal' } })).status, 403);
  assert.equal((await ordersRoute({ ...base, user: null })).status, 403);
  assert.equal(
    (await ordersRoute({ ...base, url: new URL('https://crm?inicio=2026-09-15&fim=2026-09-30') }))
      .status,
    409
  );
  const result = await ordersRoute(base);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.orders, orders);
  assert.equal(result.body.checkedAt, base.reports.sep.checkedAt);
  assert.equal(
    (await ordersRoute({ ...base, url: new URL('https://crm?inicio=2026-09-30&fim=2026-09-01') }))
      .status,
    400
  );
});
test('order storage cannot access attachments or arbitrary paths', () => {
  for (const path of [
    'orders/1/101/A/1-abc.pdf',
    '../secrets.json',
    'orders/catalog/2026-09/../../secret.json',
    'orders/catalog/2026-09/' + 'a'.repeat(24) + '.json?x=1'
  ])
    assert.equal(validOrderStoragePath(path), false);
});
test('order filters preserve identity, partial billing and accent-free search', () => {
  assert.equal(orderNumber(orders[0]), '01.0000101-A');
  assert.equal(selectOrders(orders, { company: '1' }).length, 1);
  assert.equal(selectOrders(orders, { company: '3' })[0].companyCode, 5);
  assert.equal(selectOrders(orders, { status: 'pendente' }).length, 1);
  assert.equal(selectOrders(orders, { status: 'faturado' }).length, 2);
  assert.equal(selectOrders(orders, { query: 'agua' })[0].id, '1/101/A');
  assert.equal(selectOrders(orders, { query: '01.0000101-A' }).length, 1);
});

test('order PDF download is limited to an order from the reviewed catalog', async () => {
  const path = 'orders/catalog/2026-09/' + 'a'.repeat(24) + '.json';
  const base = {
    user: { role: 'admin' },
    reports: {
      sep: {
        startDate: '2026-09-01',
        endDate: '2026-09-30',
        checkedAt: '2026-10-01T12:00:00Z',
        orderCatalog: { path }
      }
    },
    download: async () => new Response(JSON.stringify(orders))
  };
  const result = await ordersRoute({
    ...base,
    url: new URL('https://crm?inicio=2026-09-01&fim=2026-09-30&pedido=1%2F101%2FA')
  });
  assert.equal(result.status, 200);
  assert.equal(result.headers['Content-Type'], 'application/pdf');
  assert.equal(result.content.subarray(0, 5).toString(), '%PDF-');
  assert.match(result.headers['Content-Disposition'], /pedido-1-101-A.pdf/);
  assert.equal(result.headers['Cache-Control'], 'private, no-store');
  const missing = await ordersRoute({
    ...base,
    url: new URL('https://crm?inicio=2026-09-01&fim=2026-09-30&pedido=6%2F101%2FA')
  });
  assert.equal(missing.status, 404);
  assert.ok(!missing.content);
});

test('both Vercel project roots route order requests to the authenticated API', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const path of ['../vercel.json', '../frontend-vercel/vercel.json']) {
    const config = JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
    assert.equal(
      config.rewrites.find((r) => r.source === '/api/commercial/orders')?.destination,
      '/api/executive?crmRoute=orders'
    );
  }
});
