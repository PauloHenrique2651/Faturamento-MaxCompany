// O SQL recebe uma data de calendário, não um instante no fuso do servidor.
// As procedures Falco normalizam a hora internamente ou comparam CAST(... AS DATE).
export function maserpCalendarDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Data MASERP inválida');
  const value = new Date(date + 'T00:00:00Z');
  if (value.toISOString().slice(0, 10) !== date) throw new Error('Data MASERP inválida');
  return value;
}
