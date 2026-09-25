import { cp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const source = resolve(root, 'public');
const destination = resolve(root, 'frontend-vercel');

await mkdir(destination, { recursive: true });
await cp(source, destination, {
  recursive: true,
  force: true,
  filter: (path) => !path.endsWith('.DS_Store')
});

console.log('Frontend Vercel sincronizado a partir de public/.');
