import assert from 'node:assert/strict';
import test from 'node:test';
import { baseSummary, storageCandidates } from '../frontend-vercel/api/[...path].js';

const row = (overrides = {}) => ({
  key: '35260912345678000123550010000000011000000010',
  company: 'MaxPlast',
  date: '2026-09-25',
  number: '1',
  series: '1',
  value: 100,
  supplier: { id: '12345678000123', name: 'Cliente' },
  fiscalOperation: { type: 'return' },
  full: true,
  ...overrides
});

test('API cloud reconcilia somente devoluções recebidas vinculadas a venda', () => {
  const summary = baseSummary(
    [row({ saleReference: { key: '1' } }), row({ key: '2'.padStart(44, '0'), value: 40 })],
    '2026-09-01',
    '2026-09-30',
    'incoming'
  );
  assert.equal(summary.returns.count, 2);
  assert.equal(summary.returns.value, 140);
  assert.equal(summary.returns.linkedToSaleCount, 1);
  assert.equal(summary.returns.linkedToSaleValue, 100);
});

test('API cloud restringe o caminho persistido ao padrão fiscal do documento', () => {
  const key = '35260912345678000123550010000000011000000010';
  const document = {
    company_id: 1,
    direction: 'outgoing',
    access_key: key,
    xml_storage_path: `1/outgoing/${key}.xml`
  };
  assert.deepEqual(storageCandidates(document, 'xml'), [`1/outgoing/${key}.xml`]);
});
