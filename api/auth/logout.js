import { getSessionFromCookie, deleteSession, clearCookieNode, sendJson } from '../_lib.js';
export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  const sess = await getSessionFromCookie(req);
  if (sess) await deleteSession(sess.token);
  clearCookieNode(res, 'mitocards.sid');
  sendJson(res, { ok: true });
}
