import assert from 'node:assert/strict';
import test from 'node:test';
import handler, {
  baseSummary,
  documentDetailFromCloud,
  storageCandidates
} from '../frontend-vercel/api/[...path].js';
import documentRoute from '../frontend-vercel/api/falco/documento.js';
import rootDocumentRoute from '../api/falco/documento.js';
import { scopedDocuments, searchDocuments } from '../frontend-vercel/lib/cloud-fiscal.js';
import { classifyFiscalOperation } from '../server/fiscal-operation.js';

test('Vercel publica uma rota explícita para o detalhe e arquivos da NF-e', () => {
  assert.equal(documentRoute, handler);
  assert.equal(rootDocumentRoute, handler);
});

test('cancelamentos preservam valor e documento, sem inflar vendas autorizadas', () => {
  const sale = row({ fiscalOperation: { type: 'sale' }, value: 150 });
  const canceled = row({
    key: '35260912345678000123550010000000021000000020',
    fiscalOperation: { type: 'sale' },
    value: 90,
    canceled: true
  });
  const summary = baseSummary([sale, canceled], '2026-09-01', '2026-09-30', 'outgoing');
  assert.equal(summary.saleValue, 150);
  assert.equal(summary.value, 150);
  assert.equal(summary.canceledValue, 90);
  assert.equal(summary.canceledSaleValue, 90);
  assert.equal(summary.canceledDocuments.length, 1);
});

test('produtos e clientes incluem somente vendas, nunca remessa e retorno da Plastireal', () => {
  const sale = row({
    customer: { id: '12345678000123', name: 'Cliente' },
    seller: 'ANA',
    fiscalOperation: { type: 'sale' },
    items: 1,
    itemsDetail: [{ code: 'A1', name: 'Produto vendido', cfop: '5102', value: 100, quantity: 2 }],
    taxes: { ICMS: 18 },
    freight: { modality: 'CIF', value: 5 },
    uf: 'RJ',
    taxRegime: '3'
  });
  const supplier = (cfop) =>
    row({
      customer: { id: '53234274000101', name: 'PLASTIREAL' },
      seller: 'FORNECEDOR',
      value: 900,
      fiscalOperation: classifyFiscalOperation({ purpose: '1', items: [{ cfop }] }),
      itemsDetail: [{ code: 'B1', name: 'Material remetido', cfop, value: 900 }]
    });
  const summary = baseSummary(
    [sale, supplier('5901'), supplier('6902')],
    '2026-09-01',
    '2026-09-30',
    'outgoing'
  );
  assert.equal(summary.value, 1900);
  assert.equal(summary.saleValue, 100);
  assert.deepEqual(
    summary.customers.map((r) => r.id),
    ['12345678000123']
  );
  assert.deepEqual(
    summary.products.map((r) => r.id),
    ['A1']
  );
  assert.deepEqual(
    summary.sellers.map((r) => r.name),
    ['ANA']
  );
  assert.equal(summary.products[0].quantity, 2);
  assert.equal(summary.taxes.ICMS, 18);
  assert.equal(summary.ufs[0].name, 'Não informado');
  assert.equal(summary.returns.daily.length, 30);
  for (const field of ['freightModalities', 'carriers', 'taxRegimes', 'cfops'])
    assert.ok(Array.isArray(summary[field]));
});

test('filtros comerciais e busca usam os itens e preservam o CNPJ da contraparte', () => {
  const document = row({
    companyId: 1,
    direction: 'outgoing',
    customer: { id: '12345678000123', name: 'Cliente' },
    seller: 'Ana',
    itemsDetail: [{ code: 'A1', name: 'Óculos de segurança' }]
  });
  assert.equal(
    scopedDocuments([document], new URLSearchParams('produtoNfe=A1&vendedorNfe=ANA')).length,
    1
  );
  assert.equal(scopedDocuments([document], new URLSearchParams('produtoNfe=B1')).length, 0);
  assert.equal(scopedDocuments([document], new URLSearchParams('clienteNfe=outro')).length, 0);
  assert.equal(searchDocuments([document], 'oculos seguranca').total, 1);
  assert.equal(searchDocuments([document], '12.345.678/0001-23').items[0].companyId, 1);
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
