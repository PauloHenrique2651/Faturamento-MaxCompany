import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNfeXml } from './nfe-files.js';

const key = '35260900000000000000550010000000011000000010';
const invoice = (status = '100', type = '1') =>
  `<nfeProc><NFe><infNFe Id="NFe${key}"><ide><tpNF>${type}</tpNF><dhEmi>2026-09-24T15:00:00-03:00</dhEmi></ide><total><ICMSTot><vNF>129.90</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>${key}</chNFe><cStat>${status}</cStat></infProt></protNFe></nfeProc>`;

test('lê valor e data da NF-e de saída autorizada', () => {
  const result = parseNfeXml(invoice(), key, 'invoice', 'MaxPlast');
  assert.equal(result.key, key);
  assert.equal(result.company, 'MaxPlast');
  assert.equal(result.date, '2026-09-24');
  assert.equal(result.amount, 129.9);
  assert.equal(result.authorized, true);
  assert.equal(parseNfeXml(invoice('100', '0'), key, 'invoice', 'MaxPlast'), null);
  assert.equal(parseNfeXml(invoice('101'), key, 'invoice', 'MaxPlast')?.authorized, false);
});

test('rejeita XML cuja chave interna diverge do arquivo', () => {
  const divergent = invoice().replaceAll(key, '35260900000000000000550010000000021000000020');
  assert.equal(parseNfeXml(divergent, key, 'invoice', 'MaxPlast'), null);
});

test('não inclui notas do ambiente de homologação nos totais', () => {
  const homologation = invoice().replace('<tpNF>1</tpNF>', '<tpNF>1</tpNF><tpAmb>2</tpAmb>');
  assert.equal(parseNfeXml(homologation, key, 'invoice', 'MaxPlast'), null);
});

test('aceita somente evento de cancelamento registrado', () => {
  const event = (status) =>
    `<procEventoNFe><retEvento><infEvento><cStat>${status}</cStat></infEvento></retEvento></procEventoNFe>`;
  assert.deepEqual(parseNfeXml(event('135'), key, 'cancel', 'MaxPlast'), {
    kind: 'cancel',
    key
  });
  assert.equal(parseNfeXml(event('128'), key, 'cancel', 'MaxPlast'), null);
});

test('extrai destinatário e itens sem confundir com o valor total da nota', () => {
  const xml = `<nfeProc><NFe><infNFe Id="NFe${key}"><ide><tpNF>1</tpNF><dEmi>2026-09-24</dEmi></ide><dest><CNPJ>12345678000190</CNPJ><xNome>Cliente Exemplo</xNome></dest><det><prod><cProd>A1</cProd><xProd>Produto A</xProd><vProd>100.00</vProd></prod></det><total><ICMSTot><vNF>129.90</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>${key}</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>`;
  const result = parseNfeXml(xml, key, 'invoice', 'MaxPlast');
  assert.deepEqual(result.customer, { id: '12345678000190', name: 'Cliente Exemplo' });
  assert.equal(result.items[0].code, 'A1');
  assert.equal(result.items[0].name, 'Produto A');
  assert.equal(result.items[0].value, 100);
  assert.equal(result.amount, 129.9);
});

test('soma tributos dos itens e registra modalidade e valor do frete', () => {
  const xml = invoice()
    .replace(
      '</infNFe>',
      '<det><prod><cProd>A1</cProd><xProd>Produto A</xProd><vProd>100.00</vProd><NCM>12345678</NCM><CFOP>5102</CFOP><qCom>2</qCom></prod><imposto><ICMS><ICMS00><CST>00</CST><vBC>100.00</vBC><pICMS>18.00</pICMS><vICMS>18.00</vICMS></ICMS00></ICMS><PIS><PISAliq><vPIS>1.65</vPIS></PISAliq></PIS></imposto></det><transp><modFrete>0</modFrete><transporta><xNome>Transportadora</xNome></transporta></transp></infNFe>'
    )
    .replace('<vNF>129.90</vNF>', '<vFrete>12.00</vFrete><vNF>129.90</vNF>');
  const result = parseNfeXml(xml, key, 'invoice', 'MaxPlast');
  assert.equal(result.items[0].taxes.ICMS, 18);
  assert.equal(result.items[0].cst, '00');
  assert.equal(result.items[0].taxBase, 100);
  assert.equal(result.taxes.PIS, 1.65);
  assert.deepEqual(result.freight, {
    code: '0',
    modality: 'CIF',
    value: 12,
    carrier: 'Transportadora',
    carrierCnpj: ''
  });
});

test('lê UF do destinatário e CFOP de cada item', () => {
  const xml = invoice().replace(
    '</infNFe>',
    '<dest><enderDest><UF>RJ</UF></enderDest></dest><det><prod><cProd>A1</cProd><xProd>Produto A</xProd><vProd>100.00</vProd><CFOP>5102</CFOP></prod></det></infNFe>'
  );
  const result = parseNfeXml(xml, key, 'invoice', 'MaxPlast');
  assert.equal(result.uf, 'RJ');
  assert.equal(result.items[0].cfop, '5102');
});

test('lê crédito ICMS do Simples informado ao destinatário', () => {
  const xml = invoice().replace(
    '</infNFe>',
    '<emit><CRT>1</CRT></emit><det><prod><xProd>Produto A</xProd><vProd>100.00</vProd></prod><imposto><ICMS><ICMSSN101><CSOSN>101</CSOSN><vCredICMSSN>2.50</vCredICMSSN></ICMSSN101></ICMS></imposto></det></infNFe>'
  );
  const result = parseNfeXml(xml, key, 'invoice', 'MaxSafety');
  assert.equal(result.taxRegime, '1');
  assert.equal(result.simpleIcmsCredit, 2.5);
});

test('identifica o vendedor somente quando declarado nas informações da nota', () => {
  const xml = invoice().replace(
    '</infNFe>',
    '<infAdic><infCpl>Pedido: 123|(Vendedor: Maria Silva) (N Pedido Cliente: 456)</infCpl></infAdic></infNFe>'
  );
  assert.equal(parseNfeXml(xml, key, 'invoice', 'MaxPlast').seller, 'Maria Silva');
});
