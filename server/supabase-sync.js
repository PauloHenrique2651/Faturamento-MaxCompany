import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderDanfe } from './danfe.js';
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
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SECRET_KEY ||
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
  const timeoutMs = Math.max(
    5_000,
    Math.min(60_000, Number(process.env.SUPABASE_REQUEST_TIMEOUT_MS || 20_000))
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${url}${path}`, {
      method,
      signal: controller.signal,
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
  } catch (error) {
    if (error.name === 'AbortError')
      throw new Error(`Supabase excedeu ${Math.round(timeoutMs / 1000)} segundos.`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
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

export function changedDocuments(rows, previous = {}) {
  const fingerprints = { ...previous };
  const changed = rows.filter((row) => {
    const { synced_at, source_updated_at, ...stable } = row;
    const key = `${row.company_id}/${row.direction}/${row.access_key}`;
    const digest = createHash('sha256').update(JSON.stringify(stable)).digest('hex');
    const changed = fingerprints[key] !== digest;
    fingerprints[key] = digest;
    return changed;
  });
  return { changed, fingerprints };
}

export function mergeArtifactQueue(outgoing, incoming, state) {
  const queue = new Map(
    (state.artifactQueue || []).map((row) => [artifactPaths(row, row.direction).id, row])
  );
  for (const [direction, rows] of [
    ['outgoing', outgoing],
    ['incoming', incoming]
  ]) {
    for (const row of rows) {
      if (!eligibleArtifact(row, direction)) continue;
      const id = artifactPaths(row, direction).id;
      if (!state.completedDocuments?.[id])
        queue.set(id, { company: row.company, key: row.key, full: row.full, direction });
    }
  }
  return [...queue.values()].filter(
    (row) => !state.completedDocuments?.[artifactPaths(row, row.direction).id]
  );
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
      Prefer: 'resolution=ignore-duplicates,return=minimal'
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

export function artifactPaths(row, direction) {
  const companyId = companies.get(row.company);
  if (!companyId || !/^\d{44}$/.test(String(row.key || '')))
    throw new Error('Documento fiscal sem empresa ou chave válida.');
  const base = `${companyId}/${direction}/${row.key}`;
  return { id: base, xml: `${base}.xml`, pdf: `${base}.pdf`, danfe: `${base}.html` };
}

function eligibleArtifact(row, direction) {
  return direction === 'outgoing' || Boolean(row.full);
}

function retryReady(state, id, now) {
  const retryAt = Date.parse(state.artifactFailures?.[id]?.nextRetryAt || '');
  return !Number.isFinite(retryAt) || retryAt <= now;
}

export function selectArtifactBatch(outgoing, incoming, state, limit, now = Date.now()) {
  const queues = [
    outgoing.filter(
      (row) =>
        eligibleArtifact(row, 'outgoing') &&
        !state.completedDocuments?.[artifactPaths(row, 'outgoing').id] &&
        retryReady(state, artifactPaths(row, 'outgoing').id, now)
    ),
    incoming.filter(
      (row) =>
        eligibleArtifact(row, 'incoming') &&
        !state.completedDocuments?.[artifactPaths(row, 'incoming').id] &&
        retryReady(state, artifactPaths(row, 'incoming').id, now)
    )
  ];
  const selected = [];
  for (let index = 0; selected.length < limit && queues.some((queue) => queue.length); index++) {
    const directionIndex = index % queues.length;
    const row = queues[directionIndex].shift();
    if (row) selected.push({ row, direction: directionIndex ? 'incoming' : 'outgoing' });
  }
  return selected;
}

async function patchDocument(row, direction, values) {
  const companyId = companies.get(row.company);
  const filters = new URLSearchParams({
    company_id: `eq.${companyId}`,
    direction: `eq.${direction}`,
    access_key: `eq.${row.key}`
  });
  await request(`/rest/v1/fiscal_documents?${filters}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(values)
  });
}

async function patchArtifactStatus(row, direction, values) {
  try {
    await patchDocument(row, direction, values);
  } catch (error) {
    // Compatibilidade temporária enquanto a migration aditiva ainda não foi aplicada.
    if (!/column|schema cache|PGRST204/i.test(String(error.message))) throw error;
    const legacy = Object.fromEntries(
      Object.entries(values).filter(([key]) =>
        ['xml_storage_path', 'pdf_storage_path'].includes(key)
      )
    );
    if (Object.keys(legacy).length) await patchDocument(row, direction, legacy);
  }
}

function recordFailure(state, id, error) {
  state.artifactFailures ||= {};
  const previous = state.artifactFailures[id] || { attempts: 0 };
  const attempts = previous.attempts + 1;
  const minutes = Math.min(360, 2 ** Math.min(attempts, 8));
  state.artifactFailures[id] = {
    attempts,
    error: String(error.message || error).slice(0, 240),
    failedAt: new Date().toISOString(),
    nextRetryAt: new Date(Date.now() + minutes * 60_000).toISOString()
  };
}

