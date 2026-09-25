import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { XMLParser } from 'fast-xml-parser';
import { freightInfo, taxNames, taxTotals, xmlItems } from './nfe-metrics.js';
import { keyMatchesNumber, matchesInvoice, searchContext } from './nfe-search.js';
import { customerGroup, registeredCustomerName } from './customer-groups.js';
import { classifyFiscalOperation } from './fiscal-operation.js';

const nfeRoot = process.env.FALCO_NFE_PATH || '\\\\maxcompany\\DEPLOY\\NFE';
// O XML permanece na pasta do Falco. Um espelho só existe quando for configurado
// explicitamente, para não duplicar milhares de documentos no projeto do CRM.
const archiveRoot = process.env.FALCO_NFE_ARCHIVE || null;
const cacheRoot = join(fileURLToPath(new URL('..', import.meta.url)), 'data', 'cache');
const companies = [
  [1, 'MaxPlast', 'Maxplast'],
  [2, 'MaxSafety', 'Maxsafety'],
  [3, 'MaxSupply', 'Maxsupply'],
  [4, 'MaxSupply · Filial ES', 'Maxsupply_FilialES']
];
export const nfeCompanies = companies.map(([id, nome]) => ({ id, nome }));
const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  removeNSPrefix: true
});
const parsedFiles = new Map();
const filePattern = /^(\d{44})-(nfe|caneve)\.xml$/i;
const roundMoney = (value) => Math.round(value * 100) / 100;
const danfePrefix = { Maxplast: '01', Maxsafety: '03', Maxsupply: '05', Maxsupply_FilialES: '06' };

export async function readOutgoingDocument(companyId, key) {
  if (!/^\d{44}$/.test(key)) return null;
  const match = companies.find(([id]) => id === companyId);
  if (!match) return null;
  const [, company, suffix] = match;
  const filename = `${key}-nfe.xml`;
  for (const root of [nfeRoot, archiveRoot].filter(Boolean)) {
    try {
      const xml = await readFile(join(root, `XmlDestinatario_${suffix}`, filename), 'utf8');
      const row = parseNfeXml(xml, key, 'invoice', company);
      if (!row?.authorized) continue;
      const pdfName = `${danfePrefix[suffix]}.${row.number.padStart(7, '0')}.pdf`;
      const pdfPath = join(nfeRoot, `DanfePDF_${suffix}`, pdfName);
      let hasPdf = false;
      try {
        hasPdf = (await stat(pdfPath)).isFile();
      } catch {
        // O Falco pode ainda não ter gerado o DANFE.
      }
      return { row, xml, pdfPath: hasPdf ? pdfPath : null };
    } catch {
      // Busca o arquivo espelhado quando a pasta de produção está fora do ar.
    }
  }
  return null;
}

function monthCode(date) {
  return date.slice(2, 4) + date.slice(5, 7);
}

function withinMonths(filename, firstMonth, lastMonth) {
  const match = filename.match(filePattern);
  // Chave NF-e: código UF (2 dígitos), ano/mês (4), demais campos.
  return match && match[1].slice(2, 6) >= firstMonth && match[1].slice(2, 6) <= lastMonth;
}

