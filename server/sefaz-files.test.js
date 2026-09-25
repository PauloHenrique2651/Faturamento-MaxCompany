import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSefazDocument } from './sefaz-files.js';

const key = '35260900000000000000550010000000011000000010';
const cnpj = '12345678000190';

test('interpreta resumo de NF-e recebida sem exigir XML completo', () => {
  const xml = `<resNFe><chNFe>${key}</chNFe><CNPJ>98765432000100</CNPJ><xNome>Fornecedor Exemplo</xNome><dhEmi>2026-09-24T12:00:00-03:00</dhEmi><vNF>129.90</vNF><cSitNFe>1</cSitNFe></resNFe>`;
  const result = parseSefazDocument(xml, cnpj);
  assert.equal(result.kind, 'invoice');
  assert.equal(result.key, key);
  assert.equal(result.amount, 129.9);
  assert.equal(result.number, '1');
  assert.equal(result.series, '1');
  assert.equal(result.full, false);
});

test('aceita XML integral somente para a empresa destinatária', () => {
  const xml = `<nfeProc><NFe><infNFe><ide><dhEmi>2026-09-24T12:00:00-03:00</dhEmi></ide><emit><CNPJ>98765432000100</CNPJ><xNome>Fornecedor Exemplo</xNome></emit><dest><CNPJ>${cnpj}</CNPJ></dest><total><ICMSTot><vNF>129.90</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>${key}</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>`;
  assert.equal(parseSefazDocument(xml, cnpj)?.full, true);
  assert.equal(parseSefazDocument(xml, '00000000000000'), null);
});

test('reconhece somente cancelamento autorizado', () => {
  const event = (status) =>
    `<resEvento><tpEvento>110111</tpEvento><chNFe>${key}</chNFe><cStat>${status}</cStat></resEvento>`;
  assert.deepEqual(parseSefazDocument(event('135'), cnpj), { kind: 'cancel', key });
  assert.equal(parseSefazDocument(event('128'), cnpj), null);
});
