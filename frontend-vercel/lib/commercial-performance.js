import { registeredSalesReturns } from './erp-documents.js';
import { financialSaleValue, confirmedFinancialReturn } from './financial-cfops.js';

const round = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const atNoon = (day) => new Date(`${day}T12:00:00Z`);
const iso = (date) => date.toISOString().slice(0, 10);

export function nextDay(day) {
  const date = atNoon(day);
  date.setUTCDate(date.getUTCDate() + 1);
  return iso(date);
}

export function endOfMonth(day) {
  return iso(new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 0, 12)));
}

function endOfQuarter(day) {
  const month = Number(day.slice(5, 7));
  const lastMonth = Math.ceil(month / 3) * 3;
  return endOfMonth(`${day.slice(0, 4)}-${String(lastMonth).padStart(2, '0')}-01`);
}

export function businessDays(start, end) {
  if (end < start) return 0;
  let count = 0;
  for (let day = start; day <= end; day = nextDay(day)) {
    const weekday = atNoon(day).getUTCDay();
    if (weekday !== 0 && weekday !== 6) count++;
  }
  return count;
}

export function displayPeriod(period, today) {
  const weekday = (atNoon(today).getUTCDay() + 6) % 7;
  const weekStart = iso(new Date(atNoon(today).getTime() - weekday * 86400000));
  const quarterMonth = Math.floor((Number(today.slice(5, 7)) - 1) / 3) * 3 + 1;
  const options = {
    today: { start: today, end: today, horizon: today, label: 'Hoje' },
    week: {
      start: weekStart,
      end: today,
      horizon: iso(new Date(atNoon(weekStart).getTime() + 6 * 86400000)),
      label: 'Semana atual'
    },
    month: {
      start: `${today.slice(0, 7)}-01`,
      end: today,
      horizon: endOfMonth(today),
      label: 'Mês atual'
    },
    quarter: {
      start: `${today.slice(0, 4)}-${String(quarterMonth).padStart(2, '0')}-01`,
      end: today,
      horizon: endOfQuarter(today),
      label: 'Trimestre atual'
    },
    year: {
      start: `${today.slice(0, 4)}-01-01`,
      end: today,
      horizon: `${today.slice(0, 4)}-12-31`,
      label: 'Ano atual'
    }
  };
  return options[period] || options.month;
}

function covers(target, day) {
  const start = target.period_start;
  if (day < start) return false;
  if (target.period_kind === 'month') return day <= endOfMonth(start);
  if (target.period_kind === 'quarter') return day <= endOfQuarter(start);
  return day <= `${start.slice(0, 4)}-12-31`;
}

function duration(target) {
  if (target.period_kind === 'month')
    return businessDays(target.period_start, endOfMonth(target.period_start));
  if (target.period_kind === 'quarter')
    return businessDays(target.period_start, endOfQuarter(target.period_start));
  return businessDays(target.period_start, `${target.period_start.slice(0, 4)}-12-31`);
}

export function proratedTarget(targets, scopeType, scopeKey, start, end) {
  if (end < start) return null;
  const rows = targets.filter((row) => row.scope_type === scopeType && row.scope_key === scopeKey);
  const precedence = { month: 3, quarter: 2, year: 1 };
  let amount = 0;
  let days = 0;
  for (let day = start; day <= end; day = nextDay(day)) {
    const weekday = atNoon(day).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    const target = rows
      .filter((row) => covers(row, day))
      .sort((a, b) => precedence[b.period_kind] - precedence[a.period_kind])[0];
    if (!target) return null;
    amount += Number(target.amount) / duration(target);
    days++;
  }
  return days ? round(amount) : 0;
}

