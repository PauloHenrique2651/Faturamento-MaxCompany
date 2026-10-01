import { walletRoute } from './wallet-route.js';
import { payablesRoute } from './payables-route.js';
export async function financeRoute({ user, metadata, download }) {
  if (!user || user.role === 'fiscal') return { status: 403, body: { error: 'Acesso restrito.' } };
  const [wallet, payables] = await Promise.all([
    walletRoute({ user, metadata: metadata.wallet, download }),
    payablesRoute({ user, metadata: metadata.payables, download })
  ]);
  if (wallet.status !== 200 && payables.status !== 200)
    return {
      status: 503,
      body: { error: 'As carteiras ainda não foram publicadas pelo coletor.' }
    };
  return {
    status: 200,
    body: {
      wallet: wallet.status === 200 ? wallet.body : null,
      payables: payables.status === 200 ? payables.body : null,
      errors: [
        wallet.status !== 200 ? wallet.body.error : '',
        payables.status !== 200 ? payables.body.error : ''
      ].filter(Boolean)
    }
  };
}
