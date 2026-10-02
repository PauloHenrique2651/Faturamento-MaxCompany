import test from 'node:test';
import assert from 'node:assert/strict';
import { publishCurrentOverview, compactSyncDetails } from './sync-publication.js';
test('uma publicação atual substitui o retrato sem multiplicar relatórios no histórico', async () => {
  const calls = [],
    state = {},
    request = async (path, options) => {
      calls.push({ path, ...options, values: JSON.parse(options.body) });
      return [{ id: 900 }];
    };
  const details = {
    start: '2025-01-01',
    end: '2026-10-02',
    wallet: { available: true, path: 'wallet/catalog/a.json', checkedAt: '2026-10-02T10:00:00Z' },
    payables: { available: true },
    maserpReports: { year: { checkedAt: '2026-10-02T10:00:00Z', value: 100 } },
    metadataChanged: 1
  };
  await publishCurrentOverview(details, state, request, '2026-10-02T10:00:00Z');
  assert.equal(state.currentOverviewId, 900);
  assert.equal(calls[0].method, 'POST');
  details.wallet.checkedAt = '2026-10-02T10:00:30Z';
  details.maserpReports.year.checkedAt = details.wallet.checkedAt;
  await publishCurrentOverview(details, state, request, details.wallet.checkedAt);
  assert.equal(calls[1].path, '/rest/v1/crm_sync_runs?id=eq.900');
  assert.equal(calls[1].method, 'PATCH');
  assert.equal(calls[1].values.details, undefined);
  details.maserpReports.year.value = 120;
  await publishCurrentOverview(details, state, request, '2026-10-02T10:01:00Z');
  assert.equal(calls[2].values.details.maserpReports.year.value, 120);
  const small = compactSyncDetails(details);
  assert.equal(small.maserpReports, undefined);
  assert.equal(small.metadataChanged, 1);
  assert.equal(small.walletAvailable, true);
  assert.ok(JSON.stringify(small).length < 500);
});
test('falha de publicação não confirma dados novos nem perde o retrato anterior', async () => {
  const state = { currentOverviewId: 900, currentOverviewHash: 'old' };
  await assert.rejects(
    publishCurrentOverview({ maserpSales: { value: 120 } }, state, async () => {
      throw new Error('temporário');
    }),
    /temporário/
  );
  assert.equal(state.currentOverviewHash, 'old');
});
