import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import handler from '../api/falco/documento.js';

test('rotas autenticadas entregam detalhe e XML, paginam notas e restringem o perfil fiscal', async () => {
  const originalFetch = globalThis.fetch;
  const previous = { ...process.env };
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-server-key';
  process.env.CRM_SESSION_SECRET = 'test-only-session-secret';
  const user = { id: 'a'.repeat(24), name: 'Teste', role: 'admin', version: 1 };
  const payload = Buffer.from(
    JSON.stringify({ id: user.id, version: 1, exp: Date.now() + 60000 })
  ).toString('base64url');
  const token =
    payload +
    '.' +
    createHmac('sha256', process.env.CRM_SESSION_SECRET).update(payload).digest('base64url');
  const key = '3'.repeat(44);
  const raw = {
    company_id: 1,
    direction: 'outgoing',
    access_key: key,
    amount: 100,
    issued_on: '2026-09-25',
    is_full_xml: true,
    is_authorized: true,
    items: [{ code: 'A1', name: 'Produto', cfop: '5102', value: 100 }],
    purpose: '1'
  };
  let listPages = 0;
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.pathname.startsWith('/storage/'))
      return new Response('<nfeProc/>', { status: url.pathname.endsWith('.xml') ? 200 : 404 });
    if (url.pathname.endsWith('/crm_users')) return Response.json([user]);
    if (url.pathname.endsWith('/crm_sync_runs'))
      return Response.json([
        { status: 'success', finished_at: new Date().toISOString(), details: {} }
      ]);
    if (url.searchParams.has('access_key')) return Response.json([raw]);
    if (url.searchParams.has('offset')) {
      listPages++;
      return Response.json(
        Number(url.searchParams.get('offset')) === 0
          ? Array.from({ length: 500 }, (_, index) => ({
              ...raw,
              access_key: String(index).padStart(44, '0')
            }))
          : [raw]
      );
    }
    throw new Error('Chamada inesperada no teste');
  };
  const request = async (url, authenticated = true) => {
    const req = Readable.from([]);
    Object.assign(req, {
      url,
      method: 'GET',
      headers: { host: 'localhost', cookie: authenticated ? 'crm_session=' + token : '' }
    });
    const result = { headers: {} };
    const res = {
      statusCode: 0,
      setHeader(name, value) {
        result.headers[name] = value;
      },
      end(body) {
        result.status = this.statusCode;
        result.body = body;
      }
    };
    await handler(req, res);
    return result;
  };
  try {
    const path = '/api/falco/documento?tipo=saida&empresa=1&chave=' + key;
    assert.equal((await request(path, false)).status, 401);
    const detail = await request(path);
    assert.equal(detail.status, 200);
    assert.equal(JSON.parse(detail.body).items[0].code, 'A1');
    assert.equal(JSON.parse(detail.body).hasXml, true);
    assert.equal(JSON.parse(detail.body).hasPdf, false);
    const xml = await request(path + '&formato=xml');
    assert.equal(xml.status, 200);
    assert.match(xml.headers['Content-Type'], /application\/xml/);
    const invoices = await request('/api/falco/nfe?inicio=2026-09-01&fim=2026-09-25');
    assert.equal(invoices.status, 200);
    assert.equal(JSON.parse(invoices.body).invoiceCount, 501);
    assert.equal(listPages, 2);
    user.role = 'fiscal';
    assert.equal((await request('/api/users')).status, 403);
    assert.equal((await request('/api/executive')).status, 403);
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CRM_SESSION_SECRET']) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});
