// /api/auth/me
import { getSessionFromCookie, sendJson } from '../_lib.js';
export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  const sess = await getSessionFromCookie(req);
  const user = sess ? { id: sess.userId, handle: sess.handle } : null;
  sendJson(res, { user }, 200, {
  'Cache-Control': 'no-store, private',
  'Vary': 'Cookie',
  'Pragma': 'no-cache' // por si acaso
});
}