export function commercialPerformance(outgoing, incoming, targets, period, companyId = null) {
  const docs = outgoing?.documents || [];
  const sales = docs.filter((row) => financialSaleValue(row) > 0);
  const erpReturns = registeredSalesReturns(docs);
  const returns = erpReturns.available
    ? erpReturns.documents
    : (incoming?.returns?.documents || []).filter((row) => confirmedFinancialReturn(row) > 0);
  const returnValue = (row) =>
    erpReturns.available ? Number(row.erp.returnedValue || 0) : confirmedFinancialReturn(row);
  const gross = round(sales.reduce((sum, row) => sum + financialSaleValue(row), 0));
  const returned = round(returns.reduce((sum, row) => sum + returnValue(row), 0));
  const net = round(gross - returned);
  const scopeType = companyId ? 'company' : 'group';
  const scopeKey = companyId ? String(companyId) : 'group';
  const scopedTarget = (end) => {
    const direct = proratedTarget(targets, scopeType, scopeKey, period.start, end);
    if (direct !== null || companyId) return direct;
    const parts = [1, 2, 3, 4].map((id) =>
      proratedTarget(targets, 'company', String(id), period.start, end)
    );
    return parts.every((value) => value !== null)
      ? round(parts.reduce((sum, value) => sum + value, 0))
      : null;
  };
  const target = scopedTarget(period.horizon);
  const byDay = new Map();
  for (let day = period.start; day <= period.end; day = nextDay(day))
    byDay.set(day, { date: day, sales: 0, returns: 0, net: 0, cumulative: 0, target: null });
  for (const row of sales) {
    const day = byDay.get(row.date);
    if (day) day.sales += financialSaleValue(row);
  }
  for (const row of returns) {
    const day = byDay.get(row.date);
    if (day) day.returns += returnValue(row);
  }
  let cumulative = 0;
  const daily = [...byDay.values()].map((day) => {
    day.net = round(day.sales - day.returns);
    cumulative = round(cumulative + day.net);
    day.cumulative = cumulative;
    day.target = scopedTarget(day.date);
    return day;
  });
  const elapsed = businessDays(period.start, period.end);
  const remaining = businessDays(nextDay(period.end), period.horizon);
  const recent = daily.filter((row) => businessDays(row.date, row.date)).slice(-5);
  const recentAverage = recent.length
    ? recent.reduce((sum, row) => sum + row.net, 0) / recent.length
    : 0;
  const average = elapsed ? net / elapsed : 0;
  const projection =
    elapsed >= 3 ? round(net + remaining * (recentAverage * 0.7 + average * 0.3)) : null;
  const bySeller = new Map();
  const saleByKey = new Map(sales.map((row) => [row.key, row]));
  for (const row of sales) {
    const name = String(row.seller || '').trim();
    if (!name) continue;
    const key = name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase();
    const seller = bySeller.get(key) || { key, name, sales: 0, returns: 0, count: 0 };
    seller.sales += financialSaleValue(row);
    seller.count++;
    bySeller.set(key, seller);
  }
  for (const row of returns) {
    const original = erpReturns.available ? row : saleByKey.get(row.saleReference?.key);
    if (!original?.seller) continue;
    const key = original.seller
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase();
    const seller = bySeller.get(key);
    if (seller) seller.returns += returnValue(row);
  }
  const sellers = [...bySeller.values()]
    .map((row) => ({
      ...row,
      sales: round(row.sales),
      returns: round(row.returns),
      net: round(row.sales - row.returns),
      target: proratedTarget(targets, 'seller', row.key, period.start, period.horizon)
    }))
    .sort((a, b) => b.net - a.net);
  return {
    gross,
    returned,
    net,
    target,
    gap: target === null ? null : round(Math.max(0, target - net)),
    progress: target ? round((net / target) * 100) : null,
    elapsed,
    remaining,
    average: round(average),
    requiredDaily:
      target === null || !remaining ? null : round(Math.max(0, target - net) / remaining),
    projection,
    today: daily.at(-1)?.net || 0,
    daily,
    sellers,
    topCustomers: (outgoing?.customerGroups || []).slice(0, 5)
  };
}
