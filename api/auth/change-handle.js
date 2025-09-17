import {
  getSessionFromCookie, getUserByHandle, putUser, verifyPassword,
  redis, USERS_PREFIX, USER_DECKS, DECKS_PREFIX,
  createSession, deleteSession, setCookieNode, sendBad, sendJson, SESSION_COOKIE
} from '../_lib.js';

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendBad(res, 'POST only', 405);

  const sess = await getSessionFromCookie(req);
  if (!sess) return sendBad(res, 'no autenticado', 401);

  const body = await readBody(req);
  const newHandle = String(body?.newHandle ?? '').trim().toLowerCase();
  if (!newHandle) return sendBad(res, 'newHandle requerido', 400);
  if (newHandle === sess.handle) return sendBad(res, 'nuevo handle igual', 400);

  const u = await getUserByHandle(sess.handle);
  if (!u || u.id !== sess.userId) return sendBad(res, 'usuario no encontrado', 404);

  // Si tenía password, req. password para cambiar handle
  if (u.hash && u.salt) {
    const pwd = String(body?.password ?? '');
    if (!pwd) return sendBad(res, 'contraseña requerida', 401);
    if (!verifyPassword(pwd, u.hash, u.salt)) return sendBad(res, 'contraseña incorrecta', 401);
  }

  // Handle libre
  if (await getUserByHandle(newHandle)) return sendBad(res, 'handle ya existe', 409);

  // Mover documento user:{handle} -> user:{newHandle}
  await redis.del(USERS_PREFIX + u.handle.toLowerCase());
  u.handle = newHandle;
  await putUser(u);

  // Actualizar ownerHandle en mis mazos
  const ids = (await redis.smembers(USER_DECKS(u.id))) || [];
  for (const id of ids) {
    const deck = await redis.get(DECKS_PREFIX + id);
    if (deck) {
      deck.ownerHandle = newHandle;
      await redis.set(DECKS_PREFIX + id, deck);
    }
  }

  // Refrescar la sesión actual con el nuevo handle
  await deleteSession(sess.token);
  const s2 = await createSession(u);
  setCookieNode(res, SESSION_COOKIE, s2.token, { maxAge: 60 * 60 * 24 * 30 });

  return sendJson(res, { ok: true, user: { id: u.id, handle: u.handle } });
}

async function readBody(req) {
  // 1) Si ya viene parseado por el runtime/middleware
  if (req.body && typeof req.body === 'object') return req.body;

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
