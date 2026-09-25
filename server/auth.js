import {
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual
} from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const root = join(fileURLToPath(new URL('..', import.meta.url)), 'data', 'auth');
const usersPath = join(root, 'users.json');
const secretPath = join(root, 'secret.key');
const revokedPath = join(root, 'revoked.json');
const sessionSeconds = 7 * 24 * 60 * 60;
let secret;
let users;
let revoked;

async function init() {
  if (users && secret && revoked) return;
  await mkdir(root, { recursive: true });
  try {
    secret = await readFile(secretPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const value = randomBytes(32);
    try {
      await writeFile(secretPath, value, { flag: 'wx' });
      secret = value;
    } catch (writeError) {
      if (writeError.code !== 'EEXIST') throw writeError;
      secret = await readFile(secretPath);
    }
  }
  try {
    users = JSON.parse(await readFile(usersPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    users = [];
  }
  try {
    revoked = new Map(Object.entries(JSON.parse(await readFile(revokedPath, 'utf8'))));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    revoked = new Map();
  }
}

async function persist() {
  const temporary = `${usersPath}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(users, null, 2));
  await rename(temporary, usersPath);
}

const publicUser = (user) => ({ id: user.id, name: user.name, role: user.role });
const normalize = (name) =>
  String(name || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');

export async function listUsers() {
  await init();
  return users.map(publicUser);
}

export async function createUser(name, password, role) {
  await init();
  if (typeof name !== 'string' || name.trim().length < 3 || name.length > 100)
    throw new Error('Informe um nome válido.');
  if (typeof password !== 'string' || password.length < 4 || password.length > 128)
    throw new Error('A senha deve ter de 4 a 128 caracteres.');
  if (!['admin', 'fiscal'].includes(role)) throw new Error('Perfil inválido.');
  if (users.some((user) => normalize(user.name) === normalize(name)))
    throw new Error('Usuário já cadastrado.');
  const salt = randomBytes(16).toString('hex');
  const hash = (await scrypt(password, salt, 64)).toString('hex');
  const user = {
    id: randomBytes(12).toString('hex'),
    name: name.trim(),
    role,
    salt,
    hash,
    version: 1
  };
  users.push(user);
  await persist();
  return publicUser(user);
}

export async function updateUser(id, { role, password }) {
  await init();
  const user = users.find((item) => item.id === id);
  if (!user) throw new Error('Usuário não encontrado.');
  if (role !== undefined) {
    if (!['admin', 'fiscal'].includes(role)) throw new Error('Perfil inválido.');
    if (
      user.role === 'admin' &&
      role !== 'admin' &&
      users.filter((item) => item.role === 'admin').length === 1
    )
      throw new Error('É necessário manter ao menos um administrador.');
    user.role = role;
  }
  if (password !== undefined) {
    if (typeof password !== 'string' || password.length < 4 || password.length > 128)
      throw new Error('A senha deve ter de 4 a 128 caracteres.');
    user.salt = randomBytes(16).toString('hex');
    user.hash = (await scrypt(password, user.salt, 64)).toString('hex');
  }
  user.version++;
  await persist();
  return publicUser(user);
}

export async function deleteUser(id) {
  await init();
  const user = users.find((item) => item.id === id);
  if (!user) throw new Error('Usuário não encontrado.');
  if (user.role === 'admin' && users.filter((item) => item.role === 'admin').length === 1)
    throw new Error('É necessário manter ao menos um administrador.');
  users = users.filter((item) => item.id !== id);
  await persist();
}

export async function login(name, password) {
  await init();
  const user = users.find((item) => normalize(item.name) === normalize(name));
  const expected = user ? Buffer.from(user.hash, 'hex') : randomBytes(64);
  const actual = await scrypt(String(password || ''), user?.salt || 'invalid', 64);
  if (!user || !timingSafeEqual(expected, actual)) throw new Error('Usuário ou senha incorretos.');
  const payload = Buffer.from(
    JSON.stringify({ id: user.id, version: user.version, exp: Date.now() + sessionSeconds * 1000 })
  ).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return { user: publicUser(user), token: `${payload}.${signature}`, maxAge: sessionSeconds };
}

export async function authenticate(req) {
  await init();
  const token = /(?:^|;\s*)crm_session=([^;]+)/.exec(req.headers.cookie || '')?.[1];
  if (!token) return null;
  if (revoked.has(createHash('sha256').update(token).digest('hex'))) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = createHmac('sha256', secret).update(payload).digest();
  let supplied;
  try {
    supplied = Buffer.from(signature, 'base64url');
  } catch {
    return null;
  }
  if (supplied.length !== expected.length || !timingSafeEqual(expected, supplied)) return null;
  let session;
  try {
    session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!session || session.exp <= Date.now()) return null;
  const user = users.find((item) => item.id === session.id && item.version === session.version);
  return user ? publicUser(user) : null;
}

export async function revokeSession(req) {
  await init();
  const token = /(?:^|;\s*)crm_session=([^;]+)/.exec(req.headers.cookie || '')?.[1];
  if (!token) return;
  let expiration = Date.now() + sessionSeconds * 1000;
  try {
    expiration = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString()).exp;
  } catch {
    /* token malformed; session will fail authentication */
  }
  for (const [hash, until] of revoked) if (until <= Date.now()) revoked.delete(hash);
  revoked.set(createHash('sha256').update(token).digest('hex'), expiration);
  await writeFile(revokedPath, JSON.stringify(Object.fromEntries(revoked)));
}

export function sessionCookie(token, maxAge, secure = false) {
  return `crm_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
