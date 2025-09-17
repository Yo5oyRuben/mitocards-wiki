import { Redis } from '@upstash/redis';
import { randomBytes, scryptSync, timingSafeEqual, randomUUID } from 'crypto';

// Soporta nombres de env de Upstash KV y de KV clásico
const REDIS_URL =
  process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || process.env.REDIS_URL;
const REDIS_TOKEN =
  process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

export const redis = new Redis({ url: REDIS_URL, token: REDIS_TOKEN });

if (!REDIS_URL || !REDIS_TOKEN) {
  console.error('⚠️ Falta UPSTASH/KV en variables (URL/TOKEN). Ejecuta "vercel env pull .env.local" y revisa Storage→Connect Project.');
}

export const json = (data, init = 200) =>
  new Response(JSON.stringify(data), {
    status: typeof init === 'number' ? init : init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(typeof init === 'number' ? {} : init.headers) }
  });

export const bad = (msg, code = 400) => json({ error: msg }, code);
export const PUBLIC_DECKS       = 'decks:public';                    // set de ids públicos (global)
export const USER_DECKS_PUBLIC  = (uid) => `user:${uid}:decks:pub`;  // set de ids públicos del usuario
export const USER_DECKS_PRIVATE = (uid) => `user:${uid}:decks:priv`; // set de ids privados del usuario

export function setCookie(res, name, value, opts = {}) {
  const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (opts.maxAge) parts.push(`Max-Age=${opts.maxAge}`);
  res.headers.append('Set-Cookie', parts.join('; '));
  return res;
}
export function clearCookie(res, name) {
  res.headers.append('Set-Cookie', `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return res;
}

export const SESSION_COOKIE = 'mitocards.sid';
const SESSION_TTL = 60 * 60 * 24 * 30; // 30 días

export const USERS_PREFIX   = 'user:';             // user:{handle} -> User
export const SESSIONS_PREFIX= 'sess:';             // sess:{token} -> Session
export const DECKS_PREFIX   = 'deck:';             // deck:{id}    -> Deck
export const USER_DECKS     = (uid) => `user:${uid}:decks`; // set de ids

export function hashPassword(password, salt) {
  const s = salt || randomBytes(16).toString('hex');
  const key = scryptSync(password, s, 32).toString('hex');
  return { salt: s, hash: key };
}
export function verifyPassword(password, hash, salt) {
  const cand = scryptSync(password, salt, 32);
  const target = Buffer.from(hash, 'hex');
  return cand.length === target.length && timingSafeEqual(cand, target);
}

export async function getUserByHandle(handle) {
  return (await redis.get(USERS_PREFIX + handle.toLowerCase())) ?? null;
}
export async function putUser(u) {
  await redis.set(USERS_PREFIX + u.handle.toLowerCase(), u);
}

export async function createSession(u) {
  const token = randomBytes(24).toString('hex');
  const sess  = { token, userId: u.id, handle: u.handle, createdAt: new Date().toISOString() };
  await redis.set(SESSIONS_PREFIX + token, sess, { ex: SESSION_TTL });
  return sess;
}
export async function deleteSession(token) {
  await redis.del(SESSIONS_PREFIX + token);
}

export async function getSessionFromCookie(req) {
  const cookieHeader = req?.headers?.cookie || '';
  if (!cookieHeader) return null;
  const m = cookieHeader.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  if (!m) return null;
  const token = m[1];
  return (await redis.get(SESSIONS_PREFIX + token)) ?? null;
}


export { randomUUID }; // lo reutilizamos en endpoints

// === helpers de respuesta para runtime node ===
export function sendJson(res, data, status = 200, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(data));
}
export function sendBad(res, msg, status = 400) {
  sendJson(res, { error: msg }, status);
}

// cookies (runtime node)
export function setCookieNode(res, name, value, opts = {}) {
  const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (opts.maxAge) parts.push(`Max-Age=${opts.maxAge}`);
  // En local http no pongas Secure; en prod sí podrías
  res.setHeader('Set-Cookie', parts.join('; '));
}
export function clearCookieNode(res, name) {
  res.setHeader('Set-Cookie', `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// Al final del archivo, exporta un lector robusto del body:
export async function readBody(req) {
  // 1) Si el runtime ya ha parseado algo en req.body…
  if (req.body != null) {
    // a) Objeto plano ya parseado
    if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
    // b) String JSON o x-www-form-urlencoded
    if (typeof req.body === 'string') {
      try { return JSON.parse(req.body); } catch {}
      try { return Object.fromEntries(new URLSearchParams(req.body)); } catch {}
    }
    // c) Buffer
    if (Buffer.isBuffer(req.body)) {
      const txt = req.body.toString('utf8');
      try { return JSON.parse(txt); } catch {}
      try { return Object.fromEntries(new URLSearchParams(txt)); } catch {}
    }
  }

  // 2) Si no, leemos el stream crudo
  const chunks = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  const txt = Buffer.concat(chunks).toString('utf8');
  if (!txt) return {};

  // 3) Parse JSON o x-www-form-urlencoded
  try { return JSON.parse(txt); } catch {}
  try { return Object.fromEntries(new URLSearchParams(txt)); } catch {}
  return {};
}

