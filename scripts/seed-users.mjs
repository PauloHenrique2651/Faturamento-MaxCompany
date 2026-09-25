import { stdin } from 'node:process';
import { createUser, listUsers } from '../server/auth.js';

let input = '';
for await (const chunk of stdin) input += chunk;
const entries = JSON.parse(input);
const existing = new Set((await listUsers()).map((user) => user.name));
for (const entry of entries) {
  if (!existing.has(entry.name)) await createUser(entry.name, entry.password, entry.role);
}
process.stdout.write('Usuários iniciais cadastrados.\n');
