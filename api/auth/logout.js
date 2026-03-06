import {
  clearCookieNode,
  deleteSession,
  getSessionFromCookie,
  sendJson,
  SESSION_COOKIE,
} from "../_lib.js";

export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return sendJson(res, { error: "POST only" }, 405);
    }

    const sess = await getSessionFromCookie(req);
    if (sess) await deleteSession(sess.token);
    clearCookieNode(res, SESSION_COOKIE);
    return sendJson(res, { ok: true });
  } catch (error) {
    console.error("auth/logout crash:", error);
    return sendJson(res, { error: "server error" }, 500);
  }
}