export function parseNfeXml(xml, key, kind, company) {
  const doc = parser.parse(xml);
  if (kind === 'cancel') {
    const event = doc.procEventoNFe?.retEvento?.infEvento;
    const status = String(event?.cStat || '');
    return ['135', '155'].includes(status) ? { kind: 'cancel', key } : null;
  }
  const invoice = doc.nfeProc?.NFe?.infNFe;
  const protocol = doc.nfeProc?.protNFe?.infProt;
  if (!invoice) return null;
  if (String(invoice.ide?.tpNF || '') !== '1') return null;
  if (String(invoice.ide?.tpAmb || '1') !== '1') return null;
  const date = String(invoice.ide?.dhEmi || invoice.ide?.dEmi || '').slice(0, 10);
  const amount = Number(invoice.total?.ICMSTot?.vNF);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(amount) || amount < 0) return null;
  const items = xmlItems(invoice).filter((item) => item.name && item.value >= 0);
  const purpose = String(invoice.ide?.finNFe || '');
  const operation = String(invoice.ide?.natOp || '');
  return {
    kind: 'invoice',
    key,
    company,
    date,
    amount,
    number: String(invoice.ide?.nNF || ''),
    series: String(invoice.ide?.serie || ''),
    issuerCnpj: String(invoice.emit?.CNPJ || ''),
    taxRegime: String(invoice.emit?.CRT || ''),
    operation,
    purpose,
    fiscalOperation: classifyFiscalOperation({ purpose, operation, items }),
    customer: {
      id: String(invoice.dest?.CNPJ || invoice.dest?.CPF || invoice.dest?.xNome || ''),
      name: String(invoice.dest?.xNome || 'Não identificado').trim()
    },
    uf: String(invoice.dest?.enderDest?.UF || '')
      .trim()
      .toUpperCase(),
    seller:
      String(invoice.infAdic?.infCpl || '')
        .match(/\(\s*Vendedor\s*:\s*([^)]+)\)/i)?.[1]
        ?.trim()
        .replace(/\s+/g, ' ') || null,
    items,
    referencedKeys: (Array.isArray(invoice.ide?.NFref)
      ? invoice.ide.NFref
      : invoice.ide?.NFref
        ? [invoice.ide.NFref]
        : []
    )
      .map((ref) => String(ref.refNFe || ''))
      .filter((ref) => /^\d{44}$/.test(ref)),
    discount: Number(invoice.total?.ICMSTot?.vDesc) || 0,
    freight: freightInfo(invoice),
    taxes: taxTotals(items),
    simpleIcmsCredit: roundMoney(items.reduce((sum, item) => sum + item.simpleIcmsCredit, 0)),
    authorized: ['100', '150'].includes(String(protocol?.cStat || ''))
  };
}

