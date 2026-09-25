import { access, readFile, readdir } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const publicRoot = resolve(root, 'public');
const vercelRoot = resolve(root, 'frontend-vercel');

const reservedPublicDirectories = ['api'];

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = resolve(directory, entry.name);
      return entry.isDirectory() ? listFiles(absolutePath) : [absolutePath];
    })
  );
  return nested.flat();
}

async function requireFile(relativePath) {
  try {
    await access(resolve(root, relativePath));
  } catch {
    throw new Error(`Arquivo obrigatório ausente: ${relativePath}`);
  }
}

for (const relativePath of [
  '.env.example',
  '.prettierignore',
  '.prettierrc.json',
  'README.md',
  'docs/ESPECIFICACAO-VIEWS-FALCO.md',
  'docs/Especificacao Views Falco CRM MaxCompany.docx',
  'docs/PUBLICACAO-FRONTEND.md',
  'sql/02-views-falco-modelo.sql',
  'sql/03-validar-views-falco.sql',
  'server/db.js',
  'server/intelligence.js',
  'server/supabase-sync.js',
  'server/queries.js',
  'server/server.js',
  'supabase/001_fiscal_documents.sql'
]) {
  await requireFile(relativePath);
}

for (const directory of reservedPublicDirectories) {
  try {
    await access(resolve(publicRoot, directory));
    throw new Error(
      `Diretório público reservado: public/${directory}. Use outro nome para não colidir com as rotas do backend.`
    );
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

const publicFiles = await listFiles(publicRoot);
for (const publicPath of publicFiles) {
  const frontendRelativePath = relative(publicRoot, publicPath);
  const vercelPath = resolve(vercelRoot, frontendRelativePath);
  await access(vercelPath);

  const [local, vercel] = await Promise.all([readFile(publicPath), readFile(vercelPath)]);
  if (!local.equals(vercel)) {
    throw new Error(
      `Frontend divergente: public/${frontendRelativePath} e frontend-vercel/${frontendRelativePath}`
    );
  }
}

const publicTextFiles = publicFiles.filter((path) => /\.(css|html|js|json|svg)$/i.test(path));
const publicSource = await Promise.all(publicTextFiles.map((path) => readFile(path, 'utf8')));
const publicText = publicSource.join('\n');
const secretPattern =
  /(MASERP_SQL_PASSWORD\s*[=:]\s*[^\s"']+|password\s*[=:]\s*["'][^"']{4,}|apikey\s*[=:]\s*["'][^"']{8,})/i;
if (secretPattern.test(publicText)) {
  throw new Error('Possível segredo encontrado no frontend público. Remova-o antes de publicar.');
}

console.log('Estrutura do CRM validada: frontend sincronizado e sem segredo aparente.');
