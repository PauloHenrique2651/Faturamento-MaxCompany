import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bridgeAuthorized, bridgeRouteAllowed, proxyServerRead } from './api-bridge.js';

test('API dedicada nega chave ausente, errada e configuração fraca', () => {
  const key = 'a'.repeat(64);
  assert.equal(bridgeAuthorized({ headers: {} }, key), false);
  assert.equal(bridgeAuthorized({ headers: { 'x-crm-api-key': 'b'.repeat(64) } }, key), false);
  assert.equal(bridgeAuthorized({ headers: { 'x-crm-api-key': key } }, key), true);
  assert.equal(bridgeAuthorized({ headers: { 'x-crm-api-key': 'short' } }, 'short'), false);
});
test('API dedicada permite só consultas e não expõe login, usuários ou arquivos locais', () => {
  assert.equal(bridgeRouteAllowed('GET', '/api/commercial/finance'), true);
  assert.equal(bridgeRouteAllowed('POST', '/api/commercial/finance'), false);
  for (const path of ['/api/users', '/api/auth/login', '/.env', '/api/../data/api/config.json'])
    assert.equal(bridgeRouteAllowed('GET', path), false);
});
test('ponte fica desligada sem configuração e rejeita HTTP ou credenciais na URL', async () => {
  assert.equal(await proxyServerRead({ method: 'GET' }, {}, '/api/health', '', {}), false);
  for (const url of ['http://example.com', 'https://user:password@example.com'])
    await assert.rejects(
      proxyServerRead({ method: 'GET' }, {}, '/api/health', '', {
        CRM_SERVER_API_URL: url,
        CRM_SERVER_API_KEY: 'a'.repeat(64)
      }),
      /HTTPS/
    );
});

test('ponte encaminha somente a chave do backend, sem cookies, e mantém a resposta privada', async () => {
  const originalFetch = globalThis.fetch;
  const headers = {};
  const res = { setHeader: (k, v) => (headers[k] = v), end: (body) => (res.body = body) };
  globalThis.fetch = async (url, options) => {
    assert.equal(url.href, 'https://api.example.com/api/commercial/finance?inicio=2026-10-02');
    assert.equal(options.headers.Cookie, undefined);
    assert.equal(options.headers['x-crm-api-key'], 'a'.repeat(64));
    assert.equal(options.redirect, 'error');
    return new Response('{"wallet":{}}', {
      status: 200,
      headers: { 'content-type': 'application/json', 'set-cookie': 'secret=never-forward' }
    });
  };
  try {
    assert.equal(
      await proxyServerRead(
        { method: 'GET', headers: { cookie: 'crm_session=private' } },
        res,
        '/api/commercial/finance',
        '?inicio=2026-10-02&crmRoute=finance',
        { CRM_SERVER_API_URL: 'https://api.example.com', CRM_SERVER_API_KEY: 'a'.repeat(64) }
      ),
      true
    );
    assert.equal(headers['Cache-Control'], 'private, no-store');
    assert.equal(headers['set-cookie'], undefined);
    assert.equal(res.statusCode, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
