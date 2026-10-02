import { timingSafeEqual } from 'node:crypto';

const routes = new Set([
  '/api/health',
  '/api/executive',
  '/api/dashboard',
  '/api/falco/nfe',
  '/api/falco/entradas',
  '/api/falco/documento',
  '/api/falco/busca',
  '/api/commercial/orders',
  '/api/commercial/wallet',
  '/api/commercial/payables',
  '/api/commercial/finance'
]);

export function bridgeRouteAllowed(method, pathname) {
  return ['GET', 'HEAD'].includes(method) && routes.has(pathname);
}

export function bridgeAuthorized(req, secret) {
  const supplied = req.headers['x-crm-api-key'];
  if (typeof supplied !== 'string' || typeof secret !== 'string' || secret.length < 43)
    return false;
  const actual = Buffer.from(supplied);
  const expected = Buffer.from(secret);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Chamado somente depois da autenticação e da autorização do usuário na Vercel.
export async function proxyServerRead(req, res, path, search, env = process.env) {
  if (!env.CRM_SERVER_API_URL || !bridgeRouteAllowed(req.method, path)) return false;
  const base = new URL(env.CRM_SERVER_API_URL);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash)
    throw new Error('A API do servidor exige uma URL HTTPS sem credenciais.');
  if (!env.CRM_SERVER_API_KEY || env.CRM_SERVER_API_KEY.length < 43)
    throw new Error('A autenticação da API do servidor não está configurada.');
  const url = new URL(path, base.origin);
  url.search = search;
  url.searchParams.delete('crmRoute');
  const response = await fetch(url, {
    method: req.method,
    redirect: 'error',
    signal: AbortSignal.timeout(25000),
    headers: { 'x-crm-api-key': env.CRM_SERVER_API_KEY, Accept: '*/*' }
  });
  res.statusCode = response.status;
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-CRM-Source', 'server-24x7');
  for (const name of ['content-type', 'content-disposition', 'content-security-policy']) {
    const value = response.headers.get(name);
    if (value) res.setHeader(name, value);
  }
  if (req.method === 'HEAD') res.end();
  else res.end(Buffer.from(await response.arrayBuffer()));
  return true;
}
