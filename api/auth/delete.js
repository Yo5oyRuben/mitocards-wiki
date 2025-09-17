import {
  getSessionFromCookie, getUserByHandle, verifyPassword,
  redis, USERS_PREFIX, USER_DECKS, USER_DECKS_PUBLIC, USER_DECKS_PRIVATE,
  DECKS_PREFIX, PUBLIC_DECKS,
  deleteSession, clearCookieNode, sendBad, sendJson, SESSION_COOKIE
} from '../_lib.js';

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendBad(res, 'POST only', 405);

  const sess = await getSessionFromCookie(req);
  if (!sess) return sendBad(res, 'no autenticado', 401);

  const body = await readBody(req);
  const confirm = ['1','true',true,1].includes(body?.confirm);
  if (!confirm) return sendBad(res, 'confirm requerido', 400);

  const u = await getUserByHandle(sess.handle);
  if (!u || u.id !== sess.userId) return sendBad(res, 'usuario no encontrado', 404);

  // Si tenía password, pídela para confirmar
  if (u.hash && u.salt) {
    const pwd = String(body?.password ?? '');
    if (!pwd) return sendBad(res, 'contraseña requerida', 401);
    if (!verifyPassword(pwd, u.hash, u.salt)) return sendBad(res, 'contraseña incorrecta', 401);
  }

  // Borrar todos mis mazos e índices
  const ids = (await redis.smembers(USER_DECKS(u.id))) || [];
  for (const id of ids) {
    await redis.del(DECKS_PREFIX + id);
    await redis.srem(PUBLIC_DECKS, id);
    await redis.srem(USER_DECKS(u.id), id);
    await redis.srem(USER_DECKS_PUBLIC(u.id), id);
    await redis.srem(USER_DECKS_PRIVATE(u.id), id);
  }
  await redis.del(USER_DECKS(u.id));
  await redis.del(USER_DECKS_PUBLIC(u.id));
  await redis.del(USER_DECKS_PRIVATE(u.id));

  // Borrar usuario
  await redis.del(USERS_PREFIX + u.handle.toLowerCase());

  // Cerrar sesión actual
  await deleteSession(sess.token);
  clearCookieNode(res, SESSION_COOKIE);

  return sendJson(res, { ok: true, deletedDecks: ids.length });
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  const txt = Buffer.concat(chunks).toString('utf8');
  if (!txt) return {};
  try { return JSON.parse(txt); } catch {}
  try { return Object.fromEntries(new URLSearchParams(txt)); } catch {}
  return {};
}
