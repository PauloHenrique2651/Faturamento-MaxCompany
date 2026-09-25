import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const companies = [
  [1, 'MaxPlast'],
  [2, 'MaxSafety'],
  [3, 'MaxSupply'],
  [4, 'MaxSupply · Filial ES']
];
const taxNames = ['icms', 'ipi', 'pis', 'cofins', 'issqn', 'fcp', 'difal'];
const secure = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);

function env(name) {
  return String(process.env[name] || '').trim();
}

function json(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  Object.entries(headers).forEach(([key, value]) => res.setHeader(key, value));
  res.end(JSON.stringify(body));
}

function cookie(res, value) {
  res.setHeader('Set-Cookie', value);
}

async function supabase(path, options = {}) {
  const base = env('SUPABASE_URL').replace(/\/$/, '');
  const key = env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SECRET_KEY');
  if (!base || !key) throw new Error('Supabase não configurado na Vercel.');
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { message: text.slice(0, 300) };
  }
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${body?.message || 'falha'}`);
  return body;
}

async function downloadStorageObject(path) {
  const base = env('SUPABASE_URL').replace(/\/$/, '');
  const key = env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SECRET_KEY');
  if (!base || !key) throw new Error('Supabase não configurado na Vercel.');
  return fetch(`${base}/storage/v1/object/fiscal-documents/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }
  });
}

function requestBody(req) {
  return new Promise((resolve, reject) => {
    let value = '';
    req.on('data', (chunk) => {
      value += chunk;
      if (value.length > 100_000) reject(new Error('Corpo da requisição excedeu o limite.'));
    });
    req.on('end', () => {
      try {
        resolve(value ? JSON.parse(value) : {});
      } catch {
        reject(new Error('JSON inválido.'));
      }
    });
    req.on('error', reject);
  });
}

const normalize = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('pt-BR');

function sessionSecret() {
  const secret = env('CRM_SESSION_SECRET');
  if (!secret) throw new Error('CRM_SESSION_SECRET não configurado na Vercel.');
  return secret;
}

function publicUser(user) {
  return { id: user.id, name: user.name, role: user.role };
}

async function makeSession(user) {
  const payload = Buffer.from(
    JSON.stringify({ id: user.id, version: user.version, exp: Date.now() + 7 * 86400000 })
  ).toString('base64url');
  const signature = createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

async function currentUser(req) {
  const token = /(?:^|;\s*)crm_session=([^;]+)/.exec(req.headers.cookie || '')?.[1];
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = createHmac('sha256', sessionSecret()).update(payload).digest();
  const received = Buffer.from(signature, 'base64url');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!data || data.exp <= Date.now()) return null;
  const users = await supabase(
    `/rest/v1/crm_users?id=eq.${encodeURIComponent(data.id)}&version=eq.${data.version}&disabled=eq.false&select=id,name,role,version`
  );
  return users?.[0] ? publicUser(users[0]) : null;
}

function dateParams(url) {
  const now = new Date();
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
  const first = url.searchParams.get('inicio') || `${today.slice(0, 8)}01`;
  const inicio = /^\d{4}-\d{2}-\d{2}$/.test(first) ? first : `${today.slice(0, 8)}01`;
  const fim = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('fim') || '')
    ? url.searchParams.get('fim')
    : today;
  return { inicio, fim };
}

