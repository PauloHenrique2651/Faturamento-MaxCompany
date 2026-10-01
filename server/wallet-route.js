import { createHash } from 'node:crypto';
export const validWalletStoragePath = (path) =>
  /^wallet\/catalog\/[a-f0-9]{24}\.json$/.test(String(path || ''));
export async function publishWallet(snapshot, state, upload) {
  if (!snapshot.available)
    return {
      ...(state.wallet || {}),
      available: Boolean(state.wallet?.path),
      stale: true,
      error: 'Não foi possível revisar a carteira no MASERP.'
    };
  const { checkedAt, ...contentData } = snapshot;
  const content = Buffer.from(JSON.stringify(contentData));
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 24);
  const path = `wallet/catalog/${hash}.json`;
  if (state.wallet?.path !== path) {
    try {
      await upload(path, content, 'application/json');
    } catch (error) {
      if (!/409|already exists/.test(String(error.message))) throw error;
    }
  }
  state.wallet = { available: true, path, checkedAt, count: snapshot.rows.length };
  return state.wallet;
}
export async function walletRoute({ user, metadata, download }) {
  if (!user || user.role === 'fiscal') return { status: 403, body: { error: 'Acesso restrito.' } };
  if (!metadata?.available || !validWalletStoragePath(metadata.path))
    return { status: 503, body: { error: 'A carteira ainda não foi revisada pelo coletor.' } };
  const response = await download(metadata.path);
  if (!response.ok)
    return { status: 503, body: { error: 'Carteira temporariamente indisponível.' } };
  return {
    status: 200,
    body: {
      ...(await response.json()),
      checkedAt: metadata.checkedAt,
      stale: Boolean(metadata.stale)
    }
  };
}
