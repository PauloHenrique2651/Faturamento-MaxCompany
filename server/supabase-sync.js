import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readNfeSummary, readOutgoingDocument } from './nfe-files.js';
import {
  readIncomingDocument,
  readIncomingSummary,
  readIncomingSyncStatus
} from './sefaz-files.js';

const root = join(fileURLToPath(new URL('..', import.meta.url)), 'data', 'supabase');
const statePath = join(root, 'sync-state.json');
const usersPath = join(root, '..', 'auth', 'users.json');
const companies = new Map([
  ['MaxPlast', 1],
  ['MaxSafety', 2],
  ['MaxSupply', 3],
  ['MaxSupply · Filial ES', 4]
]);
let running = false;
let lastResult = { configured: false, running: false, lastSuccessAt: null, lastError: null };

function config() {
  const configPath = process.env.SUPABASE_CONFIG_PATH || join(root, 'config.json');
  let local = {};
  try {
    if (existsSync(configPath)) local = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    // A integração pode continuar configurada exclusivamente por variáveis do sistema.
  }
  const url = String(process.env.SUPABASE_URL || local.url || '')
    .replace(/\/rest\/v1\/?$/, '')
    .replace(/\/$/, '');
  const secret = String(
    process.env.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      local.secretKey ||
      ''
  );
  return {
    url,
    secret,
    startDate: process.env.SUPABASE_SYNC_START_DATE || local.startDate || '2020-01-01',
    lookbackDays: Math.max(
      1,
      Number(process.env.SUPABASE_SYNC_LOOKBACK_DAYS || local.lookbackDays || 14)
    ),
    artifacts: process.env.SUPABASE_SYNC_ARTIFACTS !== 'false' && local.artifacts !== false,
    artifactBatchSize: Math.max(
      1,
      Number(process.env.SUPABASE_SYNC_ARTIFACT_BATCH_SIZE || local.artifactBatchSize || 100)
    )
  };
}

function todayInBrazil() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
      .formatToParts(new Date())
      .map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function shiftDays(date, amount) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

async function readState() {
  try {
    return JSON.parse(await readFile(statePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { uploadedArtifacts: {} };
    throw error;
  }
}

async function saveState(state) {
  await mkdir(dirname(statePath), { recursive: true });
  const temporary = `${statePath}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(state, null, 2));
  await rename(temporary, statePath);
}

async function request(path, { method = 'GET', body, headers = {} } = {}) {
  const { url, secret } = config();
  const response = await fetch(`${url}${path}`, {
    method,
    headers: {
      apikey: secret,
      Authorization: `Bearer ${secret}`,
      ...headers
    },
    body
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Supabase ${response.status}: ${detail.slice(0, 300)}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export function normalizeCloudDocument(row, direction) {
  const companyId = companies.get(row.company);
  if (!companyId) throw new Error(`Empresa não reconhecida: ${row.company}`);
  const party = direction === 'outgoing' ? row.customer : row.supplier;
  return {
    company_id: companyId,
    direction,
    access_key: row.key,
    issued_on: row.date,
    document_number: row.number,
    series: row.series,
    amount: row.value,
    counterparty_id: party?.id || null,
    counterparty_name: party?.name || 'Não identificado',
    seller: row.seller || null,
    operation_name: row.operation || null,
    purpose: row.purpose || null,
    fiscal_operation: row.fiscalOperation || null,
    referenced_keys: row.referencedKeys || [],
    items: Array.isArray(row.itemsDetail) ? row.itemsDetail : null,
    taxes: row.taxes || null,
    freight: row.freight || null,
    is_full_xml: direction === 'outgoing' || Boolean(row.full),
    is_authorized: true,
    is_canceled: false,
    source_payload: row,
    source_updated_at: new Date().toISOString(),
    synced_at: new Date().toISOString()
  };
}

async function upsertDocuments(rows) {
  const chunkSize = 250;
  for (let index = 0; index < rows.length; index += chunkSize) {
    await request('/rest/v1/fiscal_documents?on_conflict=company_id,direction,access_key', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify(rows.slice(index, index + chunkSize))
    });
  }
}

async function syncUsers() {
  let users;
  try {
    users = JSON.parse(await readFile(usersPath, 'utf8'));
  } catch {
    return 0;
  }
  const rows = users.map((user) => ({
    id: user.id,
    name: user.name,
    name_normalized: String(user.name || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLocaleLowerCase('pt-BR'),
    role: user.role,
    salt: user.salt,
    hash: user.hash,
    version: user.version || 1,
    disabled: false
  }));
  if (!rows.length) return 0;
  await request('/rest/v1/crm_users?on_conflict=id', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify(rows)
  });
  return rows.length;
}

async function uploadObject(path, content, contentType) {
  await request(`/storage/v1/object/fiscal-documents/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType, 'x-upsert': 'false' },
    body: content
  });
}

