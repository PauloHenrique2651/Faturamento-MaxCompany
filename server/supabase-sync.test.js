import test from 'node:test';
import assert from 'node:assert/strict';
import {
  artifactPaths,
  normalizeCloudDocument,
  selectArtifactBatch,
  changedDocuments,
  mergeArtifactQueue
} from './supabase-sync.js';

test('sincronização envia somente mudanças reais, ignorando timestamps de consulta', () => {
  const row = {
    company_id: 1,
    direction: 'outgoing',
    access_key: '1'.repeat(44),
    amount: 100,
    synced_at: 'primeiro'
  };
  const first = changedDocuments([row]);
  assert.equal(first.changed.length, 1);
  assert.equal(
    changedDocuments([{ ...row, synced_at: 'segundo' }], first.fingerprints).changed.length,
    0
  );
  assert.equal(changedDocuments([{ ...row, amount: 150 }], first.fingerprints).changed.length, 1);
});

test('fila histórica persiste enquanto os metadados consultam somente o período recente', () => {
  const row = { company: 'MaxPlast', key: '1'.repeat(44) };
  const state = { completedDocuments: {} };
  state.artifactQueue = mergeArtifactQueue([row], [], state);
  assert.equal(mergeArtifactQueue([], [], state).length, 1);
  state.completedDocuments[artifactPaths(row, 'outgoing').id] = 'concluído';
  assert.equal(mergeArtifactQueue([], [], state).length, 0);
});

test('normaliza uma NF-e de venda para armazenamento privado no Supabase', () => {
  const document = normalizeCloudDocument(
    {
      company: 'MaxPlast',
      key: '35260912345678000123550010000000011000000010',
      date: '2026-09-25',
      number: '1',
      series: '1',
      value: 1250.5,
      customer: { id: '12345678000123', name: 'Cliente teste' },
      fiscalOperation: { type: 'sale', cfops: ['5102'] },
      items: 2,
      taxes: { ICMS: 100 },
      freight: { value: 10 }
    },
    'outgoing'
  );
  assert.equal(document.company_id, 1);
  assert.equal(document.direction, 'outgoing');
  assert.equal(document.counterparty_name, 'Cliente teste');
  assert.equal(document.fiscal_operation.type, 'sale');
  assert.equal(document.is_full_xml, true);
  assert.equal(document.is_canceled, false);
  assert.equal(
    normalizeCloudDocument({ company: 'MaxPlast', canceled: true }, 'outgoing').is_canceled,
    true
  );
});

test('backfill ignora concluídos sem consumir o limite e alterna saídas e entradas', () => {
  const key = (value) => String(value).padStart(44, '0');
  const outgoing = [1, 2, 3].map((value) => ({
    company: 'MaxPlast',
    key: key(value)
  }));
  const incoming = [4, 5].map((value) => ({
    company: 'MaxPlast',
    key: key(value),
    full: true
  }));
  const completed = artifactPaths(outgoing[0], 'outgoing').id;
  const batch = selectArtifactBatch(
    outgoing,
    incoming,
    { completedDocuments: { [completed]: '2026-09-25T12:00:00Z' } },
    4
  );
  assert.deepEqual(
    batch.map(({ row, direction }) => [row.key, direction]),
    [
      [key(2), 'outgoing'],
      [key(4), 'incoming'],
      [key(3), 'outgoing'],
      [key(5), 'incoming']
    ]
  );
});

test('backfill não tenta sincronizar resumo de entrada sem XML completo', () => {
  const row = { company: 'MaxPlast', key: '1'.padStart(44, '0'), full: false };
  assert.deepEqual(selectArtifactBatch([], [row], {}, 10), []);
});

test('XML de compra importado pelo Falco recebe DANFE antes da fila histórica', () => {
  const key = (value) => String(value).padStart(44, '0');
  const rows = [
    { company: 'MaxPlast', key: key(1), full: true },
    { company: 'MaxPlast', key: key(2), full: true, source: 'falco-import' }
  ];
  const queue = mergeArtifactQueue([], rows, {});
  const batch = selectArtifactBatch(
    [],
    queue.filter((row) => row.direction === 'incoming'),
    {},
    1
  );
  assert.equal(batch[0].row.key, key(2));
});

test('cancelamentos emitidos recebem XML e DANFE antes da fila histórica', () => {
  const key = (value) => String(value).padStart(44, '0');
  const queue = mergeArtifactQueue(
    [
      { company: 'MaxPlast', key: key(1) },
      { company: 'MaxPlast', key: key(2), canceled: true }
    ],
    [],
    {}
  );
  const batch = selectArtifactBatch(
    queue.filter((row) => row.direction === 'outgoing'),
    [],
    {},
    1
  );
  assert.equal(batch[0].row.key, key(2));
});
