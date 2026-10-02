import { createHash } from 'node:crypto';
export function compactSyncDetails(details) {
  return {
    start: details.start,
    end: details.end,
    overviewSource: 'falco-current',
    metadataChanged: details.metadataChanged,
    pendingArtifacts: details.pendingArtifacts,
    artifactErrors: details.artifactErrors,
    reviewedInvoices: details.publicationReconciliation?.reviewed,
    missingInvoices: details.publicationReconciliation?.missing,
    mismatchedInvoices: details.publicationReconciliation?.mismatched,
    walletAvailable: details.wallet?.available,
    payablesAvailable: details.payables?.available
  };
}
export function overviewFingerprint(details) {
  return createHash('sha256')
    .update(
      JSON.stringify(details, (key, value) =>
        ['checkedAt', 'updatedAt', 'lastSuccessAt', 'nextCheckAt'].includes(key) ? undefined : value
      )
    )
    .digest('hex');
}
export async function publishCurrentOverview(
  details,
  state,
  request,
  at = new Date().toISOString()
) {
  const content = Object.fromEntries(
    [
      'start',
      'end',
      'wallet',
      'payables',
      'sefaz',
      'maserpSales',
      'maserpReports',
      'pendingArtifacts'
    ].map((k) => [k, details[k]])
  );
  const hash = overviewFingerprint(content);
  const values = { source: 'falco-current', status: 'success', started_at: at, finished_at: at };
  if (!state.currentOverviewId || state.currentOverviewHash !== hash) values.details = content;
  const options = {
    method: state.currentOverviewId ? 'PATCH' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: state.currentOverviewId ? 'return=minimal' : 'return=representation'
    },
    body: JSON.stringify(values)
  };
  const rows = await request(
    '/rest/v1/crm_sync_runs' + (state.currentOverviewId ? '?id=eq.' + state.currentOverviewId : ''),
    options
  );
  if (!state.currentOverviewId) {
    if (!rows?.[0]?.id) throw new Error('Publicação atual sem identificador.');
    state.currentOverviewId = rows[0].id;
  }
  state.currentOverviewHash = hash;
  return { id: state.currentOverviewId, changed: Boolean(values.details) };
}
