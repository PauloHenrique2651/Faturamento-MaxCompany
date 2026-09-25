import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCloudDocument } from './supabase-sync.js';

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
