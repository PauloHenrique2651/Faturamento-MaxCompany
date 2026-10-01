import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { fiscalBreakdown, scopedDocuments, searchDocuments } from '../lib/cloud-fiscal.js';
import { classifyFiscalOperation } from '../lib/fiscal-operation.js';
import { registeredSalesReturns } from '../lib/erp-documents.js';
import {
  financialDocument,
  financialSaleValue,
  financialPurchaseValue,
  confirmedFinancialReturn
} from '../lib/financial-cfops.js';
import { salesTargetsRoute } from '../../server/sales-targets.js';
import { sellerCommissionsRoute } from '../../server/seller-commissions.js';
import { equivalencesRoute } from '../../server/product-equivalences.js';

const scrypt = promisify(scryptCallback);
const companies = [
  [1, 'MaxPlast'],
  [2, 'MaxSafety'],
  [3, 'MaxSupply'],
  [4, 'MaxSupply · Filial ES']
];
const taxNames = ['ICMS', 'ICMS-ST', 'FCP', 'FCP-ST', 'DIFAL', 'IPI', 'PIS', 'COFINS', 'ISS', 'II'];
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
  if (!/^\d+\/(?:outgoing|incoming)\/\d{44}\.(?:xml|pdf|html)$/.test(String(path || '')))
    throw new Error('Caminho de documento fiscal inválido.');
  const base = env('SUPABASE_URL').replace(/\/$/, '');
  const key = env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SECRET_KEY');
  if (!base || !key) throw new Error('Supabase não configurado na Vercel.');
  return fetch(`${base}/storage/v1/object/fiscal-documents/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }
  });
}

function defaultStoragePath(row, extension) {
  return `${row.company_id}/${row.direction}/${row.access_key}.${extension}`;
}

function storageCandidates(row, format) {
  const candidates =
    format === 'xml'
      ? [row.xml_storage_path, defaultStoragePath(row, 'xml')]
      : format === 'pdf'
        ? [row.pdf_storage_path, defaultStoragePath(row, 'pdf')]
        : [
            row.pdf_storage_path,
            row.danfe_storage_path,
            defaultStoragePath(row, 'pdf'),
            defaultStoragePath(row, 'html')
          ];
  const allowed = new Set(
    format === 'xml'
      ? [defaultStoragePath(row, 'xml')]
      : format === 'pdf'
        ? [defaultStoragePath(row, 'pdf')]
        : [defaultStoragePath(row, 'pdf'), defaultStoragePath(row, 'html')]
  );
  return [...new Set(candidates.filter((path) => allowed.has(path)))];
}

async function firstStoredObject(row, format) {
  const paths = [...new Set(storageCandidates(row, format).filter(Boolean))];
  for (const path of paths) {
    const response = await downloadStorageObject(path);
    if (response.ok) return { path, response };
    if (response.status !== 404 && response.status !== 400) return { path, response };
  }
  return null;
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
  const items = Array.isArray(source.itemsDetail)
    ? source.itemsDetail
    : Array.isArray(row.items)
      ? row.items
      : [];
  const document = {
    ...source,
    key: row.access_key,
    companyId: row.company_id,
    direction: row.direction,
    syncedAt: row.synced_at || null,
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
    erp: source.erp || null,
    operation: source.operation || row.operation_name || null,
    purpose: source.purpose || row.purpose || null,
    fiscalOperation: row.is_full_xml
      ? classifyFiscalOperation({
          purpose: source.purpose || row.purpose,
          operation: source.operation || row.operation_name,
          items
        })
      : source.fiscalOperation || row.fiscal_operation || null,
    itemsDetail: items,
    taxes: source.taxes || row.taxes || {},
    freight: source.freight || row.freight || { value: 0 },
    referencedKeys: source.referencedKeys || row.referenced_keys || [],
    full: Boolean(row.is_full_xml),
    canceled: Boolean(row.is_canceled),
    documentStatus:
      row.document_status ||
      (row.is_canceled ? 'CANCELED' : row.is_authorized ? 'AUTHORIZED' : 'UNKNOWN'),
    xmlStatus: row.xml_status || (row.xml_storage_path ? 'AVAILABLE' : 'PENDING'),
    danfeStatus:
      row.danfe_status ||
      (row.pdf_storage_path || row.danfe_storage_path ? 'AVAILABLE' : 'PENDING'),
    syncStatus: row.sync_status || (row.xml_storage_path ? 'SYNCED' : 'PENDING'),
    hasXml: row.xml_status === 'AVAILABLE' || Boolean(row.xml_storage_path),
    hasPdf: Boolean(row.pdf_storage_path),
    hasDanfe:
      row.danfe_status === 'AVAILABLE' || Boolean(row.pdf_storage_path || row.danfe_storage_path),
    simpleIcmsCredit: Number(source.simpleIcmsCredit || 0)
  };
  document.financial = financialDocument(document);
  return document;
}

async function linkFinancialReturns(rows) {
  const returns = rows.filter((row) => !row.canceled && row.fiscalOperation?.type === 'return');
  const keys = [...new Set(returns.flatMap((row) => row.referencedKeys || []))].filter((key) =>
    /^\d{44}$/.test(key)
  );
  if (!keys.length) return;
  const sales = new Map();
  for (let i = 0; i < keys.length; i += 50) {
    const batch = keys.slice(i, i + 50);
    const found = await allCloudRows(
      `/rest/v1/fiscal_documents?select=*&direction=eq.outgoing&is_authorized=eq.true&is_canceled=eq.false&access_key=in.(${batch.join(',')})`
    );
    for (const raw of found) {
      const sale = documentFromCloud(raw);
      if (sale.fiscalOperation?.type === 'sale') sales.set(`${sale.companyId}/${sale.key}`, sale);
    }
  }
  for (const row of returns) {
    const sale = (row.referencedKeys || [])
      .map((key) => sales.get(`${row.companyId}/${key}`))
      .find(
        (candidate) =>
          candidate && candidate.customer?.id && candidate.customer.id === row.supplier?.id
      );
    row.saleReference = sale
      ? {
          key: sale.key,
          number: sale.number,
          series: sale.series,
          customer: sale.customer,
          seller: sale.seller,
          financialStatus: sale.financial.status
        }
      : null;
  }
}

const cloudRowsCache = new Map();
const cloudRowsTtl = 10000;

async function allCloudRows(path) {
  const now = Date.now();
  const cached = cloudRowsCache.get(path);
  if (cached?.rows && now - cached.updatedAt < cloudRowsTtl) return cached.rows;
  if (cached?.pending) return cached.pending;
  const pending = (async () => {
    const rows = [];
    for (let offset = 0; ; offset += 500) {
      const page = await supabase(`${path}&limit=500&offset=${offset}`);
      rows.push(...page);
      if (page.length < 500) break;
    }
    cloudRowsCache.set(path, { rows, updatedAt: Date.now() });
    if (cloudRowsCache.size > 12) cloudRowsCache.delete(cloudRowsCache.keys().next().value);
    return rows;
  })().catch((error) => {
    cloudRowsCache.delete(path);
    throw error;
  });
  cloudRowsCache.set(path, { pending, updatedAt: now });
  return pending;
}

async function cloudDocuments(direction, url) {
  const { inicio, fim } = dateParams(url);
  const filters = [
    `direction=eq.${direction}`,
    `issued_on=gte.${inicio}`,
    `issued_on=lte.${fim}`,
    'is_authorized=eq.true'
  ];
  const company = Number(url.searchParams.get('empresa'));
  if ([1, 2, 3, 4].includes(company)) filters.push(`company_id=eq.${company}`);
  const rows = await allCloudRows(
    `/rest/v1/fiscal_documents?select=*&${filters.join('&')}&order=issued_on.desc,company_id,access_key`
  );
  const documents = rows.map(documentFromCloud);
  if (direction === 'incoming') await linkFinancialReturns(documents);
  return {
    rows: scopedDocuments(documents, url.searchParams),
    inicio,
    fim
  };
}

function baseSummary(rows, inicio, fim, direction, scope = {}) {
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
  let financialMovement = 0;
  let financialSales = 0;
  let financialPurchases = 0;
  let nonFinancial = 0;
  let pending = 0;
  const documents = rows.filter((row) => !row.canceled);
  const canceledDocuments = rows.filter((row) => row.canceled);
  for (const row of documents) {
    row.financial ||= financialDocument(row);
    const value = amount(row);
    total += value;
    financialMovement += row.financial.financialValue;
    nonFinancial += row.financial.nonFinancialValue;
    pending += row.financial.pendingValue;
    financialSales += direction === 'outgoing' ? financialSaleValue(row) : 0;
    financialPurchases += direction === 'incoming' ? financialPurchaseValue(row) : 0;
    const day = daily.get(row.date) || { date: row.date, count: 0, value: 0 };
    day.count++;
    day.value += value;
    day.financialValue = (day.financialValue || 0) + row.financial.financialValue;
    day.saleValue = (day.saleValue || 0) + (direction === 'outgoing' ? financialSaleValue(row) : 0);
    day.purchaseValue =
      (day.purchaseValue || 0) + (direction === 'incoming' ? financialPurchaseValue(row) : 0);
    daily.set(row.date, day);
    const company = companiesMap.get(row.company) || { name: row.company, count: 0, value: 0 };
    company.count++;
    company.value += value;
    company.financialValue = (company.financialValue || 0) + row.financial.financialValue;
    company.saleValue =
      (company.saleValue || 0) + (direction === 'outgoing' ? financialSaleValue(row) : 0);
    company.purchaseValue =
      (company.purchaseValue || 0) + (direction === 'incoming' ? financialPurchaseValue(row) : 0);
    companiesMap.set(row.company, company);
    const party = direction === 'outgoing' ? row.customer : row.supplier;
    if (party) {
      const id = party.id || party.name;
      const item = parties.get(id) || { id, name: party.name, count: 0, value: 0 };
      item.count++;
      item.value += value;
      parties.set(id, item);
    }
    if (direction === 'outgoing' && row.seller && financialSaleValue(row) > 0) {
      const item = sellers.get(row.seller) || {
        id: row.seller,
        name: row.seller,
        count: 0,
        value: 0
      };
      item.count++;
      item.value += financialSaleValue(row);
      sellers.set(row.seller, item);
    }
    const type = row.fiscalOperation?.type || 'other';
    const op = operations.get(type) || { type, count: 0, value: 0 };
    op.count++;
    op.value += value;
    operations.set(type, op);
    items += Array.isArray(row.items)
      ? row.items.length
      : Number(row.items || row.itemsDetail?.length || 0);
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
    series.push({
      ...row,
      value: money(row.value),
      financialValue: money(row.financialValue),
      saleValue: money(row.saleValue),
      purchaseValue: money(row.purchaseValue)
    });
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
    saleValue: money(financialSales),
    financialMovementValue: money(financialMovement),
    nonFinancialValue: money(nonFinancial),
    pendingClassificationValue: money(pending),
    operationalSaleValue: money(operations.get('sale')?.value || 0),
    operations: [...operations.values()].map((row) => ({ ...row, value: money(row.value) })),
    canceledCount: canceledDocuments.length,
    canceledValue: money(canceledDocuments.reduce((sum, row) => sum + amount(row), 0)),
    canceledSaleValue: money(
      canceledDocuments
        .filter((row) => row.fiscalOperation?.type === 'sale')
        .reduce((sum, row) => sum + amount(row), 0)
    ),
    canceledPurchaseValue: money(
      canceledDocuments
        .filter((row) => row.full && row.fiscalOperation?.type === 'sale')
        .reduce((sum, row) => sum + amount(row), 0)
    ),
    canceledDocuments,
    itemCount: items,
    freightValue: money(freight),
    simpleIcmsCredit: money(credit),
    taxes: Object.fromEntries(Object.entries(taxes).map(([key, value]) => [key, money(value)])),
    daily: series,
    companies: ranked(companiesMap).map((row) => ({
      ...row,
      financialValue: money(row.financialValue),
      saleValue: money(row.saleValue),
      purchaseValue: money(row.purchaseValue)
    })),
    documents: documents.map((row) => ({ ...row, value: money(row.value) })),
    filesInspected: rows.length,
    source: 'Supabase',
    lastSyncedAt:
      documents
        .map((row) => row.syncedAt)
        .filter(Boolean)
        .sort()
        .at(-1) || null,
    sourcesAvailable: new Set(documents.map((row) => row.company)).size,
    sourcesTotal: companies.length,
    documentCoverage: {
      xmlAvailable: documents.filter((row) => row.xmlStatus === 'AVAILABLE' || row.hasXml).length,
      xmlMissing: documents.filter((row) => row.xmlStatus !== 'AVAILABLE' && !row.hasXml).length,
      danfeAvailable: documents.filter((row) => row.danfeStatus === 'AVAILABLE' || row.hasDanfe)
        .length,
      danfeMissing: documents.filter((row) => row.danfeStatus !== 'AVAILABLE' && !row.hasDanfe)
        .length,
      syncErrors: documents.filter((row) => row.syncStatus === 'ERROR').length
    },
    reconciliation: [...operations.values()]
      .map((row) => ({ ...row, value: money(row.value) }))
      .sort((a, b) => b.value - a.value)
  };
  if (direction === 'outgoing') {
    Object.assign(result, fiscalBreakdown(documents, series, scope));
    result.salesReturns = registeredSalesReturns(documents);
  } else {
    result.suppliers = ranked(parties);
    const purchases = documents.filter((row) => financialPurchaseValue(row) > 0);
    result.purchaseCount = purchases.length;
    result.purchaseValue = money(financialPurchases);
    const returnDocuments = documents.filter((row) => row.fiscalOperation?.type === 'return');
    const linkedReturns = returnDocuments.filter((row) => row.saleReference);
    result.returns = {
      value: money(operations.get('return')?.value || 0),
      count: operations.get('return')?.count || 0,
      linkedToSaleCount: linkedReturns.length,
      financialLinkedCount: linkedReturns.filter((row) => confirmedFinancialReturn(row) > 0).length,
      linkedToSaleValue: money(
        linkedReturns.reduce((sum, row) => sum + confirmedFinancialReturn(row), 0)
      ),
      financialValue: money(
        linkedReturns.reduce((sum, row) => sum + confirmedFinancialReturn(row), 0)
      ),
      incompleteCount: returnDocuments.filter((row) => !row.full).length,
      documents: returnDocuments
    };
    result.fullXmlCount = documents.filter((row) => row.full).length;
    result.summaryOnlyCount = documents.filter((row) => !row.full).length;
    result.sync = [];
  }
  return result;
}

function documentDetailFromCloud(row) {
  const document = documentFromCloud(row);
  return {
    ...document,
    amount: document.value,
    items: Array.isArray(document.itemsDetail) ? document.itemsDetail : []
  };
}

let syncCache;
async function syncOverview() {
  if (syncCache && Date.now() - syncCache.at < 10000) return syncCache.value;
  let value;
  try {
    const runs = await supabase(
      '/rest/v1/crm_sync_runs?source=eq.falco-local&order=started_at.desc&limit=3&select=status,started_at,finished_at,details'
    );
    const successful = runs.find((row) => row.status === 'success');
    const updatedAt = successful?.finished_at || null;
    const ageSeconds = updatedAt
      ? Math.max(0, Math.floor((Date.now() - Date.parse(updatedAt)) / 1000))
      : null;
    value = {
      updatedAt,
      ageSeconds,
      fresh: ageSeconds !== null && ageSeconds <= 120 && runs[0]?.status !== 'error',
      collecting: runs[0]?.status === 'running',
      sefaz: successful?.details?.sefaz || [],
      maserpSales: successful?.details?.maserpSales || null,
      maserpReports: successful?.details?.maserpReports || {},
      pendingArtifacts: successful?.details?.pendingArtifacts ?? null
    };
  } catch {
    value = {
      updatedAt: null,
      ageSeconds: null,
      fresh: false,
      collecting: false,
      sefaz: [],
      pendingArtifacts: null
    };
  }
  syncCache = { at: Date.now(), value };
  return value;
}

async function handleUsers(req, res, user, path) {
  if (user.role !== 'admin') return json(res, 403, { error: 'Acesso restrito ao administrador.' });
  const id = path.split('/')[3];
  if (id && !/^[a-f0-9]{24}$/.test(id)) return json(res, 400, { error: 'Usuário inválido.' });
  if (!id && req.method === 'GET') {
    const users = await supabase(
      '/rest/v1/crm_users?disabled=eq.false&select=id,name,role&order=name'
    );
    return json(res, 200, users);
  }
  if (
    !['POST', 'PATCH', 'DELETE'].includes(req.method) ||
    (req.method === 'POST' ? Boolean(id) : !id)
  )
    return json(res, 405, { error: 'Método inválido.' });
  const body = req.method === 'DELETE' ? {} : await requestBody(req);
  if (body.role !== undefined && !['admin', 'fiscal'].includes(body.role))
    return json(res, 400, { error: 'Perfil inválido.' });
  if (
    (req.method === 'POST' || body.password !== undefined) &&
    (typeof body.password !== 'string' || body.password.length < 4 || body.password.length > 128)
  )
    return json(res, 400, { error: 'A senha deve ter de 4 a 128 caracteres.' });
  const headers = { 'Content-Type': 'application/json', Prefer: 'return=representation' };
  if (req.method === 'POST') {
    if (
      typeof body.name !== 'string' ||
      body.name.trim().length < 3 ||
      body.name.length > 100 ||
      !body.role
    )
      return json(res, 400, { error: 'Informe nome e perfil válidos.' });
    const duplicate = await supabase(
      '/rest/v1/crm_users?name_normalized=eq.' +
        encodeURIComponent(normalize(body.name)) +
        '&select=id'
    );
    if (duplicate.length) return json(res, 409, { error: 'Usuário já cadastrado.' });
    const salt = randomBytes(16).toString('hex');
    const hash = (await scrypt(body.password, salt, 64)).toString('hex');
    const created = await supabase('/rest/v1/crm_users', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        id: randomBytes(12).toString('hex'),
        name: body.name.trim(),
        name_normalized: normalize(body.name),
        role: body.role,
        salt,
        hash,
        version: 1,
        disabled: false
      })
    });
    return json(res, 201, publicUser(created[0]));
  }
  const found = await supabase(
    '/rest/v1/crm_users?id=eq.' + id + '&disabled=eq.false&select=id,name,role,version'
  );
  const target = found[0];
  if (!target) return json(res, 404, { error: 'Usuário não encontrado.' });
  if (user.id === id && (req.method === 'DELETE' || (body.role && body.role !== 'admin')))
    return json(res, 400, { error: 'Não é permitido remover seu próprio acesso administrativo.' });
  if (
    target.role === 'admin' &&
    (req.method === 'DELETE' || (body.role && body.role !== 'admin'))
  ) {
    const admins = await supabase('/rest/v1/crm_users?role=eq.admin&disabled=eq.false&select=id');
    if (admins.length <= 1)
      return json(res, 400, { error: 'É necessário manter ao menos um administrador.' });
  }
  const changes = { version: target.version + 1 };
  if (req.method === 'DELETE') changes.disabled = true;
  if (body.role) changes.role = body.role;
  if (body.password !== undefined) {
    changes.salt = randomBytes(16).toString('hex');
    changes.hash = (await scrypt(body.password, changes.salt, 64)).toString('hex');
  }
  const updated = await supabase(
    '/rest/v1/crm_users?id=eq.' + id + '&version=eq.' + target.version,
    { method: 'PATCH', headers, body: JSON.stringify(changes) }
  );
  if (!updated.length)
    return json(res, 409, { error: 'Usuário alterado em outra sessão. Atualize a página.' });
  return json(res, 200, req.method === 'DELETE' ? { ok: true } : publicUser(updated[0]));
}

export { baseSummary, documentFromCloud, documentDetailFromCloud, storageCandidates };

async function handle(req, res) {
  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  const crmRoute = url.searchParams.get('crmRoute');
  const path =
    url.pathname === '/api/executive' &&
    ['targets', 'equivalences', 'commissions'].includes(crmRoute)
      ? `/api/commercial/${crmRoute}`
      : url.pathname;
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
  if (path === '/api/health') {
    const sync = await syncOverview();
    return json(res, 200, {
      ok: true,
      source: 'Supabase',
      lastSyncAt: sync.updatedAt,
      syncFresh: sync.fresh
    });
  }
  const user = await currentUser(req);
  if (!user) return json(res, 401, { error: 'Sessão expirada. Entre novamente.' });
  if (path === '/api/users' || path.startsWith('/api/users/'))
    return handleUsers(req, res, user, path);
  if (path === '/api/commercial/targets') {
    const result = await salesTargetsRoute({
      url,
      method: req.method,
      body: req.method === 'POST' ? await requestBody(req) : {},
      user,
      request: supabase
    });
    return json(res, result.status, result.body);
  }
  if (path === '/api/commercial/commissions') {
    const result = await sellerCommissionsRoute({
      url,
      method: req.method,
      body: req.method === 'POST' ? await requestBody(req) : {},
      user,
      request: supabase
    });
    return json(res, result.status, result.body);
  }
  if (path === '/api/commercial/equivalences') {
    const result = await equivalencesRoute({
      url,
      method: req.method,
      body: req.method === 'POST' ? await requestBody(req) : {},
      user,
      request: supabase
    });
    return json(res, result.status, result.body);
  }
  if (
    user.role === 'fiscal' &&
    !['/api/falco/nfe', '/api/falco/entradas', '/api/falco/documento', '/api/falco/busca'].includes(
      path
    )
  )
    return json(res, 403, { error: 'Acesso restrito ao fiscal.' });
  if (path === '/api/falco/busca') {
    const query = String(url.searchParams.get('q') || '').trim();
    if (query.length > 120 || (query.length > 0 && query.length < 3 && !/^\d+$/.test(query)))
      return json(res, 400, { error: 'Digite ao menos 3 letras ou um número de nota.' });
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
    if (!query) return json(res, 200, searchDocuments([], query, offset));
    const rows = await allCloudRows(
      '/rest/v1/fiscal_documents?select=*&order=issued_on.desc,company_id,access_key'
    );
    return json(res, 200, searchDocuments(rows.map(documentFromCloud), query, offset));
  }
  if (path === '/api/falco/nfe' || path === '/api/executive') {
    const cloud = await cloudDocuments('outgoing', url);
    const scope = {
      customerId: url.searchParams.get('clienteNfe'),
      customerGroupId: url.searchParams.get('grupoClienteNfe'),
      sellerName: url.searchParams.get('vendedorNfe'),
      productCode: url.searchParams.get('produtoNfe')
    };
    return json(res, 200, {
      ...baseSummary(cloud.rows, cloud.inicio, cloud.fim, 'outgoing', scope),
      synchronization:
        user.role === 'fiscal'
          ? { ...(await syncOverview()), maserpSales: null, maserpReports: {} }
          : await syncOverview()
    });
  }
  if (path === '/api/falco/entradas') {
    const cloud = await cloudDocuments('incoming', url);
    const synchronization = await syncOverview();
    return json(res, 200, {
      ...baseSummary(cloud.rows, cloud.inicio, cloud.fim, 'incoming'),
      synchronization,
      sync: synchronization.sefaz
    });
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
      const stored = await firstStoredObject(row, format);
      if (!stored?.response.ok)
        return json(res, 404, {
          error: `${format === 'xml' ? 'XML' : 'DANFE'} ainda não sincronizado.`
        });
      const extension = stored.path.split('.').at(-1);
      const content = Buffer.from(await stored.response.arrayBuffer());
      res.statusCode = 200;
      res.setHeader(
        'Content-Type',
        extension === 'xml'
          ? 'application/xml; charset=utf-8'
          : extension === 'html'
            ? 'text/html; charset=utf-8'
            : 'application/pdf'
      );
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (extension === 'html')
        res.setHeader(
          'Content-Security-Policy',
          "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:"
        );
      res.setHeader(
        'Content-Disposition',
        `${url.searchParams.get('baixar') === '1' ? 'attachment' : 'inline'}; filename="${accessKey}.${extension}"`
      );
      res.end(content);
      return;
    }
    const document = documentDetailFromCloud(row);
    const [xml, pdf, danfe] = await Promise.all([
      firstStoredObject(row, 'xml'),
      firstStoredObject(row, 'pdf'),
      firstStoredObject(row, 'danfe')
    ]);
    return json(res, 200, {
      ...document,
      hasXml: Boolean(xml?.response.ok),
      hasPdf: Boolean(pdf?.response.ok),
      hasDanfe: Boolean(danfe?.response.ok),
      xmlStatus: xml?.response.ok ? 'AVAILABLE' : document.xmlStatus,
      danfeStatus: danfe?.response.ok ? 'AVAILABLE' : document.danfeStatus
    });
  }
  return json(res, 404, { error: 'Rota não encontrada.' });
}

export default async function handler(req, res) {
  try {
    await handle(req, res);
  } catch (error) {
    json(res, 500, { error: error.message || 'Erro interno da API.' });
  }
}
