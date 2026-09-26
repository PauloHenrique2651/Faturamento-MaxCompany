import assert from 'node:assert/strict';
import test from 'node:test';
import handler, {
  baseSummary,
  documentDetailFromCloud,
  storageCandidates
} from '../frontend-vercel/api/[...path].js';
import documentRoute from '../frontend-vercel/api/falco/documento.js';

test('Vercel publica uma rota explícita para o detalhe e arquivos da NF-e', () => {
  assert.equal(documentRoute, handler);
});

test('detalhe cloud fornece valor e itens no contrato usado pelo modal', () => {
  const items = [{ code: '1', name: 'Produto', value: 100, taxes: { ICMS: 18 } }];
  const detail = documentDetailFromCloud({
    company_id: 1,
    direction: 'outgoing',
    amount: 100,
    is_full_xml: true,
    source_payload: { items: 1, itemsDetail: items }
  });
  assert.equal(detail.amount, 100);
  assert.deepEqual(detail.items, items);
  assert.equal(detail.full, true);
  assert.deepEqual(documentDetailFromCloud({ amount: 0 }).items, []);
});

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
