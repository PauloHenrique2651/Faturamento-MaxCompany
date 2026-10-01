import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const localConfig = join(
  fileURLToPath(new URL('..', import.meta.url)),
  'data',
  'supabase',
  'config.json'
);

export async function crmCloudRequest(path, options = {}) {
  let saved = {};
  try {
    saved = JSON.parse(await readFile(process.env.SUPABASE_CONFIG_PATH || localConfig, 'utf8'));
  } catch {
    // Variáveis do processo podem fornecer a configuração.
  }
  const base = String(process.env.SUPABASE_URL || saved.url || '')
    .replace(/\/rest\/v1\/?$/, '')
    .replace(/\/$/, '');
  const secret =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || saved.secretKey;
  if (!base || !secret) throw new Error('Banco próprio do CRM não configurado.');
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      apikey: secret,
      Authorization: `Bearer ${secret}`,
      ...(options.headers || {})
    }
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Banco do CRM: HTTP ${response.status}.`);
  return body ? JSON.parse(body) : null;
}

export async function crmOrderDownload(path) {
  const { validOrderStoragePath } = await import('./order-route.js');
  const { validWalletStoragePath } = await import('./wallet-route.js');
  const { validPayablesStoragePath } = await import('./payables-route.js');
  if (
    !validOrderStoragePath(path) &&
    !validWalletStoragePath(path) &&
    !validPayablesStoragePath(path)
  )
    throw new Error('Catálogo de pedidos inválido.');
  const saved = JSON.parse(await readFile(process.env.SUPABASE_CONFIG_PATH || localConfig, 'utf8'));
  const base = (process.env.SUPABASE_URL || saved.url).replace(/\/$/, '');
  const secret =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || saved.secretKey;
  return fetch(`${base}/storage/v1/object/fiscal-documents/${path}`, {
    headers: { apikey: secret, Authorization: `Bearer ${secret}` }
  });
}