async function getParsed({ path, archivePath, key, kind, company }) {
  if (parsedFiles.has(path)) return parsedFiles.get(path);
  try {
    const xml = await readFile(path, 'utf8');
    const data = parseNfeXml(xml, key, kind, company);
    if (data && archivePath && path !== archivePath) {
      await mkdir(dirname(archivePath), { recursive: true });
      try {
        await writeFile(archivePath, xml, { flag: 'wx' });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }
    parsedFiles.set(path, data);
    return data;
  } catch {
    // Um XML ainda em gravação será tentado novamente na próxima leitura.
    return null;
  }
}

async function readDirectory(company, suffix, kind, firstMonth, lastMonth, preferArchive = false) {
  const folder = `${kind === 'invoice' ? 'XmlDestinatario' : 'XmlCancelamentoDestinatario'}_${suffix}`;
  const sourceDirectory = join(nfeRoot, folder);
  const archiveDirectory = archiveRoot ? join(archiveRoot, folder) : null;
  const [source, archive] = await Promise.allSettled([
    readdir(sourceDirectory, { withFileTypes: true }),
    ...(archiveDirectory ? [readdir(archiveDirectory, { withFileTypes: true })] : [])
  ]);
  if (source.status === 'rejected' && (!archiveDirectory || archive?.status === 'rejected'))
    throw source.reason;
  const entries = new Map();
  for (const [result, directory] of [
    [archive, archiveDirectory],
    [source, sourceDirectory]
  ]) {
    if (!directory || result?.status !== 'fulfilled') continue;
    for (const item of result.value) {
      if (preferArchive && entries.has(item.name)) continue;
      if (item.isFile() && withinMonths(item.name, firstMonth, lastMonth))
        entries.set(item.name, {
          path: join(directory, item.name),
          archivePath: archiveDirectory ? join(archiveDirectory, item.name) : null,
          key: item.name.slice(0, 44),
          kind,
          company
        });
    }
  }
  return { online: source.status === 'fulfilled', files: [...entries.values()] };
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
const searchIndexPath = join(cacheRoot, 'nfe-search-index.json');

async function listSearchFiles() {
  const listed = await Promise.allSettled(
    companies.flatMap(([, company, suffix]) => [
      readDirectory(company, suffix, 'invoice', '0000', '9999', true),
      readDirectory(company, suffix, 'cancel', '0000', '9999', true)
    ])
  );
  const available = listed.filter((entry) => entry.status === 'fulfilled');
  if (!available.length) throw new Error('Pastas de NF-e indisponíveis');
  const files = available.flatMap((entry) => entry.value.files);
  return {
    invoices: files.filter((file) => file.kind === 'invoice'),
    cancellations: files.filter((file) => file.kind === 'cancel')
  };
}

async function parsedSearchFiles(invoices, cancellations) {
  const [rows, events] = await Promise.all([
    mapLimited(invoices, 16, getParsed),
    mapLimited(cancellations, 16, getParsed)
  ]);
  return {
    rows: rows.filter((row) => row?.kind === 'invoice' && row.authorized),
    canceled: new Set(events.filter((row) => row?.kind === 'cancel').map((row) => row.key))
  };
}

function compactSearchRow(row) {
  return {
    key: row.key,
    company: row.company,
    date: row.date,
    amount: row.amount,
    number: row.number,
    series: row.series,
    customer: { ...row.customer, registeredName: registeredCustomerName(row.customer) },
    seller: row.seller,
    operation: row.operation,
    freight: row.freight,
    referencedKeys: row.referencedKeys,
    purpose: row.purpose,
    fiscalOperation: row.fiscalOperation,
    items: row.items.map((item) => ({
      code: item.code,
      order: item.order,
      name: item.name,
      ncm: item.ncm,
      cfop: item.cfop
    }))
  };
}

async function storedSearchCatalog() {
  try {
    const saved = JSON.parse(await readFile(searchIndexPath, 'utf8'));
    if (saved.version === 3 && Array.isArray(saved.rows) && Array.isArray(saved.canceled))
      return { rows: saved.rows, canceled: new Set(saved.canceled) };
  } catch {
    // O índice é derivado dos XMLs e pode ser reconstruído.
  }
  return { rows: [], canceled: new Set() };
}

async function fullSearchCatalog() {
  if (searchCatalog && Date.now() - searchCatalogAt < 10000) return searchCatalog;
  if (!searchCatalogPending) {
    searchCatalogPending = (async () => {
      const previous = searchCatalog || (await storedSearchCatalog());
      const files = await listSearchFiles();
      const known = new Set(previous.rows.map((row) => `${row.company}:${row.key}`));
      const newInvoices = files.invoices.filter(
        (file) => !known.has(`${file.company}:${file.key}`)
      );
      const newEvents = files.cancellations.filter((file) => !previous.canceled.has(file.key));
      if (!newInvoices.length && !newEvents.length) return previous;
      const added = await parsedSearchFiles(newInvoices, newEvents);
      const result = {
        rows: [...previous.rows, ...added.rows.map(compactSearchRow)],
        canceled: new Set([...previous.canceled, ...added.canceled])
      };
      if (
        result.rows.length !== previous.rows.length ||
        result.canceled.size !== previous.canceled.size
      ) {
        await mkdir(dirname(searchIndexPath), { recursive: true });
        await writeFile(
          searchIndexPath,
          JSON.stringify({ version: 3, rows: result.rows, canceled: [...result.canceled] })
        );
      }
      return result;
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

export async function findOutgoingSalesByKeys(keys) {
  const wanted = new Set(keys.filter((key) => /^\d{44}$/.test(key)));
  if (!wanted.size) return new Map();
  const catalog = await fullSearchCatalog();
  return new Map(
    catalog.rows
      .filter(
        (row) =>
          wanted.has(row.key) &&
          !catalog.canceled.has(row.key) &&
          row.fiscalOperation?.type === 'sale'
      )
      .map((row) => [row.key, row])
  );
}

export async function searchOutgoingDocuments(query) {
  let catalog;
  if (query.key || query.number) {
    const files = await listSearchFiles();
    const matching = files.invoices.filter((file) => keyMatchesNumber(file.key, query));
    const keys = new Set(matching.map((file) => file.key));
    catalog = await parsedSearchFiles(
      matching,
      files.cancellations.filter((file) => keys.has(file.key))
    );
  } else catalog = await fullSearchCatalog();
  return catalog.rows
    .filter((row) => matchesInvoice(row, query))
    .map((row) => ({
      type: 'saida',
      key: row.key,
      company: row.company,
      companyId: companies.find(([, name]) => name === row.company)?.[0],
      date: row.date,
      number: row.number,
      series: row.series,
      party: row.customer.name,
      partyId: row.customer.id,
      seller: row.seller,
      value: roundMoney(row.amount),
      canceled: catalog.canceled.has(row.key),
      full: true,
      fiscalOperation: row.fiscalOperation,
      context: searchContext(row, query)
    }));
}

export async function readNfeSummary(inicio, fim, companyId = null, scope = {}) {
  const firstMonth = monthCode(inicio);
  const lastMonth = monthCode(fim);
  const directories = await Promise.allSettled(
    companies
      .filter(([id]) => companyId === null || id === companyId)
      .flatMap(([, company, suffix]) => [
        readDirectory(company, suffix, 'invoice', firstMonth, lastMonth),
        readDirectory(company, suffix, 'cancel', firstMonth, lastMonth)
      ])
  );
  const successful = directories.filter((item) => item.status === 'fulfilled');
  if (!successful.length) throw new Error('XMLs de NF-e indisponíveis');
  const files = successful.flatMap((item) => item.value.files);
  const parsed = (await mapLimited(files, 12, (item) => getParsed(item))).filter(Boolean);
  const canceled = new Set(parsed.filter((row) => row.kind === 'cancel').map((row) => row.key));
  const historicGroupCustomers = new Map();
  if (scope.customerGroupId) {
    const catalog = await fullSearchCatalog();
    for (const row of catalog.rows) {
      const customer = { ...row.customer, name: registeredCustomerName(row.customer) };
      if (
        catalog.canceled.has(row.key) ||
        row.fiscalOperation?.type !== 'sale' ||
        customerGroup(customer).id !== scope.customerGroupId
      )
        continue;
      const existing = historicGroupCustomers.get(customer.id) || {
        id: customer.id,
        name: customer.name,
        lastDate: row.date,
        registrations: new Set(),
        count: 0,
        value: 0
      };
      if (row.date >= existing.lastDate) {
        existing.name = customer.name;
        existing.lastDate = row.date;
      }
      existing.registrations.add(customer.name);
      if (row.customer.name) existing.registrations.add(row.customer.name);
      existing.count++;
      existing.value += row.amount;
      historicGroupCustomers.set(customer.id, existing);
    }
  }
  const invoices = new Map();
  const canceledInPeriod = new Set();
  for (const row of parsed) {
    if (row.kind !== 'invoice') continue;
    if (row.date < inicio || row.date > fim) continue;
    if (scope.customerId && row.customer.id !== scope.customerId) continue;
    if (scope.customerGroupId && customerGroup(row.customer).id !== scope.customerGroupId) continue;
    if (
      scope.sellerName &&
      row.seller?.toLocaleUpperCase('pt-BR') !== scope.sellerName.toLocaleUpperCase('pt-BR')
    )
      continue;
    if (
      scope.productCode &&
      !row.items.some((item) => (item.code || item.name) === scope.productCode)
    )
      continue;
    if (canceled.has(row.key)) {
      canceledInPeriod.add(row.key);
      continue;
    }
    if (!row.authorized) continue;
    invoices.set(row.key, row);
  }
  const daily = new Map();
  const byCompany = new Map();
  const byCustomer = new Map();
  const byCustomerGroup = new Map();
  const byProduct = new Map();
  const bySeller = new Map();
  const byUf = new Map();
  const byCfop = new Map();
  const byFreight = new Map();
  const byCarrier = new Map();
  const taxes = Object.fromEntries(taxNames.map((name) => [name, 0]));
  let freightValue = 0;
  let itemCount = 0;
  let discountValue = 0;
  let unattributedCount = 0;
  let simpleIcmsCredit = 0;
  let simpleIcmsCreditDocumentCount = 0;
  const returns = [];
  const operationTotals = new Map();
  const taxRegimes = new Map();
  for (const row of invoices.values()) {
    if (row.fiscalOperation?.type === 'return') returns.push(row);
    const kind = row.fiscalOperation?.type || 'other';
    const operationTotal = operationTotals.get(kind) || { type: kind, count: 0, value: 0 };
    operationTotal.count++;
    operationTotal.value += row.amount;
    operationTotals.set(kind, operationTotal);
    const customerIdentity = { ...row.customer, name: registeredCustomerName(row.customer) };
    simpleIcmsCredit += row.simpleIcmsCredit;
    if (row.simpleIcmsCredit > 0) simpleIcmsCreditDocumentCount++;
    const regime = taxRegimes.get(row.company) || {
      name: row.company,
      normal: 0,
      simples: 0,
      value: 0
    };
    if (row.taxRegime === '1' || row.taxRegime === '4') regime.simples++;
    else if (row.taxRegime === '3') regime.normal++;
    regime.value += row.amount;
    taxRegimes.set(row.company, regime);
    freightValue += row.freight.value;
    discountValue += row.discount;
    itemCount += row.items.length;
    for (const name of taxNames) taxes[name] += row.taxes[name];
    const freight = byFreight.get(row.freight.modality) || {
      name: row.freight.modality,
      count: 0,
      value: 0
    };
    freight.count++;
    freight.value += row.freight.value;
    byFreight.set(row.freight.modality, freight);
    if (row.freight.carrier) {
      const carrierKey = row.freight.carrierCnpj || row.freight.carrier;
      const carrier = byCarrier.get(carrierKey) || {
        name: row.freight.carrier,
        count: 0,
        value: 0
      };
      carrier.count++;
      carrier.value += row.freight.value;
      byCarrier.set(carrierKey, carrier);
    }
    const day = daily.get(row.date) || { date: row.date, count: 0, value: 0 };
    day.count += 1;
    day.value += row.amount;
    daily.set(row.date, day);
    const company = byCompany.get(row.company) || { name: row.company, count: 0, value: 0 };
    company.count += 1;
    company.value += row.amount;
    byCompany.set(row.company, company);
    if (row.fiscalOperation?.type === 'sale') {
      const customer = byCustomer.get(customerIdentity.id) || {
        id: customerIdentity.id,
        name: customerIdentity.name,
        count: 0,
        value: 0,
        registrations: new Set()
      };
      customer.count += 1;
      customer.value += row.amount;
      customer.registrations.add(customerIdentity.name);
      if (row.customer.name) customer.registrations.add(row.customer.name);
      byCustomer.set(customerIdentity.id, customer);
      const groupKey = customerGroup(customerIdentity);
      const group = byCustomerGroup.get(groupKey.id) || {
        ...groupKey,
        count: 0,
        value: 0,
        cnpjs: new Set(),
        registrations: new Set()
      };
      group.count++;
      group.value += row.amount;
      group.cnpjs.add(row.customer.id);
      group.registrations.add(row.customer.name);
      byCustomerGroup.set(groupKey.id, group);
    }
    const ufName = /^[A-Z]{2}$/.test(row.uf) ? row.uf : 'Não informado';
    const uf = byUf.get(ufName) || { name: ufName, count: 0, value: 0 };
    uf.count += 1;
    uf.value += row.amount;
    byUf.set(ufName, uf);
    if (row.fiscalOperation?.type === 'sale' && row.seller) {
      const sellerKey = row.seller.toLocaleUpperCase('pt-BR');
      const seller = bySeller.get(sellerKey) || {
        id: sellerKey,
        name: row.seller,
        count: 0,
        value: 0
      };
      seller.count += 1;
      seller.value += row.amount;
      bySeller.set(sellerKey, seller);
    } else if (row.fiscalOperation?.type === 'sale') unattributedCount += 1;
    for (const item of row.items) {
      const cfopName = /^\d{4}$/.test(item.cfop) ? item.cfop : 'Não informado';
      const cfop = byCfop.get(cfopName) || { name: cfopName, count: 0, value: 0 };
      cfop.count += 1;
      cfop.value += item.value;
      byCfop.set(cfopName, cfop);
      if (row.fiscalOperation?.type !== 'sale') continue;
      const id = `${row.company}:${item.code || item.name}`;
      const product = byProduct.get(id) || {
        id: item.code || item.name,
        name: item.name,
        company: row.company,
        count: 0,
        value: 0
      };
      product.count += 1;
      product.value += item.value;
      byProduct.set(id, product);
    }
  }
  const series = [];
  for (
    let day = Date.parse(`${inicio}T12:00:00Z`);
    day <= Date.parse(`${fim}T12:00:00Z`);
    day += 86400000
  ) {
    const date = new Date(day).toISOString().slice(0, 10);
    const row = daily.get(date) || { date, count: 0, value: 0 };
    series.push({ ...row, value: roundMoney(row.value) });
  }
  const returnValue = roundMoney(returns.reduce((total, row) => total + row.amount, 0));
  const totalValue = roundMoney(
    [...invoices.values()].reduce((total, row) => total + row.amount, 0)
  );
  const returnsByDate = new Map();
  for (const row of returns)
    returnsByDate.set(row.date, (returnsByDate.get(row.date) || 0) + row.amount);
  const salesByDate = new Map();
  for (const row of invoices.values())
    if (row.fiscalOperation?.type === 'sale')
      salesByDate.set(row.date, (salesByDate.get(row.date) || 0) + row.amount);
  const returnDaily = series.map((row) => ({
    date: row.date,
    value: roundMoney(returnsByDate.get(row.date) || 0),
    total: row.value,
    sale: roundMoney(salesByDate.get(row.date) || 0)
  }));
  return {
    checkedAt: new Date().toISOString(),
    scope: {
      customerId: scope.customerId || null,
      customerGroupId: scope.customerGroupId || null,
      customerGroupName: scope.customerGroupId
        ? [...byCustomerGroup.values()][0]?.name || null
        : null,
      customerName: scope.customerId ? [...invoices.values()][0]?.customer.name || null : null,
      sellerName: scope.sellerName || null,
      productCode: scope.productCode || null
    },
    period: { inicio, fim },
    invoiceCount: invoices.size,
    value: totalValue,
    operations: [...operationTotals.values()].map((row) => ({
      ...row,
      value: roundMoney(row.value)
    })),
    saleValue: roundMoney(operationTotals.get('sale')?.value || 0),
    returns: {
      value: returnValue,
      count: returns.length,
      itemCount: returns.reduce((total, row) => total + row.items.length, 0),
      quantity: roundMoney(
        returns.reduce(
          (total, row) => total + row.items.reduce((sum, item) => sum + item.quantity, 0),
          0
        )
      ),
      customerCount: new Set(returns.map((row) => row.customer.id)).size,
      percent: totalValue ? roundMoney((returnValue / totalValue) * 100) : 0,
      netDocumentValue: roundMoney(totalValue - returnValue),
      daily: returnDaily,
      documents: returns
        .map((row) => ({
          key: row.key,
          company: row.company,
          date: row.date,
          number: row.number,
          series: row.series,
          customer: row.customer,
          seller: row.seller,
          value: roundMoney(row.amount),
          items: row.items.length,
          itemsDetail: row.items,
          fiscalOperation: row.fiscalOperation,
          operation: row.operation,
          referencedKeys: row.referencedKeys
        }))
        .sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number))
    },
    canceledCount: canceledInPeriod.size,
    itemCount,
    customerCount: historicGroupCustomers.size || byCustomer.size,
    customerGroupCount: byCustomerGroup.size,
    sellerCount: bySeller.size,
    discountValue: roundMoney(discountValue),
    freightValue: roundMoney(freightValue),
    taxes: Object.fromEntries(
      Object.entries(taxes).map(([name, amount]) => [name, roundMoney(amount)])
    ),
    simpleIcmsCredit: roundMoney(simpleIcmsCredit),
    simpleIcmsCreditDocumentCount,
    taxRegimes: [...taxRegimes.values()].map((row) => ({ ...row, value: roundMoney(row.value) })),
    freightModalities: [...byFreight.values()]
      .map((row) => ({ ...row, value: roundMoney(row.value) }))
      .sort((a, b) => b.value - a.value),
    carriers: [...byCarrier.values()]
      .map((row) => ({ ...row, value: roundMoney(row.value) }))
      .sort((a, b) => b.value - a.value),
    documents: [...invoices.values()]
      .map((row) => ({
        key: row.key,
        company: row.company,
        date: row.date,
        number: row.number,
        series: row.series,
        customer: row.customer,
        seller: row.seller,
        value: roundMoney(row.amount),
        items: row.items.length,
        itemsDetail: row.items,
        taxes: row.taxes,
        simpleIcmsCredit: row.simpleIcmsCredit,
        freight: row.freight,
        fiscalOperation: row.fiscalOperation,
        operation: row.operation,
        purpose: row.purpose,
        referencedKeys: row.referencedKeys
      }))
      .sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number)),
    daily: series,
    companies: [...byCompany.values()]
      .map((company) => ({ ...company, value: roundMoney(company.value) }))
      .sort((a, b) => b.value - a.value),
    customers: (() => {
      const result = new Map(
        [...byCustomer.values()].map((customer) => [customer.id, { ...customer }])
      );
      for (const member of historicGroupCustomers.values()) {
        const customer = result.get(member.id);
        if (customer) {
          for (const registration of member.registrations) customer.registrations.add(registration);
        } else {
          result.set(member.id, {
            id: member.id,
            name: member.name,
            count: 0,
            value: 0,
            registrations: member.registrations
          });
        }
      }
      return [...result.values()]
        .map((customer) => ({
          ...customer,
          registrations: [...customer.registrations],
          value: roundMoney(customer.value)
        }))
        .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, 'pt-BR'));
    })(),
    customerGroups: [...byCustomerGroup.values()]
      .map((group) => ({
        id: group.id,
        name: group.name,
        count: group.count,
        value: roundMoney(group.value),
        cnpjCount: group.cnpjs.size,
        registrationCount: group.registrations.size
      }))
      .sort((a, b) => b.value - a.value),
    products: [...byProduct.values()]
      .map((product) => ({ ...product, value: roundMoney(product.value) }))
      .sort((a, b) => b.value - a.value),
    sellers: [...bySeller.values()]
      .map((seller) => ({ ...seller, value: roundMoney(seller.value) }))
      .sort((a, b) => b.value - a.value),
    unattributedCount,
    ufs: [...byUf.values()]
      .map((uf) => ({ ...uf, value: roundMoney(uf.value) }))
      .sort((a, b) => b.value - a.value),
    cfops: [...byCfop.values()]
      .map((cfop) => ({ ...cfop, value: roundMoney(cfop.value) }))
      .sort((a, b) => b.value - a.value),
    filesInspected: files.length,
    sourcesAvailable: successful.filter((item) => item.value.online).length,
    sourcesTotal: directories.length
  };
}
