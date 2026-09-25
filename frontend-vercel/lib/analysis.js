const atNoon = (day) => new Date(`${day}T12:00:00Z`);
const dayString = (date) => date.toISOString().slice(0, 10);
export const moveDay = (day, offset) =>
  dayString(new Date(atNoon(day).getTime() + offset * 86400000));
const countDays = (start, end) =>
  Math.max(0, Math.round((atNoon(end) - atNoon(start)) / 86400000) + 1);
const monthEnd = (day) =>
  dayString(new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 0, 12)));
const weekStart = (day) => moveDay(day, -((atNoon(day).getUTCDay() + 6) % 7));

export function presetDates(preset, today) {
  const monday = weekStart(today);
  const currentMonth = `${today.slice(0, 7)}-01`;
  const previousMonthEnd = moveDay(currentMonth, -1);
  const currentYear = today.slice(0, 4);
  const previousYear = String(Number(currentYear) - 1);
  const dates = {
    today: [today, today],
    yesterday: [moveDay(today, -1), moveDay(today, -1)],
    week: [monday, today],
    'prev-week': [moveDay(monday, -7), moveDay(monday, -1)],
    month: [currentMonth, today],
    'prev-month': [`${previousMonthEnd.slice(0, 7)}-01`, previousMonthEnd],
    year: [`${currentYear}-01-01`, today],
    'prev-year': [`${previousYear}-01-01`, `${previousYear}-12-31`],
    7: [moveDay(today, -6), today],
    30: [moveDay(today, -29), today],
    90: [moveDay(today, -89), today]
  };
  return dates[preset] || null;
}

export function matchingPreset(start, end, today) {
  for (const key of [
    'today',
    'yesterday',
    'week',
    'prev-week',
    'month',
    'prev-month',
    'year',
    'prev-year',
    '7',
    '30',
    '90'
  ]) {
    const dates = presetDates(key, today);
    if (dates[0] === start && dates[1] === end) return key;
  }
  return 'custom';
}

export function periodAverages(data, today) {
  const start = data.period.inicio;
  const end = data.period.fim < today ? data.period.fim : today;
  const rows = data.daily.filter((row) => row.date >= start && row.date <= end);
  const elapsed = end < start ? 0 : countDays(start, end);
  const business = rows.filter((row) => ![0, 6].includes(atNoon(row.date).getUTCDay())).length;
  const selling = rows.filter((row) => row.count > 0).length;
  return {
    elapsed,
    business,
    selling,
    daily: elapsed ? data.value / elapsed : 0,
    businessDaily: business ? data.value / business : 0,
    sellingDaily: selling ? data.value / selling : 0,
    weekly: elapsed ? (data.value / elapsed) * 7 : 0,
    monthly: elapsed ? (data.value / elapsed) * 30.4375 : 0
  };
}

export function monthForecast(data, today) {
  const start = `${today.slice(0, 7)}-01`;
  if (data.period.inicio !== start || data.period.fim < today) return null;
  const elapsed = countDays(start, today);
  if (elapsed < 3) return null;
  const remaining = countDays(moveDay(today, 1), monthEnd(today));
  const daily = data.value / elapsed;
  return {
    actual: data.value,
    projected: Math.round((data.value + remaining * daily) * 100) / 100,
    conservative: Math.round((data.value + remaining * daily * 0.9) * 100) / 100,
    optimistic: Math.round((data.value + remaining * daily * 1.1) * 100) / 100,
    elapsed,
    remaining,
    formula:
      'Valor das NF-e emitidas no mês + dias restantes × média por dia corrido; cenários ±10% sobre a parcela futura.'
  };
}

export function previousMonthAligned(today) {
  const first = `${today.slice(0, 7)}-01`;
  const previousEnd = moveDay(first, -1);
  const previousFirst = `${previousEnd.slice(0, 7)}-01`;
  const end = moveDay(
    previousFirst,
    Math.min(Number(today.slice(8)), Number(previousEnd.slice(8))) - 1
  );
  return { inicio: previousFirst, fim: end };
}
