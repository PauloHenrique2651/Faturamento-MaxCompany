export function validOrderStoragePath(path) {
  return /^orders\/catalog\/\d{4}-\d{2}\/[a-f0-9]{24}\.json$/.test(String(path || ''));
}
export async function ordersRoute({ url, user, reports, download }) {
  if (!user || user.role === 'fiscal') return { status: 403, body: { error: 'Acesso restrito.' } };
  const start = url.searchParams.get('inicio'),
    end = url.searchParams.get('fim');
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(start || '') ||
    !/^\d{4}-\d{2}-\d{2}$/.test(end || '') ||
    start > end
  )
    return { status: 400, body: { error: 'Período inválido.' } };
  const report = Object.values(reports || {}).find(
    (r) => r.startDate === start && r.endDate === end
  );
  if (!report?.orderCatalog || !validOrderStoragePath(report.orderCatalog.path))
    return {
      status: 409,
      body: {
        error:
          'Os pedidos deste período ainda não foram revisados pelo coletor. Selecione o mês completo ou o mês atual.'
      }
    };
  const response = await download(report.orderCatalog.path);
  if (!response.ok)
    return { status: 503, body: { error: 'Lista de pedidos temporariamente indisponível.' } };
  const orders = await response.json();
  const id = url.searchParams.get('pedido');
  if (id) {
    const order = orders.find((row) => row.id === id);
    if (!order) return { status: 404, body: { error: 'Pedido não encontrado neste período.' } };
    const { renderOrderPdf } = await import('./order-pdf.js');
    const content = await renderOrderPdf(order, { inicio: start, fim: end }, report.checkedAt);
    return {
      status: 200,
      content,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="pedido-${order.companyCode}-${order.number}-${String(order.series).replace(/[^A-Za-z0-9_-]/g, '')}.pdf"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff'
      }
    };
  }
  return {
    status: 200,
    body: { orders, checkedAt: report.checkedAt, period: { inicio: start, fim: end } }
  };
}
