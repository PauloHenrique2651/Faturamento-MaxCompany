import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const customerCatalogPath =
  process.env.CUSTOMER_CATALOG_PATH ||
  join(fileURLToPath(new URL('..', import.meta.url)), 'data', 'customer-catalog.json');
let customerCatalog = { customers: [], ambiguousCnpjsExcluded: [] };
try {
  customerCatalog = JSON.parse(readFileSync(customerCatalogPath, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const clean = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s*-\s*\(\d+\)\s*$/, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function nameKey(value) {
  let key = clean(value);
  key = key.replace(/\b(SOCIEDADE ANONIMA|S A|SA|S A S|SAS|LTDA|LIMITADA|EIRELI|EPP|ME)\b/g, ' ');
  return key.replace(/\s+/g, ' ').trim();
}

function namedGroup(value) {
  const name = clean(value);
  if (/\bGLOBO COMUNICACAO\b/.test(name)) return { id: 'grupo:globo', name: 'Grupo Globo' };
  if (/\bCSN\b|\b(?:COMPANHIA|CIA) SIDERURGICA NACIONAL\b/.test(name))
    return { id: 'grupo:csn', name: 'Grupo CSN' };
  if (/\bBAKER HUGHES\b/.test(name)) return { id: 'grupo:baker-hughes', name: 'Baker Hughes' };
  return null;
}

const parent = new Map();
const rank = new Map();
const rootNames = new Map();
const nameRoots = new Map();
const recordsByRoot = new Map();
const recordsByCnpj = new Map();
const ambiguousCnpjs = new Set(customerCatalog.ambiguousCnpjsExcluded || []);

function find(root) {
  const current = parent.get(root);
  if (current === root) return root;
  const representative = find(current);
  parent.set(root, representative);
  return representative;
}

function unite(first, second) {
  let a = find(first);
  let b = find(second);
  if (a === b) return;
  if (rank.get(a) < rank.get(b)) [a, b] = [b, a];
  parent.set(b, a);
  if (rank.get(a) === rank.get(b)) rank.set(a, rank.get(a) + 1);
}

for (const record of customerCatalog.customers) {
  const root = record.cnpj.slice(0, 8);
  if (!parent.has(root)) {
    parent.set(root, root);
    rank.set(root, 0);
  }
  const bucket = recordsByRoot.get(root) || [];
  bucket.push(record);
  recordsByRoot.set(root, bucket);
  recordsByCnpj.set(record.cnpj, record);
  for (const legalName of record.legalNames) {
    const key = nameKey(legalName);
    if (!key) continue;
    const names = rootNames.get(root) || new Set();
    names.add(legalName);
    rootNames.set(root, names);
    const roots = nameRoots.get(key) || new Set();
    roots.add(root);
    nameRoots.set(key, roots);
  }
}

for (const roots of nameRoots.values()) {
  const [first, ...rest] = roots;
  for (const root of rest) unite(first, root);
}

const clusters = new Map();
for (const root of parent.keys()) {
  const clusterRoot = find(root);
  const cluster = clusters.get(clusterRoot) || {
    roots: new Set(),
    names: new Map(),
    codes: new Set()
  };
  cluster.roots.add(root);
  for (const record of recordsByRoot.get(root) || []) {
    for (const legalName of record.legalNames) {
      cluster.names.set(legalName, (cluster.names.get(legalName) || 0) + 1);
      const special = namedGroup(legalName);
      if (special) cluster.special = special;
    }
    for (const code of record.codes) cluster.codes.add(code);
  }
  clusters.set(clusterRoot, cluster);
}

const groupByRoot = new Map();
const groupByName = new Map();
for (const cluster of clusters.values()) {
  const sortedRoots = [...cluster.roots].sort();
  const names = [...cluster.names.keys()].sort(
    (a, b) =>
      cluster.names.get(b) - cluster.names.get(a) || a.length - b.length || a.localeCompare(b)
  );
  const group =
    cluster.special ||
    (sortedRoots.length === 1 && sortedRoots[0] === '05635291'
      ? { id: 'grupo:baker-hughes', name: 'Baker Hughes' }
      : { id: `cnpj:${sortedRoots[0]}`, name: names[0] || `CNPJ ${sortedRoots[0]}` });
  for (const root of cluster.roots) groupByRoot.set(root, group);
  for (const [legalName] of cluster.names) {
    const key = nameKey(legalName);
    if (key) groupByName.set(key, group);
  }
}

export function registeredCustomerName(customer) {
  const cnpj = String(customer.id || '').replace(/\D/g, '');
  if (cnpj.length !== 14 || ambiguousCnpjs.has(cnpj)) return String(customer.name || '').trim();
  const record = recordsByCnpj.get(cnpj);
  if (record) return record.legalNames[0] || String(customer.name || '').trim();
  const root = groupByRoot.get(cnpj.slice(0, 8));
  if (root) return root.name;
  return String(customer.name || '').trim();
}

export function customerGroup(customer) {
  const suppliedName = String(customer.name || '').trim();
  const explicit = namedGroup(suppliedName);
  if (explicit) return explicit;

  const cnpj = String(customer.id || '').replace(/\D/g, '');
  if (cnpj.length === 14) {
    if (!ambiguousCnpjs.has(cnpj)) {
      const record = recordsByCnpj.get(cnpj);
      if (record) {
        for (const name of record.legalNames) {
          const known = groupByName.get(nameKey(name));
          if (known) return known;
        }
      }
      const rootGroup = groupByRoot.get(cnpj.slice(0, 8));
      if (rootGroup) return rootGroup;
    }
    return { id: `cnpj:${cnpj.slice(0, 8)}`, name: suppliedName || `CNPJ ${cnpj.slice(0, 8)}` };
  }

  const key = nameKey(suppliedName);
  const known = groupByName.get(key);
  if (known) return known;
  return { id: `cadastro:${customer.id}`, name: clean(suppliedName) };
}
