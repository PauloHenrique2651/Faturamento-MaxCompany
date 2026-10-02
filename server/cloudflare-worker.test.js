import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloudflare/api-worker.js';
test('blocks missing keys, write methods and non-CRM routes', async () => {
  const env = {
    CRM_SERVER_API_KEY: 'x'.repeat(64),
    CRM_API: {
      fetch() {
        throw Error('origin must not be called');
      }
    }
  };
  assert.equal(
    (await worker.fetch(new Request('https://crm.workers.dev/api/health'), env)).status,
    401
  );
  for (const [path, method] of [
    ['/api/users', 'GET'],
    ['/api/health', 'POST']
  ])
    assert.equal(
      (
        await worker.fetch(
          new Request('https://crm.workers.dev' + path, {
            method,
            headers: { 'x-crm-api-key': env.CRM_SERVER_API_KEY }
          }),
          env
        )
      ).status,
      403
    );
});
test('forwards authorized reads only and never forwards cookies', async () => {
  const env = {
    CRM_SERVER_API_KEY: 'x'.repeat(64),
    CRM_API: {
      async fetch(url, options) {
        assert.equal(url.origin, 'http://127.0.0.1:3101');
        assert.equal(url.search, '?inicio=2026-01-01');
        assert.equal(options.headers.Cookie, undefined);
        assert.equal(options.redirect, 'manual');
        return new Response('{"ok":true}', {
          headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'ignored=1' }
        });
      }
    }
  };
  const res = await worker.fetch(
    new Request('https://crm.workers.dev/api/commercial/finance?inicio=2026-01-01', {
      headers: { 'x-crm-api-key': env.CRM_SERVER_API_KEY, Cookie: 'private=1' }
    }),
    env
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('set-cookie'), null);
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
});
