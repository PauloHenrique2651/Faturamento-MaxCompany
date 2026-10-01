import { samePublishedInvoiceState } from './supabase-sync.js';
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
