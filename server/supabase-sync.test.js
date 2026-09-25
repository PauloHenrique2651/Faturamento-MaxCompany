import test from 'node:test';
import assert from 'node:assert/strict';
import { artifactPaths, normalizeCloudDocument, selectArtifactBatch } from './supabase-sync.js';

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
