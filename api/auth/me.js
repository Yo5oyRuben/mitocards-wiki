import {
  clearCookieNode,
  deleteSession,
  getAvatarCatalog,
  getSessionContext,
  sendJson,
  SESSION_COOKIE,
  toClientUser,
} from "../_lib.js";

export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return sendJson(res, { error: "GET only" }, 405);
    }

    const { session, user } = await getSessionContext(req);
    if (session && !user) {
      await deleteSession(session.token);
      clearCookieNode(res, SESSION_COOKIE);
    }

    return sendJson(
      res,
      {
        user: user ? await toClientUser(user) : null,
        avatars: await getAvatarCatalog(),
      },
      200,
      {
        "Cache-Control": "no-store, private",
        Vary: "Cookie",
        Pragma: "no-cache",
      }
    );
  } catch (error) {
    console.error("auth/me crash:", error);
    return sendJson(res, { error: "server error" }, 500);
  }
}