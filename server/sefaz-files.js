import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { XMLParser } from 'fast-xml-parser';
import { freightInfo, taxNames, taxTotals, xmlItems } from './nfe-metrics.js';
import { matchesInvoice, searchContext } from './nfe-search.js';
import { classifyFiscalOperation } from './fiscal-operation.js';
import { findOutgoingSalesByKeys } from './nfe-files.js';

const root =
  process.env.SEFAZ_DATA_PATH ||
  join(fileURLToPath(new URL('..', import.meta.url)), 'data', 'sefaz');
const companies = [
  [1, 'MaxPlast', '0170'],
  [2, 'MaxSafety', '0141'],
  [3, 'MaxSupply', '0145'],
  [4, 'MaxSupply · Filial ES', '0226']
];
const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  removeNSPrefix: true
});
const cache = new Map();
const money = (amount) => Math.round(amount * 100) / 100;
const validKey = (key) => /^\d{44}$/.test(key);

export async function readIncomingSyncStatus() {
  let directories = [];
  try {
    directories = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    // O endpoint de saúde informa indisponibilidade sem expor caminhos locais.
  }
  return Promise.all(
    companies.map(async ([id, name, suffix]) => {
      const folder = directories.find((entry) => entry.endsWith(suffix));
      if (!folder)
        return { id, name, available: false, updatedAt: null, nextAllowedAt: null, status: null };
      try {
        const state = JSON.parse(
          (await readFile(join(root, folder, 'state.json'), 'utf8')).replace(/^\uFEFF/, '')
        );
        return {
          id,
          name,
          available: true,
          updatedAt: state.UpdatedAt || null,
          nextAllowedAt: state.NextAllowedAt || null,
          status: state.LastStatus || null
        };
      } catch {
        return { id, name, available: true, updatedAt: null, nextAllowedAt: null, status: null };
      }
    })
  );
}

export async function readIncomingDocument(companyId, key) {
  if (!validKey(key)) return null;
  const config = companies.find(([id]) => id === companyId);
  if (!config) return null;
  const [, , suffix] = config;
  let directory;
  try {
    directory = (await readdir(root, { withFileTypes: true })).find(
      (entry) => entry.isDirectory() && entry.name.endsWith(suffix)
    );
  } catch {
    return null;
  }
  if (!directory) return null;
  const folder = join(root, directory.name);
  const names = (await readdir(folder)).filter((name) => /^nsu-\d{15}-.*\.xml$/i.test(name));
  const rows = await mapLimited(names, 16, async (name) => {
    const path = join(folder, name);
    const row = await parsedFile(path, directory.name);
    return row?.kind === 'invoice' && row.key === key ? { row, path } : null;
  });
  const match = rows.filter(Boolean).sort((a, b) => Number(b.row.full) - Number(a.row.full))[0];
  if (!match) return null;
  return { row: match.row, xml: await readFile(match.path, 'utf8') };
}

