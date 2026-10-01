import test from 'node:test';
import assert from 'node:assert/strict';
import { walletSelection } from '../public/lib/wallet.js';
import { publishWallet, walletRoute, validWalletStoragePath } from './wallet-route.js';
const rows = [
  {
    id: '1/1/1',
    companyCode: 1,
    invoiceNumber: 101,
    customer: 'Água',
    paymentTerms: '30 dias',
    dueOn: '2026-10-15',
    amount: 100
  },
  {
    id: '1/2/1',
    companyCode: 1,
    invoiceNumber: 102,
    customer: 'Azul',
    dueOn: '2026-10-01',
    amount: 20
  },
  {
    id: '5/3/1',
    companyCode: 5,
    invoiceNumber: 103,
    customer: 'Braskem',
    dueOn: '2026-10-15',
    amount: 40,
    anticipated: true
  },
  {
    id: '5/4/1',
    companyCode: 5,
    invoiceNumber: 104,
    customer: 'Braskem',
    dueOn: '2026-11-15',
    amount: 500
  }
];
test('carteira filtra vencimento, separa vencidos e antecipados sem somar duas vezes', () => {
  const params = { inicio: '2026-10-01', fim: '2026-10-31', today: '2026-10-02' };
  const r = walletSelection(rows, params);
  assert.equal(r.rows.length, 3);
  assert.deepEqual(r.totals, { forecast: 100, overdue: 20, anticipated: 40 });
  assert.equal(
    r.days.reduce((n, r) => n + r.value, 0),
    120
  );
  assert.equal(walletSelection(rows, { ...params, company: '3' }).rows.length, 1);
  assert.equal(walletSelection(rows, { ...params, query: 'agua' }).totals.forecast, 100);
  assert.equal(
    walletSelection(rows, { ...params, inicio: '2026-11-01', fim: '2026-11-30' }).totals.forecast,
    500
  );
});
test('publicação conserva último retrato em falha e troca catálogo quando parcelas mudam', async () => {
  const state = {},
    uploads = [];
  const upload = async (p, b) => uploads.push({ p, body: JSON.parse(b) });
  let m = await publishWallet({ available: true, rows, checkedAt: 'a' }, state, upload);
  await publishWallet({ available: true, rows, checkedAt: 'b' }, state, upload);
  assert.equal(uploads.length, 1);
  const stale = await publishWallet({ available: false }, state, upload);
  assert.equal(stale.stale, true);
  assert.equal(stale.checkedAt, 'b');
  m = await publishWallet({ available: true, rows: rows.slice(1), checkedAt: 'c' }, state, upload);
  assert.equal(uploads.length, 2);
  assert.equal(m.count, 3);
  assert.equal(validWalletStoragePath(m.path), true);
  assert.equal(validWalletStoragePath('../config.json'), false);
  const download = async () => ({ ok: true, json: async () => ({ rows }) });
  assert.equal((await walletRoute({ user: null, metadata: m, download })).status, 403);
  assert.equal(
    (await walletRoute({ user: { role: 'fiscal' }, metadata: m, download })).status,
    403
  );
  assert.equal(
    (await walletRoute({ user: { role: 'admin' }, metadata: m, download })).body.rows.length,
    4
  );
  assert.equal(
    (await walletRoute({ user: { role: 'admin' }, metadata: { path: '../config.json' }, download }))
      .status,
    503
  );
});
test('as duas raízes da Vercel expõem a carteira autenticada', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const file of ['../vercel.json', '../frontend-vercel/vercel.json']) {
    const cfg = JSON.parse(await readFile(new URL(file, import.meta.url), 'utf8'));
    assert.ok(
      cfg.rewrites.some(
        (r) =>
          r.source === '/api/commercial/wallet' &&
          r.destination === '/api/executive?crmRoute=wallet'
      )
    );
  }
});

test('carteira lê parcelas abertas e revisa todo o saldo sem filtro de emissão', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('./maserp-wallet.js', import.meta.url), 'utf8');
  assert.match(source, /ctr_databaixa_DT IS NULL/);
  assert.match(source, /ctr_datapagamento_DT IS NULL/);
  assert.match(source, /ctr_excluidanadevolucao_BT/);
  assert.match(source, /not_cancelada_BT/);
  assert.match(source, /COALESCE\(c.ctr_datareprogramada_DT,c.ctr_datavencimento_DT\)/);
  assert.ok(!source.split('SELECT n.emp_empresa_IN')[0].includes('not_dataemissao_DT>='));
  const collector = await readFile(new URL('./supabase-sync.js', import.meta.url), 'utf8');
  assert.match(collector, /publishWallet\(await readMaserpWallet\(\), state, uploadObject\)/);
});

test('carteira permite situação e ordenação sem alterar a separação dos recebimentos', () => {
  const params = { inicio: '2026-10-01', fim: '2026-10-31', today: '2026-10-02' };
  assert.equal(walletSelection(rows, { ...params, status: 'forecast' }).totals.forecast, 100);
  assert.equal(walletSelection(rows, { ...params, status: 'overdue' }).totals.overdue, 20);
  assert.equal(walletSelection(rows, { ...params, status: 'anticipated' }).totals.anticipated, 40);
  assert.equal(walletSelection(rows, { ...params, sort: 'value' }).rows[0].amount, 100);
  assert.equal(walletSelection(rows, { ...params, sort: 'value' }).days[0].date, '2026-10-01');
});
