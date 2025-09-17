// /api/auth/signup.js
import {
  getUserByHandle, putUser, hashPassword, verifyPassword, createSession,
  sendJson, sendBad, setCookieNode, SESSION_COOKIE, randomUUID
} from '../_lib.js';
export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendBad(res, 'POST only', 405);

  let body = {};
  try { body = await readBody(req); } catch { return sendBad(res, 'invalid json', 400); }

  const rawHandle = body.handle ?? body.alias ?? body.username ?? body.user ?? '';
  const h = String(rawHandle).trim().toLowerCase();
  const p = String(body.password ?? '');

  if (!h) return sendBad(res, 'handle requerido', 400);

  // ¿Ya existe? -> comportarse como LOGIN
  const existing = await getUserByHandle(h);
  if (existing) {
    if (existing.hash && existing.salt) {
      if (!p) return sendBad(res, 'contraseña requerida', 401);
      if (!verifyPassword(p, existing.hash, existing.salt)) {
        return sendBad(res, 'contraseña incorrecta', 401);
      }
    }
    const sess = await createSession(existing);
    setCookieNode(res, SESSION_COOKIE, sess.token, { maxAge: 60 * 60 * 24 * 30 });
    return sendJson(res, { ok: true, user: { id: existing.id, handle: existing.handle } }, 200);
  }

  // Si no existe -> crear y loguear
  const user = { id: randomUUID(), handle: h };
  if (p) {
    const { hash, salt } = hashPassword(p);
    user.hash = hash; user.salt = salt;
  }
  await putUser(user);

  const sess = await createSession(user);
  setCookieNode(res, SESSION_COOKIE, sess.token, { maxAge: 60 * 60 * 24 * 30 });
  sendJson(res, { ok: true, user: { id: user.id, handle: user.handle } }, 200);
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