function amount(row) {
  const value = Number(row.value ?? row.amount ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function documentFromCloud(row) {
  const source =
    row.source_payload && typeof row.source_payload === 'object' ? row.source_payload : {};
  return {
    ...source,
    key: row.access_key,
    company: source.company || companies.find(([id]) => id === row.company_id)?.[1],
    date: row.issued_on,
    number: source.number || row.document_number,
    series: source.series || row.series,
    value: money(row.amount),
    customer:
      source.customer ||
      (row.direction === 'outgoing'
        ? { id: row.counterparty_id, name: row.counterparty_name }
        : undefined),
    supplier:
      source.supplier ||
      (row.direction === 'incoming'
        ? { id: row.counterparty_id, name: row.counterparty_name }
        : undefined),
    seller: source.seller || row.seller || null,
    operation: source.operation || row.operation_name || null,
    purpose: source.purpose || row.purpose || null,
    fiscalOperation: source.fiscalOperation || row.fiscal_operation || null,
    itemsDetail: source.itemsDetail || row.items || [],
    taxes: source.taxes || row.taxes || {},
    freight: source.freight || row.freight || { value: 0 },
    referencedKeys: source.referencedKeys || row.referenced_keys || [],
    full: Boolean(row.is_full_xml),
    canceled: Boolean(row.is_canceled),
    simpleIcmsCredit: Number(source.simpleIcmsCredit || 0)
  };
}

async function cloudDocuments(direction, url) {
  const { inicio, fim } = dateParams(url);
  const filters = [
    `direction=eq.${direction}`,
    `issued_on=gte.${inicio}`,
    `issued_on=lte.${fim}`,
    'is_authorized=eq.true',
    'is_canceled=eq.false'
  ];
  const company = Number(url.searchParams.get('empresa'));
  if ([1, 2, 3, 4].includes(company)) filters.push(`company_id=eq.${company}`);
  const rows = await supabase(
    `/rest/v1/fiscal_documents?select=*&${filters.join('&')}&order=issued_on.desc&limit=10000`
  );
  return { rows: rows.map(documentFromCloud), inicio, fim };
}

function baseSummary(rows, inicio, fim, direction) {
  const daily = new Map();
  const companiesMap = new Map();
  const parties = new Map();
  const sellers = new Map();
  const operations = new Map();
  const taxes = Object.fromEntries(taxNames.map((name) => [name, 0]));
  let total = 0;
  let items = 0;
  let freight = 0;
  let credit = 0;
  const documents = rows.filter((row) => !row.canceled);
  for (const row of documents) {
    const value = amount(row);
    total += value;
    const day = daily.get(row.date) || { date: row.date, count: 0, value: 0 };
    day.count++;
    day.value += value;
    daily.set(row.date, day);
    const company = companiesMap.get(row.company) || { name: row.company, count: 0, value: 0 };
    company.count++;
    company.value += value;
    companiesMap.set(row.company, company);
    const party = direction === 'outgoing' ? row.customer : row.supplier;
    if (party) {
      const id = party.id || party.name;
      const item = parties.get(id) || { id, name: party.name, count: 0, value: 0 };
      item.count++;
      item.value += value;
      parties.set(id, item);
    }
    if (direction === 'outgoing' && row.seller) {
      const item = sellers.get(row.seller) || {
        id: row.seller,
        name: row.seller,
        count: 0,
        value: 0
      };
      item.count++;
      item.value += value;
      sellers.set(row.seller, item);
    }
    const type = row.fiscalOperation?.type || 'other';
    const op = operations.get(type) || { type, count: 0, value: 0 };
    op.count++;
    op.value += value;
    operations.set(type, op);
    items += Number(row.items || row.itemsDetail?.length || 0);
    freight += Number(row.freight?.value || 0);
    credit += Number(row.simpleIcmsCredit || 0);
    for (const name of taxNames) taxes[name] += Number(row.taxes?.[name] || 0);
  }
  const series = [];
  for (
    let cursor = Date.parse(`${inicio}T12:00:00Z`);
    cursor <= Date.parse(`${fim}T12:00:00Z`);
    cursor += 86400000
  ) {
    const date = new Date(cursor).toISOString().slice(0, 10);
    const row = daily.get(date) || { date, count: 0, value: 0 };
    series.push({ ...row, value: money(row.value) });
  }
  const ranked = (map) =>
    [...map.values()]
      .map((row) => ({ ...row, value: money(row.value) }))
      .sort((a, b) => b.value - a.value);
  const result = {
    checkedAt: new Date().toISOString(),
    period: { inicio, fim },
    invoiceCount: documents.length,
    value: money(total),
    saleValue: money(operations.get('sale')?.value || 0),
    operations: [...operations.values()].map((row) => ({ ...row, value: money(row.value) })),
    canceledCount: rows.length - documents.length,
    itemCount: items,
    freightValue: money(freight),
    simpleIcmsCredit: money(credit),
    taxes: Object.fromEntries(Object.entries(taxes).map(([key, value]) => [key, money(value)])),
    daily: series,
    companies: ranked(companiesMap),
    documents: documents.map((row) => ({ ...row, value: money(row.value) })),
    filesInspected: rows.length,
    sourcesAvailable: 1,
    sourcesTotal: 1
  };
  if (direction === 'outgoing') {
    result.customers = ranked(parties);
    result.customerGroups = result.customers.map((row) => ({
      ...row,
      cnpjCount: 1,
      registrationCount: 1
    }));
    result.sellers = ranked(sellers);
    result.products = [];
    result.cfops = [];
    result.returns = {
      value: money(operations.get('return')?.value || 0),
      count: operations.get('return')?.count || 0,
      documents: documents.filter((row) => row.fiscalOperation?.type === 'return')
    };
  } else {
    result.suppliers = ranked(parties);
    result.returns = {
      value: money(operations.get('return')?.value || 0),
      count: operations.get('return')?.count || 0,
      documents: documents.filter((row) => row.fiscalOperation?.type === 'return')
    };
    result.fullXmlCount = documents.filter((row) => row.full).length;
    result.summaryOnlyCount = documents.filter((row) => !row.full).length;
    result.sync = [];
  }
  return result;
}

async function handle(req, res) {
  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  const path = url.pathname;
  if (path === '/api/auth/login' && req.method === 'POST') {
    const body = await requestBody(req);
    const users = await supabase(
      `/rest/v1/crm_users?name_normalized=eq.${encodeURIComponent(normalize(body.name))}&disabled=eq.false&select=*`
    );
    const user = users?.[0];
    const actual = await scrypt(String(body.password || ''), user?.salt || 'invalid', 64);
    const expected = user ? Buffer.from(user.hash, 'hex') : randomBytes(64);
    if (!user || expected.length !== actual.length || !timingSafeEqual(expected, actual))
      return json(res, 401, { error: 'Usuário ou senha incorretos.' });
    const token = await makeSession(user);
    cookie(
      res,
      `crm_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${7 * 86400}${secure ? '; Secure' : ''}`
    );
    return json(res, 200, publicUser(user));
  }
  if (path === '/api/auth/me' && req.method === 'GET')
    return json(res, 200, (await currentUser(req)) || { error: 'Não autenticado' });
  if (path === '/api/auth/logout' && req.method === 'POST') {
    cookie(res, 'crm_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    return json(res, 200, { ok: true });
  }
  const user = await currentUser(req);
  if (!user) return json(res, 401, { error: 'Sessão expirada. Entre novamente.' });
  if (path === '/api/falco/nfe' || path === '/api/executive') {
    const cloud = await cloudDocuments('outgoing', url);
    return json(res, 200, baseSummary(cloud.rows, cloud.inicio, cloud.fim, 'outgoing'));
  }
  if (path === '/api/falco/entradas') {
    const cloud = await cloudDocuments('incoming', url);
    return json(res, 200, baseSummary(cloud.rows, cloud.inicio, cloud.fim, 'incoming'));
  }
  if (path === '/api/falco/documento') {
    const type = url.searchParams.get('tipo') === 'entrada' ? 'incoming' : 'outgoing';
    const companyId = Number(url.searchParams.get('empresa'));
    const accessKey = String(url.searchParams.get('chave') || '');
    if (![1, 2, 3, 4].includes(companyId) || !/^\d{44}$/.test(accessKey))
      return json(res, 400, { error: 'Documento inválido.' });
    const rows = await supabase(
      `/rest/v1/fiscal_documents?direction=eq.${type}&company_id=eq.${companyId}&access_key=eq.${accessKey}&limit=1`
    );
    const row = rows?.[0];
    if (!row) return json(res, 404, { error: 'Documento não encontrado.' });
    const format = url.searchParams.get('formato');
    if (format === 'xml' || format === 'pdf' || format === 'danfe') {
      const extension = format === 'xml' ? 'xml' : 'pdf';
      const object = await downloadStorageObject(`${companyId}/${type}/${accessKey}.${extension}`);
      if (!object.ok)
        return json(res, 404, { error: `${extension.toUpperCase()} ainda não sincronizado.` });
      const content = Buffer.from(await object.arrayBuffer());
      res.statusCode = 200;
      res.setHeader(
        'Content-Type',
        extension === 'xml' ? 'application/xml; charset=utf-8' : 'application/pdf'
      );
      res.setHeader(
        'Content-Disposition',
        `${url.searchParams.get('baixar') === '1' ? 'attachment' : 'inline'}; filename="${accessKey}.${extension}"`
      );
      res.end(content);
      return;
    }
    const pdf = await downloadStorageObject(`${companyId}/${type}/${accessKey}.pdf`);
    return json(res, 200, { ...documentFromCloud(row), hasPdf: pdf.ok });
  }
  if (path === '/api/health') return json(res, 200, { ok: true, source: 'Supabase' });
  return json(res, 404, { error: 'Rota não encontrada.' });
}

export default async function handler(req, res) {
  try {
    await handle(req, res);
  } catch (error) {
    json(res, 500, { error: error.message || 'Erro interno da API.' });
  }
}
