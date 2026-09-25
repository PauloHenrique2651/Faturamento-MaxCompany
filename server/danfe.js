import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  removeNSPrefix: true
});
const esc = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
const money = (value) =>
  Number(value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
const list = (value) => (Array.isArray(value) ? value : value ? [value] : []);
const field = (value, fallback = '—') => esc(value || fallback);

function address(person, prefix) {
  const place = person?.[`ender${prefix}`] || {};
  return [
    [place.xLgr, place.nro, place.xCpl].filter(Boolean).join(', '),
    [place.xBairro, place.xMun, place.UF].filter(Boolean).join(' · '),
    place.CEP ? `CEP ${place.CEP}` : '',
    person?.IE ? `IE ${person.IE}` : ''
  ]
    .filter(Boolean)
    .map(esc)
    .join('<br>');
}

export function renderDanfe(xml) {
  const root = parser.parse(xml).nfeProc;
  const invoice = root?.NFe?.infNFe;
  const protocol = root?.protNFe?.infProt;
  if (!invoice || !protocol)
    throw new Error('O XML completo autorizado da NF-e não está disponível.');
  const ide = invoice.ide || {};
  const emit = invoice.emit || {};
  const dest = invoice.dest || {};
  const total = invoice.total?.ICMSTot || {};
  const transport = invoice.transp || {};
  const carrier = transport.transporta || {};
  const key = String(protocol.chNFe || invoice['@_Id'] || '').replace(/^NFe/, '');
  const products = list(invoice.det)
    .map((detail) => {
      const product = detail.prod || {};
      return `<tr><td>${field(product.cProd)}</td><td>${field(product.xProd)}</td><td>${field(product.NCM)}</td><td>${field(product.CFOP)}</td><td>${field(product.uCom)}</td><td class="num">${money(product.qCom)}</td><td class="num">${money(product.vUnCom)}</td><td class="num">${money(product.vProd)}</td></tr>`;
    })
    .join('');
  const additional = String(invoice.infAdic?.infCpl || '');
  const keyGroups = key.match(/.{1,4}/g)?.join(' ') || key;
  const date = String(ide.dhEmi || ide.dEmi || '').replace('T', ' ');
  const authorization = String(protocol.dhRecbto || '').replace('T', ' ');
  const payment = list(invoice.pag?.detPag)
    .map((item) => `${field(item.tPag)} · R$ ${money(item.vPag)}`)
    .join(' | ');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DANFE ${field(ide.nNF, key)}</title><style>
    *{box-sizing:border-box}body{margin:0;background:#eef1f4;color:#141a20;font:12px Arial,sans-serif}.toolbar{position:sticky;top:0;display:flex;justify-content:center;gap:12px;padding:12px;background:#071526;color:#fff}.toolbar button{border:0;border-radius:5px;padding:10px 18px;background:#2184d1;color:#fff;font-weight:700;cursor:pointer}.page{max-width:1100px;margin:20px auto;padding:16px;background:#fff;box-shadow:0 3px 18px #12203322}.top{display:grid;grid-template-columns:1fr 1.35fr 1fr;gap:8px;align-items:stretch}.box{border:1px solid #59616a;padding:8px;min-height:47px}.label{display:block;margin-bottom:5px;color:#475569;font-size:9px;text-transform:uppercase;font-weight:bold}.issuer{text-align:center}.issuer h1{font-size:20px;margin:3px}.issuer p{margin:4px 0}.danfe{text-align:center}.danfe strong{display:block;font-size:24px}.key{margin-top:8px;font: bold 17px Consolas,monospace;letter-spacing:1px;word-break:break-all;text-align:center}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:0;margin-top:8px}.grid .box{margin:-1px 0 0 -1px}.wide{grid-column:span 2}.full{grid-column:1/-1}.section{margin:12px 0 5px;font-weight:bold;text-transform:uppercase;font-size:11px}.items{width:100%;border-collapse:collapse;font-size:10px}.items th,.items td{border:1px solid #636a72;padding:5px;text-align:left}.items th{background:#e8edf2}.num{text-align:right!important;white-space:nowrap}.totals{display:grid;grid-template-columns:repeat(4,1fr)}.muted{color:#475569}.footer{margin-top:12px;border-top:1px solid #89919a;padding-top:7px}.stamp{text-align:center;color:#53606c;font-size:10px;margin:12px 0}.nowrap{white-space:nowrap}
    @media print{body{background:#fff;font-size:10px}.toolbar{display:none}.page{max-width:none;margin:0;padding:0;box-shadow:none}.box{padding:5px}.items{font-size:8px}.items th,.items td{padding:3px}.section{margin-top:8px}@page{size:A4 portrait;margin:10mm}}
    @media(max-width:650px){.page{margin:0;padding:8px}.top{grid-template-columns:1fr 1fr}.grid{grid-template-columns:repeat(2,1fr)}.wide{grid-column:span 2}.items{font-size:8px}.items th,.items td{padding:3px}}
    </style></head><body><div class="toolbar"><button onclick="window.print()">Imprimir / Salvar como PDF</button><span>Documento auxiliar gerado do XML autorizado</span></div><main class="page"><div class="top"><section class="box issuer"><span class="label">Emitente</span><h1>${field(emit.xNome)}</h1><p>${address(emit, 'Emit')}</p><p>CNPJ ${field(emit.CNPJ || emit.CPF)} · IE ${field(emit.IE)}</p></section><section class="box danfe"><span class="label">Documento auxiliar da NF-e</span><strong>DANFE</strong><p>${ide.tpNF === '0' ? 'ENTRADA' : 'SAÍDA'} · ${ide.tpImp === '2' ? 'DANFE em formulário de segurança' : 'Representação gráfica'}</p><p>${ide.mod === '65' ? 'NFC-e' : 'NF-e'} · Série ${field(ide.serie)} · Nº ${field(ide.nNF)}</p><p>Folha 1</p></section><section class="box"><span class="label">Controle do Fisco</span><p class="muted">Chave de acesso abaixo</p><p>Protocolo: ${field(protocol.nProt)}</p><p>Autorização: ${field(authorization)}</p></section></div><div class="box"><span class="label">Chave de acesso</span><div class="key">${esc(keyGroups)}</div><p class="muted" style="text-align:center">Consulte a autenticidade no portal nacional da NF-e ou no site da SEFAZ autorizadora.</p></div><div class="grid"><div class="box wide"><span class="label">Natureza da operação</span>${field(ide.natOp)}</div><div class="box"><span class="label">Protocolo de autorização</span>${field(protocol.nProt)} · ${field(authorization)}</div><div class="box"><span class="label">Inscrição estadual do emitente</span>${field(emit.IE)}</div><div class="box wide"><span class="label">Destinatário</span><strong>${field(dest.xNome)}</strong><br>${address(dest, 'Dest')}<br>CNPJ/CPF ${field(dest.CNPJ || dest.CPF)} · IE ${field(dest.IE)}</div><div class="box"><span class="label">NF-e</span>${field(ide.nNF)} · Série ${field(ide.serie)}</div><div class="box"><span class="label">Emissão</span>${field(date)}</div><div class="box"><span class="label">Data saída/entrada</span>${field(ide.dhSaiEnt || ide.dSaiEnt)}</div><div class="box"><span class="label">Valor total da NF-e</span><strong>R$ ${money(total.vNF)}</strong></div></div><h2 class="section">Dados dos produtos / serviços</h2><table class="items"><thead><tr><th>Código</th><th>Descrição</th><th>NCM</th><th>CFOP</th><th>UN</th><th class="num">Quantidade</th><th class="num">Valor unitário</th><th class="num">Valor total</th></tr></thead><tbody>${products || '<tr><td colspan="8">Itens não detalhados no XML</td></tr>'}</tbody></table><h2 class="section">Cálculo do imposto</h2><div class="totals">${[
      ['Base ICMS', 'vBC'],
      ['Valor ICMS', 'vICMS'],
      ['Base ICMS ST', 'vBCST'],
      ['Valor ICMS ST', 'vST'],
      ['Valor produtos', 'vProd'],
      ['Frete', 'vFrete'],
      ['Seguro', 'vSeg'],
      ['Desconto', 'vDesc'],
      ['Outras despesas', 'vOutro'],
      ['Valor IPI', 'vIPI'],
      ['Valor PIS', 'vPIS'],
      ['Valor COFINS', 'vCOFINS'],
      ['Valor total da NF-e', 'vNF']
    ]
      .map(
        ([label, prop]) =>
          `<div class="box"><span class="label">${label}</span>R$ ${money(total[prop])}</div>`
      )
      .join(
        ''
      )}</div><h2 class="section">Transportador / volumes</h2><div class="grid"><div class="box wide"><span class="label">Transportador</span>${field(carrier.xNome)}</div><div class="box"><span class="label">CNPJ/CPF</span>${field(carrier.CNPJ || carrier.CPF)}</div><div class="box"><span class="label">Frete por conta</span>${field(transport.modFrete)}</div><div class="box wide"><span class="label">Endereço</span>${field(carrier.xEnder)}</div><div class="box"><span class="label">Município / UF</span>${field(carrier.xMun)} / ${field(carrier.UF)}</div><div class="box"><span class="label">Volumes</span>${field(transport.vol?.qVol)}</div></div><h2 class="section">Dados adicionais</h2><div class="box full">${field(additional, 'Sem informações adicionais')}</div>${payment ? `<p class="footer"><strong>Pagamento:</strong> ${esc(payment)}</p>` : ''}<p class="stamp">DANFE para consulta gerado a partir do XML completo armazenado. Em caso de divergência, prevalece o XML autorizado.</p></main></body></html>`;
}
