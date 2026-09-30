import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const source = resolve(root, 'public');
const destination = resolve(root, 'frontend-vercel');

async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? filesIn(path) : [path];
    })
  );
  return files.flat();
}

const indexPath = resolve(source, 'index.html');
const index = await readFile(indexPath, 'utf8');
const normalizedIndex = index
  .replace(/(<meta name="crm-build" content=")[^"]*(")/, '$1pending$2')
  .replace(
    /((?:href|src)="\/(?:styles|brand|mostrador)\.css|(?:src)="\/(?:config|app)\.js)\?v=[^"]*/g,
    '$1'
  );
if (!normalizedIndex.includes('<meta name="crm-build" content="pending"'))
  throw new Error('Marcador de versão ausente em public/index.html.');

const hash = createHash('sha256');
hash.update(normalizedIndex);
for (const path of (await filesIn(source)).sort()) {
  const name = relative(source, path).replaceAll('\\', '/');
  if (name === 'index.html' || name === 'version.json') continue;
  hash.update(name);
  hash.update(await readFile(path));
}
const version = hash.digest('hex').slice(0, 16);
const versionedIndex = normalizedIndex
  .replace(
    '<meta name="crm-build" content="pending"',
    `<meta name="crm-build" content="${version}"`
  )
  .replace(
    /((?:href|src)="\/(?:styles|brand|mostrador)\.css|(?:src)="\/(?:config|app)\.js)"/g,
    `$1?v=${version}"`
  );
await writeFile(indexPath, versionedIndex);
await writeFile(resolve(source, 'version.json'), JSON.stringify({ version }, null, 2) + '\n');

await mkdir(destination, { recursive: true });
await cp(source, destination, {
  recursive: true,
  force: true,
  filter: (path) => !path.endsWith('.DS_Store')
});

console.log(`Frontend Vercel sincronizado: versão ${version}.`);