export function parseSefazDocument(xml, companyCnpj) {
  const document = parser.parse(xml);
  if (document.resNFe) {
    const row = document.resNFe;
    const key = String(row.chNFe || '');
    const amount = Number(row.vNF);
    if (!validKey(key) || !Number.isFinite(amount) || amount < 0) return null;
    return {
      kind: 'invoice',
      key,
      date: String(row.dhEmi || '').slice(0, 10),
      amount,
      supplier: { id: String(row.CNPJ || ''), name: String(row.xNome || 'Não identificado') },
      number: key.slice(25, 34).replace(/^0+/, '') || '0',
      series: key.slice(22, 25).replace(/^0+/, '') || '0',
      canceled: String(row.cSitNFe || '') === '3',
      full: false
    };
  }
  if (document.nfeProc) {
    const row = document.nfeProc.NFe?.infNFe;
    const protocol = document.nfeProc.protNFe?.infProt;
    if (!row || String(row.dest?.CNPJ || '') !== companyCnpj) return null;
    const key = String(protocol?.chNFe || '').replace(/^NFe/, '');
    const invoiceKey = String(row['@_Id'] || '').replace(/^NFe/, '');
    const amount = Number(row.total?.ICMSTot?.vNF);
    if (
      !validKey(key) ||
      (invoiceKey && invoiceKey !== key) ||
      !Number.isFinite(amount) ||
      amount < 0
    )
      return null;
    const items = xmlItems(row);
    const purpose = String(row.ide?.finNFe || '');
    const operation = String(row.ide?.natOp || '');
    return {
      kind: 'invoice',
      key,
      date: String(row.ide?.dhEmi || row.ide?.dEmi || '').slice(0, 10),
      amount,
      number: String(row.ide?.nNF || ''),
      series: String(row.ide?.serie || ''),
      supplier: {
        id: String(row.emit?.CNPJ || ''),
        name: String(row.emit?.xNome || 'Não identificado')
      },
      items,
      operation,
      purpose,
      fiscalOperation: classifyFiscalOperation({ purpose, operation, items }),
      referencedKeys: (Array.isArray(row.ide?.NFref)
        ? row.ide.NFref
        : row.ide?.NFref
          ? [row.ide.NFref]
          : []
      )
        .map((ref) => String(ref.refNFe || ''))
        .filter((ref) => /^\d{44}$/.test(ref)),
      taxes: taxTotals(items),
      freight: freightInfo(row),
      canceled: !['100', '150'].includes(String(protocol?.cStat || '')),
      full: true
    };
  }
  const event = document.procEventoNFe?.retEvento?.infEvento || document.resEvento;
  if (
    String(event?.tpEvento || '') === '110111' &&
    (!event.cStat || ['135', '155'].includes(String(event.cStat))) &&
    validKey(String(event.chNFe || ''))
  ) {
    return { kind: 'cancel', key: String(event.chNFe) };
  }
  return null;
}

async function parsedFile(path, companyCnpj) {
  if (cache.has(path)) return cache.get(path);
  try {
    const value = parseSefazDocument(await readFile(path, 'utf8'), companyCnpj);
    cache.set(path, value);
    return value;
  } catch {
    return null;
  }
}

async function mapLimited(items, limit, mapper) {
  const result = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        result[index] = await mapper(items[index]);
      }
    })
  );
  return result;
}

let searchCatalog = null;
let searchCatalogAt = 0;
let searchCatalogPending = null;

async function fullSearchCatalog() {
  if (searchCatalog && Date.now() - searchCatalogAt < 10000) return searchCatalog;
  if (!searchCatalogPending) {
    searchCatalogPending = (async () => {
      const directories = (await readdir(root, { withFileTypes: true })).filter((item) =>
        item.isDirectory()
      );
      const files = [];
      for (const [id, company, suffix] of companies) {
        const directory = directories.find((item) => item.name.endsWith(suffix));
        if (!directory) continue;
        const folder = join(root, directory.name);
        for (const name of await readdir(folder)) {
          if (/^nsu-\d{15}-.*\.xml$/i.test(name))
            files.push({ path: join(folder, name), companyCnpj: directory.name, company, id });
        }
      }
      const parsed = await mapLimited(files, 16, (file) => parsedFile(file.path, file.companyCnpj));
      const invoices = new Map();
      const canceled = new Set();
      for (let index = 0; index < parsed.length; index++) {
        const row = parsed[index];
        if (!row) continue;
        const file = files[index];
        const id = `${file.id}:${row.key}`;
        if (row.kind === 'cancel') {
          canceled.add(id);
          continue;
        }
        const existing = invoices.get(id);
        if (!existing || (row.full && !existing.full))
          invoices.set(id, {
            ...row,
            company: file.company,
            companyId: file.id,
            canceled: row.canceled || existing?.canceled || false
          });
        else if (row.canceled) existing.canceled = true;
      }
      return [...invoices.values()].map((row) => ({
        ...row,
        canceled: row.canceled || canceled.has(`${row.companyId}:${row.key}`)
      }));
    })();
  }
  try {
    const result = await searchCatalogPending;
    searchCatalog = result;
    searchCatalogAt = Date.now();
    return result;
  } finally {
    searchCatalogPending = null;
  }
}

