// Coletor independente: lê fontes locais e publica somente no Supabase.
// Não inicia consultas de distribuição SEFAZ nem altera arquivos do ERP.
import { syncSupabaseFromFalco, readSupabaseSyncStatus } from '../server/supabase-sync.js';

let stopping = false;
process.on('SIGINT', () => {
  stopping = true;
});
process.on('SIGTERM', () => {
  stopping = true;
});
while (!stopping) {
  let delay = 300_000;
  try {
    await syncSupabaseFromFalco();
    const status = readSupabaseSyncStatus();
    console.log(JSON.stringify({ at: new Date().toISOString(), ...status }));
    if (status.configured && !status.artifactBackfillComplete && !status.artifactErrors)
      delay = 1000;
  } catch (error) {
    console.error(
      JSON.stringify({ at: new Date().toISOString(), error: String(error.message).slice(0, 350) })
    );
  }
  if (!stopping) await new Promise((resolve) => setTimeout(resolve, delay));
}
