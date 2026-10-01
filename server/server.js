import { summarySynchronization } from '../public/lib/maserp-periods.js';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dashboardQuery, listQueries } from './queries.js';
import { runQuery, sql } from './db.js';
import { intelligence, parseFilters } from './intelligence.js';
import { readNfeSummary, readOutgoingDocument, searchOutgoingDocuments } from './nfe-files.js';
import {
  readIncomingSummary,
  readIncomingDocument,
  searchIncomingDocuments,
  readIncomingSyncStatus
} from './sefaz-files.js';
import { searchQuery } from './nfe-search.js';
import { renderDanfe } from './danfe.js';
import {
  readSupabaseSyncStatus,
  syncSupabaseFromFalco,
  readPublishedMaserpReports
} from './supabase-sync.js';
import { crmCloudRequest, crmOrderDownload } from './crm-store.js';
import { walletRoute } from './wallet-route.js';
import { payablesRoute } from './payables-route.js';
import { financeRoute } from './finance-route.js';
import { ordersRoute } from './order-route.js';
import { salesTargetsRoute } from './sales-targets.js';
import { sellerCommissionsRoute } from './seller-commissions.js';
import { equivalencesRoute } from './product-equivalences.js';
import { baseSummary } from '../frontend-vercel/api/[...path].js';
import { readMaserpInvoiceStates, readMaserpProductReferences } from './maserp-report.js';
import { applyInvoiceStates, applyProductReferences } from '../public/lib/erp-documents.js';
import { scopedDocuments } from '../frontend-vercel/lib/cloud-fiscal.js';
import {
  authenticate,
  createUser,
  deleteUser,
  listUsers,
  login,
  revokeSession,
  sessionCookie,
  updateUser
} from './auth.js';

const root = join(fileURLToPath(new URL('..', import.meta.url)), 'public');
const port = Number(process.env.PORT || 3100);
const host = process.env.HOST || '0.0.0.0';
const refreshSeconds = Math.max(10, Number(process.env.MASERP_REFRESH_SECONDS || 30));
const cache = new Map();

async function invoiceStates() {
  return cached('erp-invoice-states', () =>
    readMaserpInvoiceStates(
      '2020-01-01',
      new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
    )
  );
}

async function financializeSummary(summary, direction, params) {
  const products = await cached('erp-product-references', () =>
    readMaserpProductReferences(
      new Date(Date.now() - 396 * 86400000).toISOString().slice(0, 10),
      new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
    )
  );
  if (products.available) {
    summary.documents = applyProductReferences(
      summary.documents || [],
      products.items,
      direction,
      products.catalog
    );
    summary.canceledDocuments = applyProductReferences(
      summary.canceledDocuments || [],
      products.items,
      direction,
      products.catalog
    );
  }
  if (direction === 'outgoing') {
    const states = await invoiceStates();
    if (states.available) {
      summary.documents = applyInvoiceStates(summary.documents || [], states.documents);
      summary.canceledDocuments = applyInvoiceStates(
        summary.canceledDocuments || [],
        states.documents
      );
    }
  }
  const rows = scopedDocuments(
    [...(summary.documents || []), ...(summary.canceledDocuments || [])],
    params
  );
  const calculated = baseSummary(
    rows,
    summary.period.inicio,
    summary.period.fim,
    direction,
    summary.scope || {}
  );
  return {
    ...summary,
    ...calculated,
    source: summary.source || 'Falco',
    synchronization: summarySynchronization(
      await cached('published-reports', readPublishedMaserpReports),
      summary.period
    ),
    sourcesAvailable: summary.sourcesAvailable,
    sourcesTotal: summary.sourcesTotal,
    sync: summary.sync,
    documentCoverage: summary.documentCoverage
  };
}

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8'
};

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': mime['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function safeNumber(value, min, max, fallback) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

async function cached(key, loader) {
  const found = cache.get(key);
  if (found && Date.now() - found.at < refreshSeconds * 1000)
    return { ...found.value, cache: true };
  const value = await loader();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 80) cache.delete(cache.keys().next().value);
  return { ...value, cache: false };
}

