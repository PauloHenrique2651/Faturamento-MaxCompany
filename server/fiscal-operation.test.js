import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyFiscalOperation } from './fiscal-operation.js';

test('separa venda, devolução de compra e retorno de industrialização pelo CFOP', () => {
  const item = (cfop) => [{ cfop }];
  assert.equal(
    classifyFiscalOperation({ purpose: '1', operation: 'Venda', items: item('5102') }).type,
    'sale'
  );
  assert.equal(
    classifyFiscalOperation({ purpose: '4', operation: 'Devolução de compra', items: item('6202') })
      .type,
    'return'
  );
  assert.equal(
    classifyFiscalOperation({
      purpose: '1',
      operation: 'Retorno de mercadoria utilizada na industrializacao por enc',
      items: item('6902')
    }).type,
    'industrial-return'
  );
  assert.equal(
    classifyFiscalOperation({
      purpose: '1',
      operation: 'Retorno',
      items: [{ cfop: '6902' }, { cfop: '5102' }]
    }).type,
    'mixed'
  );
});
