import test from 'node:test';
import assert from 'node:assert/strict';
import {
  financialDocument,
  financialSaleValue,
  financialPurchaseValue,
  confirmedFinancialReturn
} from '../public/lib/financial-cfops.js';
import { classifyFiscalOperation } from '../public/lib/fiscal-operation.js';

const row = (items, value = 100, type = 'sale') => ({
  value,
  full: true,
  fiscalOperation: { type },
  itemsDetail: items
});
const item = (cfop, value) => ({ cfop, value });

test('classifica 5102 e 6102 como venda financeira por item', () => {
  assert.equal(financialSaleValue(row([item('5102', 40), item('6102', 60)])), 100);
});

test('5949 não gera financeiro e nota mista preserva o valor de cada item', () => {
  const mixed = row([item('5102', 70), item('5949', 30)]);
  assert.deepEqual(
    [financialDocument(mixed).financialValue, financialDocument(mixed).nonFinancialValue],
    [70, 30]
  );
  assert.equal(financialSaleValue(mixed), 70);
  assert.equal(
    financialSaleValue({
      ...mixed,
      fiscalOperation: classifyFiscalOperation({ purpose: '1', items: mixed.itemsDetail }),
      purpose: '1'
    }),
    70
  );
  assert.equal(financialSaleValue(row([item('5949', 100)])), 0);
});

test('cancelamento nunca gera venda e compra financeira não vira receita', () => {
  assert.equal(financialSaleValue({ ...row([item('5102', 100)]), canceled: true }), 0);
  const purchase = row([item('1102', 100)]);
  assert.equal(financialPurchaseValue(purchase), 100);
  assert.equal(financialSaleValue({ ...purchase, fiscalOperation: { type: 'return' } }), 0);
});

test('sem itens, CFOP ausente e diferença não atribuível ficam pendentes', () => {
  assert.equal(financialDocument(row([])).pendingValue, 100);
  assert.equal(financialDocument(row([item('', 40)], 40)).pendingValue, 40);
  assert.equal(financialDocument(row([item('5102', 70)], 100)).pendingValue, 30);
});

test('devolução só abate quando vinculada a venda integralmente financeira', () => {
  const returned = {
    ...row([item('1202', 25)], 25, 'return'),
    saleReference: { financialStatus: 'financial' }
  };
  assert.equal(confirmedFinancialReturn(returned), 25);
  assert.equal(
    confirmedFinancialReturn({ ...returned, saleReference: { financialStatus: 'mixed' } }),
    0
  );
  assert.equal(confirmedFinancialReturn({ ...returned, canceled: true }), 0);
});
