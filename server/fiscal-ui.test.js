import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import {
  baseSummary,
  documentFromCloud,
  documentDetailFromCloud
} from '../frontend-vercel/api/[...path].js';
import * as format from '../public/lib/format.js';
import * as analysis from '../public/lib/analysis.js';
import { icon } from '../public/ui/icons.js';
import { viewLabels } from '../public/ui/navigation.js';
import { cfopCatalog, cfopDescription } from '../public/lib/cfop-catalog.js';
import { reconcilePurchases, purchaseSuggestions } from '../public/lib/purchase-match.js';
import { confirmedFinancialReturn, FINANCIAL_CFOPS } from '../public/lib/financial-cfops.js';
import { commercialPerformance } from '../public/lib/commercial-performance.js';

const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const functions = [...app.matchAll(/^(?:async )?function \w+\([^]*?^\}/gm)]
  .map((match) => match[0])
  .join('\n');
const cloudRow = {
  company_id: 1,
  direction: 'outgoing',
  access_key: '33260909562800000170550010000193071010001939',
  issued_on: '2026-09-25',
  document_number: '19307',
  series: '1',
  amount: 100,
  is_authorized: true,
  is_full_xml: true,
  xml_storage_path: '1/outgoing/33260909562800000170550010000193071010001939.xml',
  source_payload: {
    customer: { id: '12345678000123', name: 'Cliente teste' },
    seller: 'Ana',
    purpose: '1',
    items: 1,
    itemsDetail: [
      {
        code: 'A1',
        name: 'Produto teste',
        cfop: '5102',
        quantity: 2,
        value: 100,
        taxes: { ICMS: 18 }
      }
    ],
    freight: { value: 5, modality: 'CIF' },
    taxes: { ICMS: 18 }
  }
};

export function renderFiscalViews(
  outgoingRows,
  incomingRows,
  inicio = '2026-09-01',
  fim = '2026-09-25'
) {
  const nodes = new Map();
  const select = (selector) => {
    if (!nodes.has(selector))
      nodes.set(selector, {
        innerHTML: '',
        textContent: '',
        setAttribute() {},
        showModal() {
          this.open = true;
        }
      });
    return nodes.get(selector);
  };
  const state = {
    params: new URLSearchParams(),
    documentLimit: 60,
    nfeLimit: 50,
    user: { role: 'admin' },
    nfeData: baseSummary(outgoingRows, inicio, fim, 'outgoing'),
    incomingData: baseSummary(incomingRows, inicio, fim, 'incoming')
  };
  const context = vm.createContext({
    ...analysis,
    state,
    $: select,
    esc: format.escapeHtml,
    money: format.formatMoney,
    num: format.formatNumber,
    short: format.formatCompactNumber,
    date: format.formatDate,
    today: () => fim,
    icon,
    views: viewLabels,
    cfopCatalog,
    cfopDescription,
    reconcilePurchases,
    purchaseSuggestions,
    confirmedFinancialReturn,
    FINANCIAL_CFOPS,
    commercialPerformance,
    URLSearchParams,
    xmlCompanies: [
      { id: 1, nome: 'MaxPlast' },
      { id: 2, nome: 'MaxSafety' },
      { id: 3, nome: 'MaxSupply' },
      { id: 4, nome: 'MaxSupply · Filial ES' }
    ],
    document: { querySelectorAll: () => [] },
    fetchJson: async () => documentDetailFromCloud(cloudRow)
  });
  vm.runInContext('const bigMoney = (v) => `<small>R$</small>${short(v)}`;\n' + functions, context);
  const cases = {
    dashboard: 'nfeDashboard',
    faturamento: 'revenueDashboard',
    dre: 'dreDashboard',
    devolucoes: 'returnsDashboard',
    emitidas: 'outgoingDocuments',
    canceladas: 'outgoingDocuments',
    entradas: 'incomingDashboard',
    recebidas: 'incomingDocuments',
    fretes: 'freightDashboard',
    impostos: 'taxDashboard',
    produtos: 'nfeBreakdown',
    clientes: 'nfeBreakdown',
    vendedores: 'nfeBreakdown',
    fiscal: 'nfeFiscal'
  };
  for (const [view, render] of Object.entries(cases)) {
    state.view = view;
    vm.runInContext(render + '()', context);
    assert.ok(select('#page').innerHTML.length > 100, view);
    assert.ok(!select('#page').innerHTML.includes('NaN'), view + ' sem NaN');
  }
  return { context, nodes, state };
}

test('todas as telas fiscais renderizam com dados cloud e com período vazio', async () => {
  const rendered = renderFiscalViews([documentFromCloud(cloudRow)], []);
  await vm.runInContext('openInvoice("' + cloudRow.access_key + '", "saida", 1)', rendered.context);
  assert.equal(rendered.nodes.get('#detail-dialog').open, true);
  assert.match(rendered.nodes.get('#detail-content').innerHTML, /Produto teste/);
  assert.match(rendered.nodes.get('#detail-content').innerHTML, /CFOP 5102/);
  renderFiscalViews([], []);
});
