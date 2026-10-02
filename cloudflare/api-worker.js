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

export default {
  async fetch(request, env) {
    const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
    const secret = env.CRM_SERVER_API_KEY || '';
    const key = request.headers.get('x-crm-api-key') || '';
    let difference = key.length ^ secret.length;
    for (let i = 0; i < secret.length; i++)
      difference |= secret.charCodeAt(i) ^ (key.charCodeAt(i) || 0);
    if (secret.length < 43 || difference)
      return new Response('Unauthorized', { status: 401, headers });
    const url = new URL(request.url);
    if (!['GET', 'HEAD'].includes(request.method) || !routes.has(url.pathname)) {
      return new Response('Forbidden', { status: 403, headers });
    }
    try {
      const target = new URL(url.pathname + url.search, 'http://127.0.0.1:3101');
      const upstream = await env.CRM_API.fetch(target, {
        method: request.method,
        headers: {
          'x-crm-api-key': secret,
          Accept: request.headers.get('Accept') || 'application/json'
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(25000)
      });
      if (upstream.status >= 300 && upstream.status < 400)
        return new Response('Unexpected redirect', { status: 502, headers });
      const outgoing = new Headers(headers);
      for (const name of ['Content-Type', 'Content-Disposition', 'Content-Security-Policy']) {
        if (upstream.headers.has(name)) outgoing.set(name, upstream.headers.get(name));
      }
      outgoing.set('X-CRM-Source', 'server-24x7');
      return new Response(upstream.body, { status: upstream.status, headers: outgoing });
    } catch {
      return new Response('Server API unavailable', { status: 502, headers });
    }
  }
};
