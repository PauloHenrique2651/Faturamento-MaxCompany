import sql from 'mssql';

let poolPromise;

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Variável obrigatória ausente: ${name}`);
  return value;
}

function asBoolean(value, fallback) {
  if (value == null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

export function databaseConfig() {
  return {
    server: required('MASERP_SQL_SERVER'),
    database: process.env.MASERP_SQL_DATABASE || 'MASERP',
    user: required('MASERP_SQL_USER'),
    password: required('MASERP_SQL_PASSWORD'),
    port: Number(process.env.MASERP_SQL_PORT || 1433),
    connectionTimeout: 8_000,
    requestTimeout: 30_000,
    pool: { min: 0, max: 8, idleTimeoutMillis: 30_000 },
    options: {
      encrypt: asBoolean(process.env.MASERP_SQL_ENCRYPT, false),
      trustServerCertificate: asBoolean(process.env.MASERP_SQL_TRUST_CERT, true),
      appName: 'CRM ERP Falco',
      enableArithAbort: true,
      readOnlyIntent: true
    }
  };
}

export async function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(databaseConfig()).connect().catch((error) => {
      poolPromise = undefined;
      throw error;
    });
  }
  return poolPromise;
}

export async function runQuery(queryText, parameters = {}) {
  const normalized = String(queryText)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--.*$/gm, ' ');
  const forbidden = normalized.match(
    /\b(INSERT|UPDATE|DELETE|MERGE|ALTER|DROP|CREATE|TRUNCATE|EXEC(?:UTE)?|GRANT|DENY|REVOKE)\b/i
  );
  if (forbidden) {
    throw new Error(
      `Operação SQL bloqueada pelo modo somente leitura: ${forbidden[1].toUpperCase()}`
    );
  }
  const pool = await getPool();
  const request = pool.request();
  for (const [name, definition] of Object.entries(parameters)) {
    request.input(name, definition.type, definition.value);
  }
  const result = await request.query(queryText);
  return result.recordsets;
}

export { sql };
