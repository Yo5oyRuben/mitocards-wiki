import {
  getUserByHandle, verifyPassword, createSession,
  sendJson, sendBad, setCookieNode, SESSION_COOKIE
} from '../_lib.js';
export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendBad(res, 'POST only', 405);

  let body = {};
  try { body = await parseJson(req); } catch { return sendBad(res, 'invalid json', 400); }
  const h = String(body.handle || '').trim().toLowerCase();
  const p = String(body.password ?? '');

  const u = await getUserByHandle(h);
  if (!u) return sendBad(res, 'usuario no existe', 404);

  if (u.hash && u.salt) {
    if (!p) return sendBad(res, 'contraseña requerida', 401);
    if (!verifyPassword(p, u.hash, u.salt)) return sendBad(res, 'contraseña incorrecta', 401);
  }

  const sess = await createSession(u);
  setCookieNode(res, SESSION_COOKIE, sess.token, { maxAge: 60 * 60 * 24 * 30 });
  sendJson(res, { ok: true, user: { id: u.id, handle: u.handle } }, 200);
}

async function parseJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const txt = Buffer.concat(chunks).toString('utf8');
  return txt ? JSON.parse(txt) : {};
}

