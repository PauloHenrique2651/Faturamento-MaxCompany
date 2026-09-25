export const $ = (selector) => document.querySelector(selector);

export const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[character]
  );

export const formatMoney = (value) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(Number(value) || 0);

export const formatNumber = (value) =>
  new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(Number(value) || 0);

export const formatCompactNumber = (value) =>
  new Intl.NumberFormat('pt-BR', {
    notation: 'compact',
    maximumFractionDigits: 1
  }).format(Number(value) || 0);

export const formatDate = (value) =>
  value
    ? new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit',
        month: 'short'
      }).format(new Date(`${String(value).slice(0, 10)}T12:00:00`))
    : '—';

export const todayInBrazil = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

export const addDays = (date, days) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
