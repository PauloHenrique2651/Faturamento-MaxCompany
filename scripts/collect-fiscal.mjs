// Coletor independente: lê fontes locais e publica somente no Supabase.
// A consulta SEFAZ fica ativa por padrão e respeita os cursores e intervalos oficiais.
import { syncSupabaseFromFalco, readSupabaseSyncStatus } from '../server/supabase-sync.js';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

let stopping = false;
const cadence = Math.max(15, Number(process.env.SUPABASE_SYNC_SECONDS || 30)) * 1000;
let failures = 0;
let sefazRunning = false;
let sefazNextCheck = 0;
function checkSefaz() {
  if (process.env.SEFAZ_AUTO_SYNC === 'false' || sefazRunning || Date.now() < sefazNextCheck)
    return;
  sefazRunning = true;
  sefazNextCheck = Date.now() + 5 * 60000;
  const script = fileURLToPath(new URL('./sync-sefaz.ps1', import.meta.url));
  const powershell =
    process.env.POWERSHELL_EXE ||
    (process.platform === 'win32'
      ? join(
          process.env.SystemRoot || 'C:\\Windows',
          'System32',
          'WindowsPowerShell',
          'v1.0',
          'powershell.exe'
        )
      : 'pwsh');
  const child = spawn(powershell, ['-NoProfile', '-File', script, '-MaxBatches', '20'], {
    windowsHide: true,
    stdio: ['ignore', 'inherit', 'inherit']
  });
  child.on('error', (error) => {
    sefazRunning = false;
    console.error('Consulta SEFAZ não iniciada: ' + error.code);
  });
  child.on('exit', () => {
    sefazRunning = false;
  });
}
process.on('SIGINT', () => {
  stopping = true;
});
process.on('SIGTERM', () => {
  stopping = true;
});
while (!stopping) {
  checkSefaz();
  const started = Date.now();
  let delay = cadence;
  try {
    await syncSupabaseFromFalco();
    const status = readSupabaseSyncStatus();
    console.log(JSON.stringify({ at: new Date().toISOString(), ...status }));
    failures = 0;
    delay = Math.max(1000, cadence - (Date.now() - started));
  } catch (error) {
    failures++;
    delay = Math.min(300000, cadence * 2 ** Math.min(failures, 4));
    console.error(
      JSON.stringify({ at: new Date().toISOString(), error: String(error.message).slice(0, 350) })
    );
  }
  if (!stopping) await new Promise((resolve) => setTimeout(resolve, delay));
}
