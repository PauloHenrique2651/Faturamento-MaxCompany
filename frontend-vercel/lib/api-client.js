const apiBaseUrl = String(window.__FALCO_API__?.baseUrl || '').replace(/\/$/, '');

export async function fetchJson(path) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    credentials: apiBaseUrl ? 'omit' : 'same-origin',
    headers: { Accept: 'application/json' }
  });

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('A API Falco retornou uma resposta inválida.');
  }

  if (!response.ok) {
    throw new Error(data.error || 'Falha na consulta');
  }

  return data;
}
