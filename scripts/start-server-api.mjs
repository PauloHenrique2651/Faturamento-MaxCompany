import { readFile } from 'node:fs/promises';
const config = JSON.parse(
  await readFile(new URL('../data/api/config.json', import.meta.url), 'utf8')
);
if (typeof config.key !== 'string' || config.key.length < 43)
  throw new Error('Chave da API ausente ou inválida.');
process.env.CRM_API_BRIDGE = 'true';
process.env.CRM_SERVER_API_KEY = config.key;
process.env.CRM_BACKGROUND_SYNC = 'false';
process.env.HOST = '127.0.0.1';
process.env.PORT = '3101';
await import('../server/server.js');
