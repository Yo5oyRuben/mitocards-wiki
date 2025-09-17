import {
  getSessionFromCookie, getUserByHandle, verifyPassword, hashPassword,
  putUser, sendBad, sendJson, readBody  // <-- importa readBody aquí
} from '../_lib.js';

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendBad(res, 'POST only', 405);

  const sess = await getSessionFromCookie(req);
  if (!sess) return sendBad(res, 'no autenticado', 401);

  const body = await readBody(req);           // <-- úsalo aquí
  const newPwd = String(body?.newPassword ?? '');
  if (!newPwd) return sendBad(res, 'newPassword requerido', 400);

  const u = await getUserByHandle(sess.handle);
  if (!u || u.id !== sess.userId) return sendBad(res, 'usuario no encontrado', 404);

  // Si el usuario ya tenía password, exigir oldPassword correcta
  if (u.hash && u.salt) {
    const old = String(body?.oldPassword ?? '');
    if (!old) return sendBad(res, 'oldPassword requerido', 401);
    if (!verifyPassword(old, u.hash, u.salt)) return sendBad(res, 'contraseña incorrecta', 401);
  }

  const { hash, salt } = hashPassword(newPwd);
  u.hash = hash; u.salt = salt;
  await putUser(u);

  return sendJson(res, { ok: true });
}