async function api(req, res, url, user) {
  if (url.pathname === '/api/commercial/finance') {
    if (req.method !== 'GET') return json(res, 405, { error: 'Somente consulta.' });
    const result = await financeRoute({
      user,
      metadata: await readPublishedMaserpReports(),
      download: crmOrderDownload
    });
    return json(res, result.status, result.body);
  }
  if (url.pathname === '/api/commercial/payables') {
    if (req.method !== 'GET') return json(res, 405, { error: 'Somente consulta.' });
    const result = await payablesRoute({
      user,
      metadata: (await readPublishedMaserpReports()).payables,
      download: crmOrderDownload
    });
    return json(res, result.status, result.body);
  }
  if (url.pathname === '/api/commercial/wallet') {
    if (req.method !== 'GET') return json(res, 405, { error: 'Somente consulta.' });
    const result = await walletRoute({
      user,
      metadata: (await readPublishedMaserpReports()).wallet,
      download: crmOrderDownload
    });
    return json(res, result.status, result.body);
  }
  if (url.pathname === '/api/commercial/orders') {
    const result = await ordersRoute({
      url,
      user,
      reports: (await readPublishedMaserpReports()).maserpReports,
      download: crmOrderDownload
    });
    if (result.content) {
      res.statusCode = result.status;
      Object.entries(result.headers).forEach(([name, value]) => res.setHeader(name, value));
      res.end(result.content);
      return;
    }
    return json(res, result.status, result.body);
  }
  if (url.pathname === '/api/falco/busca') {
    const query = searchQuery(url.searchParams.get('q'));
    const offset = Math.floor(safeNumber(url.searchParams.get('offset'), 0, 100000, 0));
    const limit = Math.floor(safeNumber(url.searchParams.get('limit'), 1, 100, 40));
    if (
      query.raw.length > 100 ||
      (query.raw && !query.number && !query.key && query.raw.length < 3)
    )
      return json(res, 400, { error: 'Digite ao menos 3 letras ou um número de nota.' });
    if (!query.raw) return json(res, 200, { query: '', total: 0, items: [], sources: [] });
    const results = await Promise.allSettled([
      searchOutgoingDocuments(query),
      searchIncomingDocuments(query)
    ]);
    const sources = results.flatMap((result, index) =>
      result.status === 'fulfilled' ? [index === 0 ? 'saida' : 'entrada'] : []
    );
    if (!sources.length) throw new Error('Fontes de NF-e indisponíveis');
    const rows = results
      .filter((result) => result.status === 'fulfilled')
      .flatMap((result) => result.value)
      .sort((a, b) => b.date.localeCompare(a.date) || b.key.localeCompare(a.key));
    return json(res, 200, {
      query: query.raw,
      total: rows.length,
      offset,
      limit,
      items: rows.slice(offset, offset + limit),
      sources,
      checkedAt: new Date().toISOString()
    });
  }
  if (url.pathname === '/api/falco/documento') {
    const tipo = url.searchParams.get('tipo');
    const empresa = Number(url.searchParams.get('empresa'));
    const chave = url.searchParams.get('chave') || '';
    const formato = url.searchParams.get('formato') || 'json';
    if (
      !['saida', 'entrada'].includes(tipo) ||
      ![1, 2, 3, 4].includes(empresa) ||
      !/^\d{44}$/.test(chave) ||
      !['json', 'xml', 'pdf', 'danfe'].includes(formato)
    )
      return json(res, 400, { error: 'Documento inválido' });
    const document =
      tipo === 'saida'
        ? await readOutgoingDocument(empresa, chave)
        : await readIncomingDocument(empresa, chave);
    if (
      !document ||
      (formato === 'pdf' && !document.pdfPath) ||
      (formato === 'danfe' && !document.xml)
    )
      return json(res, 404, { error: 'Documento não encontrado' });
    if (formato === 'json' && tipo === 'saida' && document) {
      const states = await invoiceStates();
      if (states.available)
        document.row = applyInvoiceStates(
          [{ ...document.row, companyId: empresa, key: chave }],
          states.documents
        )[0];
    }
    if (formato === 'json')
      return json(res, 200, {
        ...document.row,
        company: ['MaxPlast', 'MaxSafety', 'MaxSupply', 'MaxSupply · Filial ES'][empresa - 1],
        hasXml: true,
        hasPdf: Boolean(document.pdfPath),
        hasDanfe: Boolean(document.pdfPath || document.xml),
        xmlStatus: 'AVAILABLE',
        danfeStatus: document.pdfPath || document.xml ? 'AVAILABLE' : 'MISSING',
        syncStatus: 'LOCAL',
        documentStatus: document.row.canceled ? 'CANCELED' : 'AUTHORIZED',
        full: tipo === 'saida' || document.row.full
      });
    if (formato === 'danfe') {
      const body = renderDanfe(document.xml);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `${url.searchParams.get('baixar') === '1' ? 'attachment' : 'inline'}; filename="${chave}.html"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      });
      return res.end(body);
    }
    const body =
      formato === 'xml' ? Buffer.from(document.xml, 'utf8') : await readFile(document.pdfPath);
    const extension = formato === 'xml' ? 'xml' : 'pdf';
    res.writeHead(200, {
      'Content-Type': formato === 'xml' ? 'application/xml; charset=utf-8' : 'application/pdf',
      'Content-Disposition': `${url.searchParams.get('baixar') === '1' ? 'attachment' : 'inline'}; filename="${chave}.${extension}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    return res.end(body);
  }
  if (url.pathname === '/api/falco/nfe') {
    let filters;
    try {
      filters = parseFilters(url.searchParams);
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
    if (filters.empresa !== null && ![1, 2, 3, 4].includes(filters.empresa))
      return json(res, 400, { error: 'Empresa inválida' });
    const scope = {
      customerGroupId: url.searchParams.get('grupoClienteNfe') || null,
      customerId: url.searchParams.get('clienteNfe') || null,
      sellerName: url.searchParams.get('vendedorNfe') || null,
      productCode: url.searchParams.get('produtoNfe') || null
    };
    if (Object.values(scope).some((value) => value && (value.length > 100 || /[<>]/.test(value))))
      return json(res, 400, { error: 'Filtro inválido' });
    const summary = await financializeSummary(
      await readNfeSummary(filters.inicio, filters.fim, filters.empresa),
      'outgoing',
      url.searchParams
    );
    if (user.role === 'fiscal') {
      const {
        checkedAt,
        period,
        scope: filtersScope,
        invoiceCount,
        value,
        canceledCount,
        canceledValue,
        canceledSaleValue,
        canceledDocuments,
        itemCount,
        taxes,
        simpleIcmsCredit,
        simpleIcmsCreditDocumentCount,
        taxRegimes,
        documents,
        filesInspected,
        sourcesAvailable,
        sourcesTotal
      } = summary;
      return json(res, 200, {
        checkedAt,
        period,
        scope: filtersScope,
        invoiceCount,
        value,
        canceledCount,
        canceledValue,
        canceledSaleValue,
        canceledDocuments,
        itemCount,
        taxes,
        simpleIcmsCredit,
        simpleIcmsCreditDocumentCount,
        taxRegimes,
        documents,
        filesInspected,
        sourcesAvailable,
        sourcesTotal
      });
    }
    return json(res, 200, summary);
  }
  if (url.pathname === '/api/falco/entradas') {
    let filters;
    try {
      filters = parseFilters(url.searchParams);
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
    if (filters.empresa !== null && ![1, 2, 3, 4].includes(filters.empresa))
      return json(res, 400, { error: 'Empresa inválida' });
    const summary = await financializeSummary(
      await readIncomingSummary(filters.inicio, filters.fim, filters.empresa),
      'incoming',
      url.searchParams
    );
    if (user.role === 'fiscal') {
      const {
        checkedAt,
        period,
        invoiceCount,
        value,
        purchaseCount,
        purchaseValue,
        canceledCount,
        canceledValue,
        canceledPurchaseValue,
        canceledDocuments,
        fullXmlCount,
        summaryOnlyCount,
        taxes,
        documents,
        sourcesAvailable,
        sourcesTotal,
        sync
      } = summary;
      return json(res, 200, {
        checkedAt,
        period,
        invoiceCount,
        value,
        purchaseCount,
        purchaseValue,
        canceledCount,
        canceledValue,
        canceledPurchaseValue,
        canceledDocuments,
        fullXmlCount,
        summaryOnlyCount,
        taxes,
        documents,
        sourcesAvailable,
        sourcesTotal,
        sync
      });
    }
    return json(res, 200, summary);
  }
  if (url.pathname === '/api/executive') {
    try {
      parseFilters(url.searchParams);
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
    return json(res, 200, await intelligence(url.searchParams));
  }
  if (url.pathname === '/api/health') {
    try {
      const { inicio, fim } = parseFilters(new URLSearchParams());
      const summary = await readNfeSummary(inicio, fim);
      const ok = summary.sourcesAvailable === summary.sourcesTotal;
      return json(res, ok ? 200 : 503, {
        ok,
        crm: 'online',
        outgoing: {
          sourcesAvailable: summary.sourcesAvailable,
          sourcesTotal: summary.sourcesTotal,
          checkedAt: summary.checkedAt
        },
        incoming: await readIncomingSyncStatus(),
        sefazWorkerRunning: sefazSyncRunning,
        supabase: readSupabaseSyncStatus(),
        sql: process.env.MASERP_SQL_SERVER ? 'configured_not_checked' : 'not_configured'
      });
    } catch (error) {
      return json(res, 503, { ok: false, error: 'Pastas de NF-e indisponíveis' });
    }
  }

  if (url.pathname === '/api/dashboard') {
    const dias = safeNumber(url.searchParams.get('dias'), 7, 365, 30);
    const payload = await cached(`dashboard:${dias}`, async () => {
      const sets = await runQuery(dashboardQuery, { dias: { type: sql.Int, value: dias } });
      return {
        atualizadoEm: new Date().toISOString(),
        periodoDias: dias,
        indicadores: sets[0][0],
        fluxo: sets[1],
        serie: sets[2],
        produtos: sets[3],
        atividades: sets[4]
      };
    });
    return json(res, 200, payload);
  }

  const match = url.pathname.match(/^\/api\/lista\/([a-z]+)$/);
  if (match && listQueries[match[1]]) {
    const tipo = match[1];
    const busca = String(url.searchParams.get('busca') || '')
      .trim()
      .slice(0, 80);
    const limite = safeNumber(url.searchParams.get('limite'), 10, 200, 50);
    let filters;
    try {
      filters = parseFilters(url.searchParams);
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
    const scope = {
      orcamentos: ['o.orc_datainclusao_DT', 'o.emp_empresa_IN'],
      pedidos: ['p.ped_datainclusao_DT', 'p.emp_empresa_IN'],
      compras: ['p.ped_datainclusao_DT', 'p.emp_empresa_IN'],
      faturamento: ['n.not_dataemissao_DT', 'n.emp_empresa_IN'],
      recebimento: ['n.not_dataentrada_DT', 'n.emp_empresa_IN'],
      receber: ['c.ctr_datavencimento_DT', 'c.ctr_empresa_IN'],
      pagar: ['c.par_datavencimento_DT', 'c.emp_empresa_IN'],
      expedicao: ['p.ped_datainclusao_DT', 'p.emp_empresa_IN'],
      contratos: ['c.con_datainclusao_DT', 'c.emp_empresa_IN']
    }[tipo];
    const query = scope
      ? listQueries[tipo].replace(
          'WHERE ',
          `WHERE ${scope[0]} >= @inicio AND ${scope[0]} < DATEADD(day,1,@fim) AND (@empresa IS NULL OR ${scope[1]}=@empresa) AND `
        )
      : listQueries[tipo];
    const key = `lista:${tipo}:${busca}:${limite}:${filters.inicio}:${filters.fim}:${filters.empresa}`;
    const payload = await cached(key, async () => {
      const sets = await runQuery(query, {
        inicio: { type: sql.Date, value: filters.inicio },
        fim: { type: sql.Date, value: filters.fim },
        empresa: { type: sql.Int, value: filters.empresa },
        busca: { type: sql.VarChar(80), value: busca },
        termo: { type: sql.VarChar(84), value: `%${busca}%` },
        limite: { type: sql.Int, value: limite }
      });
      return { atualizadoEm: new Date().toISOString(), tipo, registros: sets[0] };
    });
    return json(res, 200, payload);
  }

  return json(res, 404, { error: 'Rota não encontrada' });
}

async function staticFile(req, res, url) {
  let pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const requested = normalize(join(root, pathname));
  const relativePath = relative(root, requested);
  if (relativePath.startsWith('..') || isAbsolute(relativePath))
    return json(res, 403, { error: 'Acesso negado' });
  try {
    const info = await stat(requested);
    if (!info.isFile()) throw new Error('not-file');
    const body = await readFile(requested);
    res.writeHead(200, {
      'Content-Type': mime[extname(requested)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(body);
  } catch {
    const body = await readFile(join(root, 'index.html'));
    res.writeHead(200, { 'Content-Type': mime['.html'], 'Cache-Control': 'no-store' });
    res.end(body);
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  if (!['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'].includes(req.method))
    return json(res, 405, { error: 'Método inválido' });
  if (req.headers['sec-fetch-site'] === 'cross-site')
    return json(res, 403, { error: 'Acesso local obrigatório' });
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      if (!['GET', 'HEAD'].includes(req.method)) {
        if (!req.headers.origin || new URL(req.headers.origin).host !== req.headers.host)
          return json(res, 403, { error: 'Origem inválida' });
        if (req.headers['content-type'] !== 'application/json')
          return json(res, 415, { error: 'Envie JSON' });
      }
      let body = {};
      if (!['GET', 'HEAD'].includes(req.method)) {
        let input = '';
        for await (const chunk of req) {
          input += chunk;
          if (input.length > 8192) return json(res, 413, { error: 'Requisição muito grande' });
        }
        try {
          body = JSON.parse(input || '{}');
        } catch {
          return json(res, 400, { error: 'JSON inválido' });
        }
      }
      if (url.pathname === '/api/auth/login' && req.method === 'POST') {
        try {
          const session = await login(body.name, body.password);
          res.setHeader(
            'Set-Cookie',
            sessionCookie(session.token, session.maxAge, Boolean(req.socket.encrypted))
          );
          return json(res, 200, session.user);
        } catch (error) {
          return json(res, 401, { error: error.message });
        }
      }
      const user = await authenticate(req);
      if (!user) return json(res, 401, { error: 'Faça login para continuar' });
      if (url.pathname === '/api/auth/me' && req.method === 'GET') return json(res, 200, user);
      if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
        await revokeSession(req);
        res.setHeader('Set-Cookie', sessionCookie('', 0, Boolean(req.socket.encrypted)));
        return json(res, 200, { ok: true });
      }
      if (url.pathname === '/api/users' || url.pathname.startsWith('/api/users/')) {
        if (user.role !== 'admin') return json(res, 403, { error: 'Acesso restrito' });
        try {
          if (url.pathname === '/api/users' && req.method === 'GET')
            return json(res, 200, await listUsers());
          if (url.pathname === '/api/users' && req.method === 'POST')
            return json(res, 201, await createUser(body.name, body.password, body.role));
          const id = url.pathname.split('/')[3];
          if (id && req.method === 'PATCH') return json(res, 200, await updateUser(id, body));
          if (id && req.method === 'DELETE') {
            if (id === user.id)
              return json(res, 400, { error: 'Não é possível excluir sua própria conta.' });
            await deleteUser(id);
            return json(res, 200, { ok: true });
          }
        } catch (error) {
          return json(res, 400, { error: error.message });
        }
        return json(res, 405, { error: 'Método inválido' });
      }
      if (url.pathname === '/api/commercial/targets') {
        const result = await salesTargetsRoute({
          url,
          method: req.method,
          body,
          user,
          request: crmCloudRequest
        });
        return json(res, result.status, result.body);
      }
      if (url.pathname === '/api/commercial/commissions') {
        const result = await sellerCommissionsRoute({
          url,
          method: req.method,
          body,
          user,
          request: crmCloudRequest
        });
        return json(res, result.status, result.body);
      }
      if (url.pathname === '/api/commercial/equivalences') {
        const result = await equivalencesRoute({
          url,
          method: req.method,
          body,
          user,
          request: crmCloudRequest
        });
        return json(res, result.status, result.body);
      }
      if (
        user.role === 'fiscal' &&
        ![
          '/api/falco/nfe',
          '/api/falco/entradas',
          '/api/falco/documento',
          '/api/falco/busca'
        ].includes(url.pathname)
      )
        return json(res, 403, { error: 'Acesso restrito ao fiscal' });
      if (!['GET', 'HEAD'].includes(req.method))
        return json(res, 405, { error: 'Somente consulta' });
      return await api(req, res, url, user);
    }
    if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'Método inválido' });
    return await staticFile(req, res, url);
  } catch (error) {
    console.error('Falha de consulta:', error.code || error.name);
    return json(res, 500, {
      error: 'Não foi possível concluir a consulta. Verifique a integração local com o ERP Falco.'
    });
  }
});

server.listen(port, host, () =>
  console.log(
    `CRM ERP Falco disponível em http://localhost:${port} e na rede em http://${host}:${port}`
  )
);

let sefazSyncRunning = false;
function syncSefaz() {
  if (sefazSyncRunning) return;
  sefazSyncRunning = true;
  const script = join(fileURLToPath(new URL('..', import.meta.url)), 'scripts', 'sync-sefaz.ps1');
  const powershell =
    process.platform === 'win32'
      ? join(
          process.env.SystemRoot || 'C:\\Windows',
          'System32',
          'WindowsPowerShell',
          'v1.0',
          'powershell.exe'
        )
      : 'pwsh';
  const child = spawn(powershell, ['-NoProfile', '-File', script, '-MaxBatches', '100'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    windowsHide: true,
    stdio: 'ignore'
  });
  child.on('error', (error) => {
    sefazSyncRunning = false;
    console.error('Falha ao iniciar sincronização SEFAZ:', error.code || error.name);
  });
  child.on('exit', () => {
    sefazSyncRunning = false;
  });
}
const configuredSefazCheckSeconds = Number(process.env.SEFAZ_CHECK_SECONDS || 60);
const sefazCheckSeconds = Number.isFinite(configuredSefazCheckSeconds)
  ? Math.max(60, configuredSefazCheckSeconds)
  : 60;

function syncSupabase() {
  syncSupabaseFromFalco().catch((error) =>
    console.error('Falha na sincronização Supabase:', error.message || error.name)
  );
}
const configuredSupabaseSyncSeconds = Number(process.env.SUPABASE_SYNC_SECONDS || 60);
const supabaseSyncSeconds = Number.isFinite(configuredSupabaseSyncSeconds)
  ? Math.max(60, configuredSupabaseSyncSeconds)
  : 60;
// O coletor autônomo do servidor é o publicador padrão. Abrir uma instância
// local para desenvolvimento não pode sobrescrever o retrato da produção.
if (process.env.CRM_BACKGROUND_SYNC === 'true') {
  syncSefaz();
  setInterval(syncSefaz, sefazCheckSeconds * 1000);
  syncSupabase();
  setInterval(syncSupabase, supabaseSyncSeconds * 1000);
}
