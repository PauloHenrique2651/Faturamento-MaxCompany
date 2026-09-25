const paths = {
  dashboard: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  trend: 'M3 17l6-6 4 4 8-11 M15 4h6v6',
  users:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  box: 'M12 3l9 5v9l-9 5-9-5V8z M3 8l9 5 9-5 M12 13v9 M7 5.8l9 5',
  document: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8 13h8 M8 17h6',
  wallet: 'M3 6a2 2 0 0 1 2-2h14v4 M3 6v13a2 2 0 0 0 2 2h16V8H5a2 2 0 0 1-2-2 M21 12h-5v5h5',
  truck:
    'M1 3h14v13H1z M15 8h4l3 4v4h-7 M8 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0 M20 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0',
  search: 'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  refresh: 'M20 7v5h-5 M4 17v-5h5 M6 5a8 8 0 0 1 14 7 M18 19a8 8 0 0 1-14-7',
  close: 'M6 6l12 12 M6 18L18 6',
  menu: 'M3 6h18 M3 12h18 M3 18h18',
  arrow: 'M5 12h14 M13 6l6 6-6 6',
  target: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0 M12 11v2',
  shield: 'M12 2l9 4v6c0 5-9 10-9 10S3 17 3 12V6z M8 12l3 3 5-6'
};

export const icon = (name) =>
  `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.document}"/></svg>`;
