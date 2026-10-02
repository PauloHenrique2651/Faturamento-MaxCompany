import assert from 'node:assert/strict';
import test from 'node:test';
import { renderMostrador } from '../public/mostrador.js';

test('mostrador has a separate live carteira tab with date, series and account links', () => {
  const params = new URLSearchParams({ inicio: '2026-10-02', fim: '2026-10-04', empresa: '1' });
  const wallet = {
    available: true,
    checkedAt: '2026-10-02T12:00:00.000Z',
    rows: [
      { companyCode: 1, dueOn: '2026-10-03', amount: 300, anticipated: false },
      { companyCode: 1, dueOn: '2026-10-03', amount: 50, anticipated: true },
      { companyCode: 1, dueOn: '2026-10-01', amount: 40, anticipated: false }
    ]
  };
  const payables = {
    available: true,
    checkedAt: '2026-10-02T12:00:00.000Z',
    rows: [{ companyCode: 1, dueOn: '2026-10-04', amount: 125, blocked: true }]
  };
  const { html } = renderMostrador(null, null, [], params, {
    slide: 4,
    walletData: wallet,
    payablesData: payables
  });
  assert.match(html, /class="display-slide active" data-slide="4"/);
  assert.match(html, /data-display-cash-series="both"/);
  assert.match(html, /data-display-cash-mode="daily"/);
  assert.match(html, /A receber<\/span><strong>R\$\s*300,00<\/strong>/);
  assert.match(html, /A pagar<\/span><strong>R\$\s*125,00<\/strong>/);
  assert.match(html, /bloqueado a pagar: <strong>R\$\s*125,00<\/strong> \(incluído\)/);
  assert.match(html, /#carteira\?inicio=2026-10-02&amp;fim=2026-10-04&amp;empresa=1/);
  assert.match(html, /#pagar\?inicio=2026-10-02&amp;fim=2026-10-04&amp;empresa=1/);
});
