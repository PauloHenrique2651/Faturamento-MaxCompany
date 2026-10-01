import { createHash } from 'node:crypto';
export const orderId = (company, number, series) =>
  `${Number(company)}/${Number(number)}/${String(series).trim()}`;
export async function publishOrderCatalogs(reports, state, upload) {
  state.orderCatalogs ||= {};
  let published = 0;
  for (const report of reports) {
    if (!report.orders) continue;
    const orders = report.orders.map(({ attachments, attachmentRecords, ...order }) => order);
    const content = Buffer.from(JSON.stringify(orders));
    const hash = createHash('sha256').update(content).digest('hex').slice(0, 24);
    const path = `orders/catalog/${report.startDate.slice(0, 7)}/${hash}.json`;
    if (!state.orderCatalogs[path]) {
      try {
        await upload(path, content, 'application/json');
      } catch (error) {
        if (!/409|already exists/.test(String(error.message))) throw error;
      }
      state.orderCatalogs[path] = true;
      published++;
    }
    report.orderCatalog = { path, count: orders.length };
    delete report.orders;
  }
  return { published };
}