async function uploadDocumentArtifacts(row, direction, state) {
  const companyId = companies.get(row.company);
  const artifactId = `${companyId}/${direction}/${row.key}`;
  if (state.uploadedArtifacts?.[artifactId]) return 0;
  const document =
    direction === 'outgoing'
      ? await readOutgoingDocument(companyId, row.key)
      : await readIncomingDocument(companyId, row.key);
  if (!document?.xml) return 0;
  try {
    await uploadObject(`${artifactId}.xml`, Buffer.from(document.xml, 'utf8'), 'application/xml');
  } catch (error) {
    if (!String(error.message).includes('409')) throw error;
  }
  if (direction === 'outgoing' && document.pdfPath) {
    try {
      await uploadObject(`${artifactId}.pdf`, await readFile(document.pdfPath), 'application/pdf');
    } catch (error) {
      if (!String(error.message).includes('409')) throw error;
    }
  }
  state.uploadedArtifacts ||= {};
  state.uploadedArtifacts[artifactId] = new Date().toISOString();
  return 1;
}

async function updateRun(id, values) {
  const fields = new URLSearchParams({ id: `eq.${id}` });
  await request(`/rest/v1/crm_sync_runs?${fields}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(values)
  });
}

export function readSupabaseSyncStatus() {
  return { ...lastResult, configured: Boolean(config().url && config().secret), running };
}

export async function syncSupabaseFromFalco() {
  const settings = config();
  if (!settings.url || !settings.secret) return readSupabaseSyncStatus();
  if (running) return readSupabaseSyncStatus();
  running = true;
  lastResult = { ...lastResult, configured: true, running: true, lastError: null };
  let runId = null;
  try {
    const state = await readState();
    const end = todayInBrazil();
    const start = state.lastSuccessAt
      ? [settings.startDate, shiftDays(end, -settings.lookbackDays)].sort().at(-1)
      : settings.startDate;
    await request('/rest/v1/crm_sync_runs?source=eq.falco-local&status=eq.running', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        status: 'error',
        finished_at: new Date().toISOString(),
        error_message: 'Execução local interrompida antes do término.'
      })
    });
    const created = await request('/rest/v1/crm_sync_runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ source: 'falco-local', status: 'running', details: { start, end } })
    });
    runId = created?.[0]?.id || null;
    const [outgoing, incoming, sefaz] = await Promise.all([
      readNfeSummary(start, end),
      readIncomingSummary(start, end),
      readIncomingSyncStatus()
    ]);
    const userCount = await syncUsers();
    const outgoingRows = outgoing.documents.map((row) => normalizeCloudDocument(row, 'outgoing'));
    const incomingRows = incoming.documents.map((row) => normalizeCloudDocument(row, 'incoming'));
    await upsertDocuments([...outgoingRows, ...incomingRows]);
    let artifactCount = 0;
    let artifactAttempts = 0;
    if (settings.artifacts) {
      for (const row of outgoing.documents) {
        if (artifactAttempts >= settings.artifactBatchSize) break;
        artifactAttempts++;
        artifactCount += await uploadDocumentArtifacts(row, 'outgoing', state);
      }
      for (const row of incoming.documents) {
        if (artifactAttempts >= settings.artifactBatchSize) break;
        artifactAttempts++;
        artifactCount += await uploadDocumentArtifacts(row, 'incoming', state);
      }
    }
    state.lastSuccessAt = new Date().toISOString();
    state.uploadedArtifacts = Object.fromEntries(
      Object.entries(state.uploadedArtifacts || {}).slice(-20000)
    );
    await saveState(state);
    const details = {
      start,
      end,
      userCount,
      outgoingSources: `${outgoing.sourcesAvailable}/${outgoing.sourcesTotal}`,
      incomingSources: `${incoming.sourcesAvailable}/${incoming.sourcesTotal}`,
      sefaz
    };
    if (runId)
      await updateRun(runId, {
        status: 'success',
        finished_at: new Date().toISOString(),
        outgoing_count: outgoingRows.length,
        incoming_count: incomingRows.length,
        artifact_count: artifactCount,
        details
      });
    lastResult = {
      configured: true,
      running: false,
      lastSuccessAt: state.lastSuccessAt,
      lastError: null,
      outgoingCount: outgoingRows.length,
      incomingCount: incomingRows.length,
      artifactCount
    };
    return readSupabaseSyncStatus();
  } catch (error) {
    const message = error.message || 'Falha desconhecida';
    if (runId) {
      try {
        await updateRun(runId, {
          status: 'error',
          finished_at: new Date().toISOString(),
          error_message: message
        });
      } catch {
        // A falha original é mais útil ao operador.
      }
    }
    lastResult = { ...lastResult, configured: true, running: false, lastError: message };
    throw error;
  } finally {
    running = false;
  }
}
