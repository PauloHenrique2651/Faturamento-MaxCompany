// Todas as parcelas usam a mesma base do relatório Falco.
// gross legado já excluía despesas; reconstitua as vendas antes das deduções.
export function profitabilityComposition(rows = [], freights = []) {
  const sum = (key) => rows.reduce((total, row) => total + Number(row[key] || 0), 0);
  const base = sum('net'),
    returned = sum('returned'),
    expenses = sum('expenses');
  const cost = sum('cost'),
    falcoProfit = sum('profit');
  const freight = freights.reduce((total, row) => total + Number(row.value || 0), 0);
  const sales = base + returned + expenses;
  const profit = falcoProfit; // Frete de entrada já integra o custo apurado pelo Falco.
  const difference = base - cost - falcoProfit;
  return {
    sales,
    notesSubtotal: base + returned,
    totalWithExpenses: base + expenses,
    returned,
    expenses,
    base,
    cost,
    falcoProfit,
    freight,
    profit,
    netSales: sales - returned,
    margin: sales - returned > 0 ? (profit / (sales - returned)) * 100 : null,
    markup: cost ? (profit / cost) * 100 : null,
    difference,
    reconciled: Math.abs(difference) <= 0.02
  };
}
