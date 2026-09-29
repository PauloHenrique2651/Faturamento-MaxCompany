import { readFile } from 'node:fs/promises';
import { baseSummary, documentFromCloud } from '../frontend-vercel/api/[...path].js';

const { url, secretKey } = JSON.parse(
  await readFile(new URL('../data/supabase/config.json', import.meta.url), 'utf8')
);
const start = process.argv[2] || '2026-09-01';
const end = process.argv[3] || '2026-09-29';
const headers = { apikey: secretKey, Authorization: `Bearer ${secretKey}` };
async function rows(path) {
  const result = [];
  for (let offset = 0; ; offset += 500) {
    const response = await fetch(`${url}${path}&limit=500&offset=${offset}`, { headers });
    if (!response.ok) throw new Error(`Consulta falhou: ${response.status}`);
    const page = await response.json();
    result.push(...page);
    if (page.length < 500) return result;
  }
}
const raw = await rows(
  `/rest/v1/fiscal_documents?select=*&issued_on=gte.${start}&issued_on=lte.${end}&is_authorized=eq.true&order=issued_on.desc,company_id,access_key`
);
const outgoing = raw.filter((row) => row.direction === 'outgoing').map(documentFromCloud);
const incoming = raw.filter((row) => row.direction === 'incoming').map(documentFromCloud);
const keys = [
  ...new Set(
    incoming
      .filter((row) => row.fiscalOperation?.type === 'return')
      .flatMap((row) => row.referencedKeys || [])
  )
].filter((key) => /^\d{44}$/.test(key));
const sales = new Map();
for (let i = 0; i < keys.length; i += 50) {
  const found = await rows(
    `/rest/v1/fiscal_documents?select=*&direction=eq.outgoing&is_authorized=eq.true&is_canceled=eq.false&access_key=in.(${keys.slice(i, i + 50).join(',')})`
  );
  for (const rawSale of found) {
    const sale = documentFromCloud(rawSale);
    sales.set(`${sale.companyId}/${sale.key}`, sale);
  }
}
for (const row of incoming.filter((item) => item.fiscalOperation?.type === 'return')) {
  const sale = (row.referencedKeys || [])
    .map((key) => sales.get(`${row.companyId}/${key}`))
    .find(
      (candidate) =>
        candidate?.fiscalOperation?.type === 'sale' &&
        candidate.customer?.id &&
        candidate.customer.id === row.supplier?.id
    );
  row.saleReference = sale ? { key: sale.key, financialStatus: sale.financial.status } : null;
}
const salesSummary = baseSummary(outgoing, start, end, 'outgoing');
const purchaseSummary = baseSummary(incoming, start, end, 'incoming');
const real =
  Math.round((salesSummary.saleValue - purchaseSummary.returns.linkedToSaleValue) * 100) / 100;
console.log(
  JSON.stringify(
    {
      period: { start, end },
      outgoing: outgoing.length,
      incoming: incoming.length,
      previousOperationalSaleValue: salesSummary.operationalSaleValue,
      fiscalIssuedValue: salesSummary.value,
      financialSales: salesSummary.saleValue,
      confirmedFinancialReturns: purchaseSummary.returns.linkedToSaleValue,
      realRevenue: real,
      financialPurchases: purchaseSummary.purchaseValue,
      nonFinancialItems: salesSummary.nonFinancialValue,
      pendingClassification: salesSummary.pendingClassificationValue,
      canceledOutgoing: { count: salesSummary.canceledCount, value: salesSummary.canceledValue },
      cfops: salesSummary.cfops.map((row) => ({ cfop: row.name, value: row.value })).slice(0, 20)
    },
    null,
    2
  )
);