export async function searchIncomingDocuments(query) {
  const rows = await fullSearchCatalog();
  return rows
    .filter((row) => matchesInvoice(row, query))
    .map((row) => ({
      type: 'entrada',
      key: row.key,
      company: row.company,
      companyId: row.companyId,
      date: row.date,
      number: row.number,
      series: row.series,
      party: row.supplier.name,
      partyId: row.supplier.id,
      seller: null,
      value: money(row.amount),
      canceled: row.canceled,
      full: row.full,
      context: searchContext(row, query)
    }));
}

export async function readIncomingSummary(inicio, fim, companyId = null) {
  let available = 0;
  const files = [];
  const sync = [];
  for (const [id, name, suffix] of companies) {
    if (companyId !== null && id !== companyId) continue;
    let directory;
    try {
      const entries = await readdir(root, { withFileTypes: true });
      directory = entries.find((entry) => entry.isDirectory() && entry.name.endsWith(suffix));
    } catch {
      directory = null;
    }
    if (!directory) {
      sync.push({ name, available: false });
      continue;
    }
    available++;
    const companyCnpj = directory.name;
    const folder = join(root, companyCnpj);
    const entries = await readdir(folder);
    const names = entries.filter((entry) => /^nsu-\d{15}-.*\.xml$/i.test(entry));
    files.push(
      ...names.map((entry) => ({ path: join(folder, entry), companyCnpj, company: name }))
    );
    let state = {};
    try {
      state = JSON.parse(
        (await readFile(join(folder, 'state.json'), 'utf8')).replace(/^\uFEFF/, '')
      );
    } catch {
      // Um lote pode estar sendo gravado enquanto o dashboard atualiza.
    }
    sync.push({
      name,
      available: true,
      documents: names.length,
      updatedAt: state.UpdatedAt || null,
      status: state.LastStatus || null,
      nextAllowedAt: state.NextAllowedAt || null
    });
  }
  const parsed = await mapLimited(files, 16, (file) => parsedFile(file.path, file.companyCnpj));
  const canceled = new Set();
  const invoices = new Map();
  for (let index = 0; index < parsed.length; index++) {
    const row = parsed[index];
    if (!row) continue;
    const company = files[index].company;
    const id = `${company}:${row.key}`;
    if (row.kind === 'cancel') {
      canceled.add(id);
      continue;
    }
    const existing = invoices.get(id);
    if (!existing || (row.full && !existing.full))
      invoices.set(id, { ...row, company, canceled: row.canceled || existing?.canceled || false });
    else if (row.canceled) existing.canceled = true;
  }
  const daily = new Map();
  const byCompany = new Map();
  const bySupplier = new Map();
  let fullXmlCount = 0;
  const taxes = Object.fromEntries(taxNames.map((name) => [name, 0]));
  let freightValue = 0;
  let itemCount = 0;
  const documents = [];
  let canceledCount = 0;
  let amount = 0;
  let count = 0;
  const returns = [];
  for (const [id, row] of invoices) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || row.date < inicio || row.date > fim) continue;
    if (row.canceled || canceled.has(id)) {
      canceledCount++;
      continue;
    }
    count++;
    amount += row.amount;
    if (row.fiscalOperation?.type === 'return') returns.push(row);
    if (row.full) fullXmlCount++;
    if (row.full) {
      freightValue += row.freight.value;
      itemCount += row.items.length;
      for (const name of taxNames) taxes[name] += row.taxes[name];
    }
    documents.push({
      key: row.key,
      company: row.company,
      date: row.date,
      number: row.number,
      series: row.series,
      supplier: row.supplier,
      value: money(row.amount),
      full: row.full,
      items: row.full ? row.items.length : null,
      itemsDetail: row.full ? row.items : null,
      taxes: row.full ? row.taxes : null,
      freight: row.full ? row.freight : null,
      fiscalOperation: row.fiscalOperation || null,
      operation: row.operation || null,
      purpose: row.purpose || null,
      referencedKeys: row.referencedKeys || []
    });
    for (const [map, key, name] of [
      [daily, row.date, row.date],
      [byCompany, row.company, row.company],
      [bySupplier, row.supplier.id || row.supplier.name, row.supplier.name]
    ]) {
      const group = map.get(key) || { name, count: 0, value: 0 };
      group.count++;
      group.value += row.amount;
      map.set(key, group);
    }
  }
  const series = [];
  for (
    let day = Date.parse(`${inicio}T12:00:00Z`);
    day <= Date.parse(`${fim}T12:00:00Z`);
    day += 86400000
  ) {
    const date = new Date(day).toISOString().slice(0, 10);
    const value = daily.get(date) || { count: 0, value: 0 };
    series.push({ date, count: value.count, value: money(value.value) });
  }
  const ranked = (map) =>
    [...map.values()]
      .map((row) => ({ ...row, value: money(row.value) }))
      .sort((a, b) => b.value - a.value);
  let salesByKey = new Map();
  try {
    salesByKey = await findOutgoingSalesByKeys(returns.flatMap((row) => row.referencedKeys || []));
  } catch {
    // Sem índice de saídas, a devolução fica visível, mas não reduz vendas.
  }
  const matchedReturns = new Map();
  for (const row of returns) {
    const sale = row.referencedKeys
      .map((key) => salesByKey.get(key))
      .find((sale) => sale && sale.company === row.company && sale.customer.id === row.supplier.id);
    if (sale)
      matchedReturns.set(row.key, {
        key: sale.key,
        number: sale.number,
        series: sale.series,
        customer: sale.customer,
        seller: sale.seller
      });
  }
  for (const document of documents) {
    if (matchedReturns.has(document.key)) document.saleReference = matchedReturns.get(document.key);
  }
  return {
    checkedAt: new Date().toISOString(),
    period: { inicio, fim },
    invoiceCount: count,
    value: money(amount),
    returns: {
      value: money(returns.reduce((sum, row) => sum + row.amount, 0)),
      count: returns.length,
      itemCount: returns.reduce((sum, row) => sum + row.items.length, 0),
      quantity: money(
        returns.reduce((sum, row) => sum + row.items.reduce((n, item) => n + item.quantity, 0), 0)
      ),
      partyCount: new Set(returns.map((row) => row.supplier.id)).size,
      linkedToSaleCount: matchedReturns.size,
      linkedToSaleValue: money(
        returns
          .filter((row) => matchedReturns.has(row.key))
          .reduce((sum, row) => sum + row.amount, 0)
      ),
      incompleteCount: count - fullXmlCount,
      documents: documents.filter((row) => row.fiscalOperation?.type === 'return')
    },
    canceledCount,
    canceledDocuments: [...invoices.entries()]
      .filter(([id, row]) => row.canceled || canceled.has(id))
      .map(([, row]) => ({ key: row.key, company: row.company })),
    fullXmlCount,
    summaryOnlyCount: count - fullXmlCount,
    itemCount,
    freightValue: money(freightValue),
    taxes: Object.fromEntries(Object.entries(taxes).map(([name, amount]) => [name, money(amount)])),
    documents: documents.sort(
      (a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number)
    ),
    daily: series,
    companies: ranked(byCompany),
    suppliers: ranked(bySupplier),
    sourcesAvailable: available,
    sourcesTotal: sync.length,
    sync
  };
}
