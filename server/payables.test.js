import test from 'node:test';
import assert from 'node:assert/strict';
import { payablesSelection } from '../public/lib/payables.js';
import { cashFlow } from '../public/lib/cash-flow.js';
import { publishPayables, payablesRoute, validPayablesStoragePath } from './payables-route.js';
import { readFile } from 'node:fs/promises';
const options = { inicio: '2026-10-01', fim: '2026-10-31', today: '2026-10-10' };
const payable = [
  {
    id: '1/1/1',
    companyCode: 1,
    titleNumber: 1,
    installment: 1,
    documentNumber: '500',
    supplier: 'Água',
    amount: 50,
    dueOn: '2026-10-15',
    originalDueOn: '2026-09-15',
    blocked: true
  },
  {
    id: '5/2/1',
    companyCode: 5,
    titleNumber: 2,
    installment: 1,
    documentNumber: '501',
    supplier: 'Azul',
    amount: 20,
    dueOn: '2026-10-01'
  },
  { id: '1/3/1', companyCode: 1, titleNumber: 3, installment: 1, amount: 80, dueOn: '2026-11-01' }
];
const receivable = [
  { companyCode: 1, invoiceNumber: 101, amount: 100, dueOn: '2026-10-15' },
  { companyCode: 5, invoiceNumber: 102, amount: 40, dueOn: '2026-10-20', anticipated: true },
  { companyCode: 5, invoiceNumber: 103, amount: 30, dueOn: '2026-10-01' }
];
test('contas a pagar usa vencimento reprogramado e identifica bloqueados sem duplicar obrigações', () => {
  const selected = payablesSelection(payable, options);
  assert.deepEqual(selected.totals, { forecast: 50, overdue: 20, blocked: 50 });
  assert.equal(selected.rows.length, 2);
  assert.equal(payablesSelection(payable, { ...options, company: '3' }).totals.overdue, 20);
  assert.equal(payablesSelection(payable, { ...options, query: 'agua' }).totals.forecast, 50);
  assert.equal(payablesSelection(payable, { ...options, status: 'blocked' }).rows.length, 1);
});
test('receber e pagar conciliam por dia, empresa e vencimento sem antecipados nem atraso na previsão futura', () => {
  const f = cashFlow(receivable, payable, options);
  assert.equal(f.receivable, 100);
  assert.equal(f.payable, 50);
  assert.equal(f.balance, 50);
  assert.equal(f.overdueReceivable, 30);
  assert.equal(f.overduePayable, 20);
  assert.equal(f.anticipated, 40);
  assert.deepEqual(f.days, [{ date: '2026-10-15', receivable: 100, payable: 50, balance: 50 }]);
  assert.equal(
    cashFlow(receivable, payable, { ...options, query: 'ninguém', status: 'overdue' }).balance,
    50
  );
  assert.equal(cashFlow(receivable, payable, { ...options, company: '3' }).balance, 0);
  assert.equal(
    cashFlow(receivable, payable, { ...options, inicio: '2026-11-01', fim: '2026-11-30' }).balance,
    -80
  );
});
test('publicação financeira revisa títulos e mantém catálogo anterior em falha com sinalização explícita', async () => {
  const state = {},
    uploads = [];
  const upload = async (path) => uploads.push(path);
  const first = await publishPayables(
    { available: true, checkedAt: 'a', rows: payable },
    state,
    upload
  );
  await publishPayables({ available: true, checkedAt: 'b', rows: payable }, state, upload);
  assert.equal(uploads.length, 1);
  const stale = await publishPayables({ available: false }, state, upload);
  assert.equal(stale.stale, true);
  assert.equal(stale.checkedAt, 'b');
  const next = await publishPayables(
    { available: true, checkedAt: 'c', rows: payable.slice(1) },
    state,
    upload
  );
  assert.notEqual(first.path, next.path);
  assert.equal(uploads.length, 2);
  assert.equal(validPayablesStoragePath(next.path), true);
  const download = async () => ({
    ok: true,
    json: async () => ({ available: true, rows: payable })
  });
  assert.equal((await payablesRoute({ user: null, metadata: next, download })).status, 403);
  assert.equal(
    (await payablesRoute({ user: { role: 'fiscal' }, metadata: next, download })).status,
    403
  );
  assert.equal(
    (
      await payablesRoute({
        user: { role: 'admin' },
        metadata: { available: true, path: '../config.json' },
        download
      })
    ).status,
    503
  );
  assert.equal(
    (await payablesRoute({ user: { role: 'admin' }, metadata: stale, download })).body.stale,
    true
  );
});
test('pagamentos e provisões não entram no catálogo de obrigações reais; notas vinculadas não multiplicam parcelas', async () => {
  const sql = await readFile(new URL('./maserp-payables.js', import.meta.url), 'utf8');
  assert.match(sql, /par_datapagamento_DT IS NULL AND c.par_databaixa_DT IS NULL/);
  assert.match(sql, /par_excluidonadevolucao_BT/);
  assert.match(sql, /par_previsaofixa_BT/);
  assert.match(sql, /FOR JSON PATH/);
  assert.match(sql, /COALESCE\(c.par_datareprogramada_DT,c.par_datavencimento_DT\)/);
  for (const file of ['../vercel.json', '../frontend-vercel/vercel.json']) {
    const cfg = JSON.parse(await readFile(new URL(file, import.meta.url), 'utf8'));
    assert.ok(
      cfg.rewrites.some(
        (r) =>
          r.source === '/api/commercial/payables' &&
          r.destination === '/api/executive?crmRoute=payables'
      )
    );
  }
});