async function uploadDocumentArtifacts(row, direction, state) {
  const companyId = companies.get(row.company);
  const paths = artifactPaths(row, direction);
  const document =
    direction === 'outgoing'
      ? await readOutgoingDocument(companyId, row.key)
      : await readIncomingDocument(companyId, row.key);
  if (!document?.xml || (direction === 'incoming' && !document.row?.full))
    throw new Error('XML completo autorizado não localizado na origem.');
  const uploadedAt = new Date().toISOString();
  const uploadOnce = async (path, content, type) => {
    if (!state.uploadedArtifacts?.[path]) {
      try {
        await uploadObject(path, content, type);
      } catch (error) {
        if (!String(error.message).includes('409')) throw error;
      }
      state.uploadedArtifacts ||= {};
      state.uploadedArtifacts[path] = uploadedAt;
    }
  };
  await uploadOnce(paths.xml, Buffer.from(document.xml, 'utf8'), 'application/xml');
  let pdfPath = null;
  let danfePath = null;
  if (document.pdfPath) {
    await uploadOnce(paths.pdf, await readFile(document.pdfPath), 'application/pdf');
    pdfPath = paths.pdf;
  } else {
    await uploadOnce(paths.danfe, Buffer.from(renderDanfe(document.xml), 'utf8'), 'text/html');
    danfePath = paths.danfe;
  }
  await patchArtifactStatus(row, direction, {
    xml_storage_path: paths.xml,
    pdf_storage_path: pdfPath,
    danfe_storage_path: danfePath,
    xml_status: 'AVAILABLE',
    danfe_status: 'AVAILABLE',
    sync_status: 'SYNCED',
    sync_attempts: (state.artifactFailures?.[paths.id]?.attempts || 0) + 1,
    last_sync_error: null,
    last_sync_at: uploadedAt
  });
  state.completedDocuments ||= {};
  state.completedDocuments[paths.id] = uploadedAt;
  if (state.artifactFailures) delete state.artifactFailures[paths.id];
  return { uploaded: 1, generatedDanfe: Number(Boolean(danfePath)), paths };
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
    const fullScan =
      !state.metadataInitialized ||
      !state.lastFullScanAt ||
      Date.now() - Date.parse(state.lastFullScanAt) > 6 * 3600_000;
    const start =
      state.lastSuccessAt && !fullScan
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
    const changes = changedDocuments(
      [...outgoingRows, ...incomingRows],
      state.documentFingerprints
    );
    await upsertDocuments(changes.changed);
    state.documentFingerprints = changes.fingerprints;
    state.artifactQueue = mergeArtifactQueue(outgoing.documents, incoming.documents, state);
    state.metadataInitialized = true;
    if (fullScan) state.lastFullScanAt = new Date().toISOString();
    await saveState(state);
    for (const [direction, summary] of [
      ['outgoing', outgoing],
      ['incoming', incoming]
    ]) {
      for (const [companyName, companyId] of companies) {
        const keys = [
          ...new Set(
            (summary.canceledDocuments || [])
              .filter((row) => row.company === companyName)
              .map((row) => row.key)
          )
        ];
        for (let index = 0; index < keys.length; index += 100) {
          const filters = new URLSearchParams({
            company_id: `eq.${companyId}`,
            direction: `eq.${direction}`,
            access_key: `in.(${keys.slice(index, index + 100).join(',')})`
          });
          await request(`/rest/v1/fiscal_documents?${filters}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
            body: JSON.stringify({ is_canceled: true, synced_at: new Date().toISOString() })
          });
        }
      }
    }
    let artifactCount = 0;
    let artifactAttempts = 0;
    let artifactErrors = 0;
    let generatedDanfeCount = 0;
    if (settings.artifacts) {
      const batch = selectArtifactBatch(
        state.artifactQueue.filter((row) => row.direction === 'outgoing'),
        state.artifactQueue.filter((row) => row.direction === 'incoming'),
        state,
        settings.artifactBatchSize
      );
      const pending = [...batch];
      const artifactDeadline = Date.now() + 15000;
      await Promise.all(
        Array.from({ length: Math.min(4, batch.length) }, async () => {
          while (pending.length && Date.now() < artifactDeadline) {
            const { row, direction } = pending.shift();
            artifactAttempts++;
            const paths = artifactPaths(row, direction);
            try {
              const result = await uploadDocumentArtifacts(row, direction, state);
              artifactCount += result.uploaded;
              generatedDanfeCount += result.generatedDanfe;
            } catch (error) {
              artifactErrors++;
              recordFailure(state, paths.id, error);
              try {
                await patchArtifactStatus(row, direction, {
                  sync_status: 'ERROR',
                  sync_attempts: state.artifactFailures[paths.id].attempts,
                  last_sync_error: state.artifactFailures[paths.id].error,
                  last_sync_at: new Date().toISOString()
                });
              } catch {
                // A falha do registro não interrompe o restante do backfill.
              }
            }
          }
        })
      );
      state.artifactQueue = mergeArtifactQueue([], [], state);
      state.artifactBackfillComplete = state.artifactQueue.length === 0;
    }
    state.lastSuccessAt = new Date().toISOString();
    state.uploadedArtifacts = Object.fromEntries(
      Object.entries(state.uploadedArtifacts || {}).slice(-100000)
    );
    state.completedDocuments = Object.fromEntries(
      Object.entries(state.completedDocuments || {}).slice(-50000)
    );
    await saveState(state);
    const details = {
      start,
      end,
      userCount,
      outgoingSources: `${outgoing.sourcesAvailable}/${outgoing.sourcesTotal}`,
      incomingSources: `${incoming.sourcesAvailable}/${incoming.sourcesTotal}`,
      sefaz,
      artifactAttempts,
      artifactErrors,
      generatedDanfeCount,
      metadataChanged: changes.changed.length,
      pendingArtifacts: state.artifactQueue.length,
      artifactBackfillComplete: Boolean(state.artifactBackfillComplete),
      pendingArtifactFailures: Object.keys(state.artifactFailures || {}).length
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
      metadataChanged: changes.changed.length,
      pendingArtifacts: state.artifactQueue.length,
      incomingCount: incomingRows.length,
      artifactCount,
      artifactAttempts,
      artifactErrors,
      artifactBackfillComplete: Boolean(state.artifactBackfillComplete)
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
