import PDFDocument from 'pdfkit';
import { readFileSync } from 'node:fs';
const logo = readFileSync(new URL('./assets/maxcompany.png', import.meta.url));
const money = (v) =>
  'R$ ' +
  Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const quantity = (v) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 });
const text = (v) =>
  String(v ?? '')
    .replace(/[\u0000-\u001f]/g, ' ')
    .trim();
const date = (v) =>
  String(v || '')
    .split('-')
    .reverse()
    .join('/');
export async function renderOrderPdf(order, period, checkedAt) {
  const number = `${String(order.companyCode).padStart(2, '0')}.${String(order.number).padStart(7, '0')}-${text(order.series)}`;
  const doc = new PDFDocument({
    size: 'A4',
    margin: 40,
    bufferPages: true,
    info: {
      Title: `Pedido ${number}`,
      Author: 'Grupo MaxCompany',
      Subject: 'Pedido de venda - MASERP'
    }
  });
  const chunks = [];
  const result = new Promise((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const right = 555,
    navy = '#0e293c',
    muted = '#526477';
  const write = (value, x, y, width, options = {}) =>
    doc
      .font(options.bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(options.size || 10)
      .fillColor(options.color || navy)
      .text(text(value), x, y, { width, ...options });
  function heading(continued = false) {
    doc.image(logo, 40, 35, { fit: [120, 48] });
    write('PEDIDO DE VENDA', 290, 37, 265, { size: 11, bold: true, align: 'right' });
    write(number, 290, 56, 265, { size: 21, bold: true, align: 'right' });
    doc.moveTo(40, 94).lineTo(right, 94).lineWidth(2).strokeColor('#eeaa3c').stroke();
    write(order.companyName || 'Grupo MaxCompany', 40, 108, 515, { bold: true, size: 12 });
    write(
      order.companyCnpj ? 'CNPJ ' + order.companyCnpj : 'Empresa ' + order.companyCode,
      40,
      128,
      515,
      { color: muted }
    );
    if (continued) {
      write('Produtos do pedido - continuação', 40, 150, 515, { bold: true });
      return 176;
    }
    write('CLIENTE', 40, 153, 515, { size: 8, bold: true, color: muted });
    const customer = text(order.customer);
    write(customer, 40, 168, 515, { bold: true, size: 12 });
    let y = 168 + doc.heightOfString(customer, { width: 515 }) + 10;
    write(
      `Código ${order.customerCode}${order.customerCnpj ? ' | CNPJ ' + order.customerCnpj : ''}`,
      40,
      y,
      515,
      { color: muted }
    );
    y += 22;
    write(
      `Data do pedido: ${date(order.date)} | Vendedor: ${order.seller || 'Não informado'}`,
      40,
      y,
      515
    );
    y = doc.y + 20;
    if (order.paymentTerms) {
      write('Condição de pagamento: ' + order.paymentTerms, 40, y, 515);
      y = doc.y + 18;
    }
    return y + 5;
  }
  const columns = [
    { x: 40, w: 52, label: 'Código' },
    { x: 92, w: 220, label: 'Produto' },
    { x: 312, w: 34, label: 'UN' },
    { x: 346, w: 54, label: 'Qtd.' },
    { x: 400, w: 78, label: 'Unitário' },
    { x: 478, w: 77, label: 'Total' }
  ];
  function tableHeader(y) {
    doc.rect(40, y, 515, 24).fill(navy);
    for (const c of columns)
      write(c.label, c.x + 4, y + 7, c.w - 8, {
        size: 8,
        bold: true,
        color: '#ffffff',
        align: c.x >= 346 ? 'right' : 'left'
      });
    return y + 24;
  }
  let y = tableHeader(heading());
  const newPage = () => {
    doc.addPage();
    y = tableHeader(heading(true));
  };
  for (const item of order.items || []) {
    doc.font('Helvetica').fontSize(9);
    const height = Math.max(32, doc.heightOfString(text(item.name), { width: 212 }) + 15);
    if (y + height > 730) newPage();
    const values = [
      item.code,
      item.name,
      item.unit || '-',
      quantity(item.quantity),
      money(item.unitPrice),
      money(item.value)
    ];
    for (let n = 0; n < columns.length; n++) {
      const c = columns[n];
      write(values[n], c.x + 4, y + 8, c.w - 8, { size: 9, align: n >= 3 ? 'right' : 'left' });
    }
    doc
      .moveTo(40, y + height)
      .lineTo(right, y + height)
      .lineWidth(0.4)
      .strokeColor('#d9e2e8')
      .stroke();
    y += height;
  }
  if (y + 155 > 730) newPage();
  y += 20;
  doc.roundedRect(40, y, 515, 73, 8).fill('#eef3f6');
  [
    ['Total dos itens ativos', order.total],
    ['Já faturado', order.billed],
    ['A faturar', order.pending]
  ].forEach(([label, value], i) => {
    write(label, 54 + i * 170, y + 13, 154, { size: 9, color: muted });
    write(money(value), 54 + i * 170, y + 34, 154, { bold: true, size: 15 });
  });
  y += 90;
  const invoices = (order.invoices || []).map((n) => `${n.number}/${n.series}`).join(', ');
  write(
    'Notas vinculadas: ' + (invoices || 'Nenhuma nota válida até a data selecionada.'),
    40,
    y,
    515,
    { size: 9 }
  );
  y = doc.y + 10;
  write(
    `Situação do faturamento até ${date(period.fim)}. Valores dos itens ativos; impostos e fretes não estão incluídos neste total.`,
    40,
    y,
    515,
    { size: 8, color: muted }
  );
  const pages = doc.bufferedPageRange();
  for (let index = pages.start; index < pages.start + pages.count; index++) {
    doc.switchToPage(index);
    doc.moveTo(40, 775).lineTo(right, 775).lineWidth(0.4).strokeColor('#d9e2e8').stroke();
    write(
      'Consulta MASERP | Revisado em ' +
        new Date(checkedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      40,
      785,
      440,
      { size: 7, color: muted, lineBreak: false }
    );
    write(`${index + 1}/${pages.count}`, 495, 785, 60, {
      size: 7,
      color: muted,
      align: 'right',
      lineBreak: false
    });
  }
  doc.end();
  return result;
}
