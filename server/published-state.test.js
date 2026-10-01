import { preserveFullIncomingSnapshot, samePublishedInvoiceState } from './supabase-sync.js';
import test from 'node:test';
import assert from 'node:assert/strict';
test('revisão detecta conciliação perdida ou devolução alterada sem depender da ordem JSON', () => {
  const target = {
    normalSale: true,
    gross: 100,
    returnedValue: 20,
    netValue: 80,
    orderNumber: 1,
    orderSeries: 'A',
    sellerCode: 4,
    returnedItems: [
      { companyCode: 1, number: 55, sequence: 2, returnedQuantity: 1, returnedValue: 20 }
    ]
  };
  const stored = {
    ...target,
    returnedItems: [
      { returnedValue: 20, returnedQuantity: 1, sequence: 2, number: 55, companyCode: 1 }
    ]
  };
  assert.equal(samePublishedInvoiceState(stored, target), true);
  assert.equal(samePublishedInvoiceState(undefined, target), false);
  assert.equal(samePublishedInvoiceState({ ...stored, returnedValue: 0 }, target), false);
  assert.equal(
    samePublishedInvoiceState(
      { ...stored, returnedItems: [{ sequence: 2, returnedQuantity: 2, returnedValue: 20 }] },
      target
    ),
    false
  );
});

test('resumo SEFAZ preserva itens do XML e atualiza o cancelamento', () => {
  const stored = {
    is_full_xml: true,
    is_canceled: false,
    amount: 100,
    items: [{ code: '1', cfop: '5102', value: 100 }],
    source_payload: { full: true, itemsDetail: [{ code: '1', cfop: '5102' }] }
  };
  const summary = {
    is_full_xml: false,
    is_canceled: true,
    amount: 100,
    items: null,
    source_payload: { full: false }
  };
  const merged = preserveFullIncomingSnapshot(summary, stored);
  assert.equal(merged.is_full_xml, true);
  assert.equal(merged.is_canceled, true);
  assert.deepEqual(merged.items, stored.items);
  assert.deepEqual(merged.source_payload.itemsDetail, stored.source_payload.itemsDetail);
  assert.equal(preserveFullIncomingSnapshot(summary, undefined), summary);
});
