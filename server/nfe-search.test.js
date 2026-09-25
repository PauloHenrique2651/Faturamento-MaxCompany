import test from 'node:test';
import assert from 'node:assert/strict';
import { keyMatchesNumber, matchesInvoice, searchQuery } from './nfe-search.js';

const key = '33260916851383000141550010000050001030000508';
const row = {
  key,
  number: '5000',
  series: '1',
  company: 'MaxSafety',
  customer: { id: '03669753000182', name: 'Estaleiro Brasfels' },
  seller: 'Wesllen Vitalino',
  items: [{ code: '7526', name: 'Chapa de PTFE', ncm: '39209990', cfop: '5102' }]
};

test('número, série e chave encontram a NF-e exata', () => {
  assert.equal(keyMatchesNumber(key, searchQuery('5000')), true);
  assert.equal(matchesInvoice(row, searchQuery('5000/1')), true);
  assert.equal(matchesInvoice(row, searchQuery('5000/2')), false);
  assert.equal(matchesInvoice(row, searchQuery('500')), false);
  assert.equal(matchesInvoice(row, searchQuery(key)), true);
});

test('busca textual inclui cliente, vendedor e produto sem depender de acentos', () => {
  assert.equal(matchesInvoice(row, searchQuery('brasfels')), true);
  assert.equal(matchesInvoice(row, searchQuery('wesllen chapa')), true);
  assert.equal(matchesInvoice(row, searchQuery('ptfé')), true);
  assert.equal(matchesInvoice(row, searchQuery('fornecedor inexistente')), false);
});

test('CNPJ formatado e sem pontuação localizam o mesmo destinatário', () => {
  assert.equal(matchesInvoice(row, searchQuery('03.669.753/0001-82')), true);
  assert.equal(matchesInvoice(row, searchQuery('03669753000182')), true);
});
