import assert from 'node:assert/strict';
import test from 'node:test';
import {
  commercialPerformance,
  displayPeriod,
  proratedTarget
} from '../public/lib/commercial-performance.js';
import { purchaseSuggestions, reconcilePurchases } from '../public/lib/purchase-match.js';
import { validateTarget } from './sales-targets.js';
import { validateEquivalence } from './product-equivalences.js';

const item = (extra = {}) => ({
  name: 'Luva nitrilica industrial tamanho G',
  ncm: '40151900',
  unit: 'PAR',
  quantity: 10,
  value: 100,
  discount: 0,
  cfop: '5102',
  ...extra
});
const sale = (extra = {}) => ({
  key: 'S1',
  company: 'MaxPlast',
  date: '2026-09-21',
  number: '123',
  value: 100,
  seller: 'Adilson Catib',
  fiscalOperation: { type: 'sale' },
  itemsDetail: [item()],
  ...extra
});
const purchase = (extra = {}) => ({
  key: 'P1',
  company: 'MaxPlast',
  date: '2026-09-10',
  number: '456',
  supplier: { name: 'Fornecedor Exemplo' },
  full: true,
  fiscalOperation: { type: 'sale' },
  itemsDetail: [item({ value: 60 })],
  ...extra
});

test('entrada da SEFAZ só serve como preço de referência com identidade e data comprovadas', () => {
  const result = reconcilePurchases({ documents: [sale()] }, { documents: [purchase()] });
  assert.equal(result.matchedLines, 1);
  assert.equal(result.matchedSaleValue, 100);
  assert.equal(result.purchaseReferenceValue, 60);
  assert.equal(result.difference, 40);
  assert.equal(result.matches[0].purchaseKey, 'P1');
});

test('não mistura devolução, empresa, NCM, unidade ou compra posterior com venda', () => {
  const incoming = [
    purchase({ fiscalOperation: { type: 'return' } }),
    purchase({ company: 'MaxSafety' }),
    purchase({ itemsDetail: [item({ ncm: '40151100' })] }),
    purchase({ itemsDetail: [item({ unit: 'UN' })] }),
    purchase({ date: '2026-09-21' }),
    purchase({ date: '2026-09-22' })
  ];
  const result = reconcilePurchases({ documents: [sale()] }, { documents: incoming });
  assert.equal(result.matchedLines, 0);
  assert.equal(result.unmatchedLines, 1);
  assert.equal(result.difference, 0);
});

test('preços conflitantes na última data não geram custo estimado', () => {
  const result = reconcilePurchases(
    { documents: [sale()] },
    { documents: [purchase(), purchase({ key: 'P2', itemsDetail: [item({ value: 90 })] })] }
  );
  assert.equal(result.matchedLines, 0);
  assert.equal(result.ambiguousLines, 1);
});

test('sugestão não calcula custo antes de equivalência aprovada no CRM', () => {
  const outgoing = {
    documents: [
      sale({
        companyId: 1,
        itemsDetail: [item({ code: 'INT-1', name: 'Luva nitrilica industrial tamanho G azul' })]
      })
    ]
  };
  const incoming = {
    documents: [
      purchase({
        companyId: 1,
        supplier: { id: '12345678000199', name: 'Fornecedor' },
        itemsDetail: [
          item({ code: 'FOR-7', name: 'Luva nitrilica industrial tamanho G azul embalagem' })
        ]
      })
    ]
  };
  assert.equal(reconcilePurchases(outgoing, incoming).matchedLines, 0);
  assert.equal(purchaseSuggestions(outgoing, incoming).length, 1);
  const equivalence = validateEquivalence({
    companyId: 1,
    saleCode: 'INT-1',
    saleName: 'Luva nitrilica industrial tamanho G azul',
    supplierId: '12345678000199',
    purchaseCode: 'FOR-7',
    purchaseName: 'Luva nitrilica industrial tamanho G azul embalagem',
    ncm: '40151900',
    unit: 'PAR'
  });
  const result = reconcilePurchases(outgoing, incoming, { equivalences: [equivalence] });
  assert.equal(result.matchedLines, 1);
  assert.match(result.matches[0].basis, /Equivalência aprovada/);
});

test('meta mensal prevalece sobre a anual e devolução vinculada reduz realizado', () => {
  const period = displayPeriod('month', '2026-09-28');
  const targets = [
    {
      scope_type: 'group',
      scope_key: 'group',
      period_kind: 'year',
      period_start: '2026-01-01',
      amount: 12000
    },
    {
      scope_type: 'group',
      scope_key: 'group',
      period_kind: 'month',
      period_start: '2026-09-01',
      amount: 2200
    }
  ];
  const incoming = {
    returns: {
      documents: [
        {
          key: 'R1',
          date: '2026-09-23',
          value: 20,
          fiscalOperation: { type: 'return' },
          saleReference: { key: 'S1', financialStatus: 'financial' }
        }
      ]
    }
  };
  const result = commercialPerformance(
    { documents: [sale()], customerGroups: [] },
    incoming,
    targets,
    period
  );
  assert.equal(result.gross, 100);
  assert.equal(result.returned, 20);
  assert.equal(result.net, 80);
  assert.equal(result.target, 2200);
  assert.equal(result.sellers[0].net, 80);
  assert.equal(proratedTarget(targets, 'group', 'group', '2026-09-01', '2026-09-02'), 200);
});

test('meta inválida não entra no banco próprio do CRM', () => {
  assert.throws(() =>
    validateTarget({
      scopeType: 'company',
      scopeKey: '5',
      scopeName: 'Outra',
      periodKind: 'month',
      periodStart: '2026-09-01',
      amount: 100
    })
  );
  assert.throws(() =>
    validateTarget({
      scopeType: 'group',
      scopeKey: 'group',
      scopeName: 'Grupo',
      periodKind: 'month',
      periodStart: '2026-02-30',
      amount: 100
    })
  );
  assert.deepEqual(
    validateTarget({
      scopeType: 'seller',
      scopeKey: 'Álvaro',
      scopeName: 'Álvaro',
      periodKind: 'month',
      periodStart: '2026-09-01',
      amount: 100
    }).scope_key,
    'ALVARO'
  );
});
