import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyInvoiceStates,
  registeredSalesReturns,
  returnKind
} from '../public/lib/erp-documents.js';
import {
  baseSummary,
  documentFromCloud,
  documentDetailFromCloud
} from '../frontend-vercel/api/[...path].js';
import { scopedDocuments } from '../frontend-vercel/lib/cloud-fiscal.js';
import { commercialPerformance } from '../public/lib/commercial-performance.js';
import { classifyFiscalOperation } from '../public/lib/fiscal-operation.js';

const seller = 'TIAGO ZAGRI DOS SANTOS';
const make = (number, gross, returned) => {
  const key = String(number).padStart(44, '0');
  const row = {
    companyId: 3,
    company: 'MaxSupply',
    key,
    number,
    date: '2026-09-08',
    seller: 'Texto antigo',
    value: gross,
    customer: { id: 'braskem', name: 'BRASKEM S.A.' },
    purpose: '1',
    itemsDetail: [
      { sequence: 1, code: 'A', name: 'Produto', cfop: '6102', value: gross, quantity: 1 }
    ],
    fiscalOperation: { type: 'sale' }
  };
  return applyInvoiceStates(
    [row],
    [
      {
        companyCode: 5,
        accessKey: key,
        normalSale: true,
        gross,
        returnedValue: returned,
        sellerName: seller,
        orderNumber: 100,
        returnedItems: [{ sequence: 1, returnedQuantity: 1, returnedValue: returned }]
      }
    ]
  )[0];
};
test('Braskem: devolução integral aparece no vendedor, no resumo, nos itens e no detalhe sem duplicar SEFAZ', () => {
  const rows = [
    make(791, 362780.8, 362780.8),
    make(793, 325656.58, 325656.58),
    make(815, 141425.6, 0)
  ];
  const summary = baseSummary(rows, '2026-09-01', '2026-09-30', 'outgoing');
  assert.equal(summary.salesReturns.value, 688437.38);
  assert.equal(summary.salesReturns.net, 141425.6);
  assert.equal(summary.sellers[0].returnedValue, 688437.38);
  assert.equal(summary.sellers[0].netValue, 141425.6);
  assert.equal(summary.products[0].returnedValue, 688437.38);
  assert.equal(
    scopedDocuments(rows, new URLSearchParams({ vendedorNfe: 'tiago zagri dos santos' })).length,
    3
  );
  const result = commercialPerformance(
    summary,
    {
      returns: {
        documents: [
          {
            fiscalOperation: { type: 'return' },
            value: 688437.38,
            saleReference: { key: rows[0].key, financialStatus: 'financial' }
          }
        ]
      }
    },
    [],
    { start: '2026-09-01', end: '2026-09-30', horizon: '2026-09-30' }
  );
  assert.equal(result.returned, 688437.38);
  assert.equal(result.sellers[0].returns, 688437.38);
  assert.equal(result.sellers[0].net, 141425.6);
  assert.equal(result.daily.at(-1).cumulative, 141425.6);
  const cloud = {
    company_id: 3,
    direction: 'outgoing',
    access_key: rows[0].key,
    issued_on: rows[0].date,
    amount: rows[0].value,
    is_authorized: true,
    source_payload: rows[0]
  };
  assert.equal(documentFromCloud(cloud).erp.returnedValue, 362780.8);
  assert.equal(documentDetailFromCloud(cloud).erp.returnedItems[0].returnedQuantity, 1);
});
test('cancelamento não infla vendas nem devoluções; revisão pode zerar devolução antiga', () => {
  const row = make(791, 100, 100);
  assert.equal(registeredSalesReturns([{ ...row, canceled: true }]).value, 0);
  const reviewed = applyInvoiceStates(
    [row],
    [
      {
        companyCode: 5,
        accessKey: row.key,
        normalSale: true,
        gross: 100,
        returnedValue: 0,
        sellerName: seller
      }
    ]
  );
  assert.equal(registeredSalesReturns(reviewed).value, 0);
  assert.equal(registeredSalesReturns(reviewed).net, 100);
});
test('devoluções de compra e de venda conservam direção e não viram receita', () => {
  for (const [cfop, kind] of [
    ['5202', 'purchase'],
    ['6202', 'purchase'],
    ['1202', 'sales'],
    ['2202', 'sales']
  ]) {
    const operation = classifyFiscalOperation({ purpose: '4', items: [{ cfop }] });
    assert.equal(returnKind({ fiscalOperation: operation }), kind);
  }
  assert.equal(
    returnKind({
      direction: 'incoming',
      supplier: {},
      fiscalOperation: { type: 'return', returnKind: 'purchase' }
    }),
    'sales'
  );
});
