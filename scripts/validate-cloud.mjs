import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { documentFromCloud } from '../frontend-vercel/api/[...path].js';
import { renderFiscalViews } from '../server/fiscal-ui.test.js';

const config = JSON.parse(
  await readFile(new URL('../data/supabase/config.json', import.meta.url), 'utf8')
);
const headers = { apikey: config.secretKey, Authorization: 'Bearer ' + config.secretKey };
const raw = [];
for (let offset = 0; ; offset += 500) {
  const response = await fetch(
    config.url +
      '/rest/v1/fiscal_documents?select=*&issued_on=gte.2026-09-01&issued_on=lte.2026-09-26&is_canceled=eq.false&is_authorized=eq.true&order=issued_on.desc,company_id,access_key&limit=500&offset=' +
      offset,
    { headers }
  );
  assert.equal(response.status, 200);
  const page = await response.json();
  raw.push(...page);
  if (page.length < 500) break;
}
const outgoing = raw.filter((row) => row.direction === 'outgoing').map(documentFromCloud);
const incoming = raw.filter((row) => row.direction === 'incoming').map(documentFromCloud);
const rendered = renderFiscalViews(outgoing, incoming, '2026-09-01', '2026-09-26');
const summary = rendered.state.nfeData;
assert.ok(summary.products.length > 0);
assert.ok(!summary.customers.some((row) => row.id === '53234274000101'));
assert.equal(
  Math.round(summary.customers.reduce((sum, row) => sum + row.value, 0) * 100),
  Math.round(summary.saleValue * 100)
);
let filesChecked = 0;
for (const company of [1, 2, 3, 4]) {
  const document = raw.find(
    (row) =>
      row.company_id === company &&
      row.direction === 'outgoing' &&
      row.xml_storage_path &&
      row.pdf_storage_path
  );
  if (!document) continue;
  for (const path of [document.xml_storage_path, document.pdf_storage_path]) {
    const response = await fetch(config.url + '/storage/v1/object/fiscal-documents/' + path, {
      headers
    });
    assert.equal(response.status, 200);
    await response.arrayBuffer();
    filesChecked++;
  }
}
console.log(
  JSON.stringify({
    outgoing: outgoing.length,
    incoming: incoming.length,
    products: summary.products.length,
    saleValue: summary.saleValue,
    customers: summary.customers.length,
    plastirealInSales: false,
    privateFilesChecked: filesChecked
  })
);
