import { createHash } from 'node:crypto';
export const validPayablesStoragePath = (path) =>
  /^payables\/catalog\/[a-f0-9]{24}\.json$/.test(String(path || ''));
export async function publishPayables(snapshot, state, upload) {
  if (!snapshot.available)
    return {
      ...(state.payables || {}),
      available: Boolean(state.payables?.path),
      stale: true,
      error: 'Não foi possível revisar o contas a pagar no MASERP.'
    };
  const { checkedAt, ...data } = snapshot;
  const content = Buffer.from(JSON.stringify(data));
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 24);
  const path = `payables/catalog/${hash}.json`;
  if (state.payables?.path !== path) {
    try {
      await upload(path, content, 'application/json');
    } catch (error) {
      if (!/409|already exists/.test(String(error.message))) throw error;
    }
  }
  state.payables = { available: true, path, checkedAt, count: snapshot.rows.length };
  return state.payables;
}
export async function payablesRoute({ user, metadata, download }) {
  if (!user || user.role === 'fiscal') return { status: 403, body: { error: 'Acesso restrito.' } };
  if (!metadata?.available || !validPayablesStoragePath(metadata.path))
    return {
      status: 503,
      body: { error: 'O contas a pagar ainda não foi revisado pelo coletor.' }
    };
  const response = await download(metadata.path);
  if (!response.ok)
    return { status: 503, body: { error: 'Contas a pagar temporariamente indisponível.' } };
  return {
    status: 200,
    body: {
      ...(await response.json()),
      checkedAt: metadata.checkedAt,
      stale: Boolean(metadata.stale)
    }
  };
}
