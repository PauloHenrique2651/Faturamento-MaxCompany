import { readSupabaseSyncStatus, syncSupabaseFromFalco } from '../server/supabase-sync.js';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

if (process.argv.includes('--full')) {
  const path = fileURLToPath(new URL('../data/supabase/sync-state.json', import.meta.url));
  const state = JSON.parse(await readFile(path, 'utf8'));
  state.lastFullScanAt = null;
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(state, null, 2));
  await rename(temporary, path);
}

await syncSupabaseFromFalco();
const status = readSupabaseSyncStatus();
console.log(JSON.stringify(status));
if (status.lastError) process.exitCode = 1;
