import {
  createSession,
  getUserByHandle,
  isValidPassword,
  normalizeHandle,
  readBody,
  sendBad,
  sendJson,
  SESSION_COOKIE,
  setCookieNode,
  toClientUser,
  verifyPassword,
} from "../_lib.js";

export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return sendBad(res, "POST only", 405);

    let body = {};
    try {
      body = await readBody(req);
    } catch {
      return sendBad(res, "invalid json", 400);
    }

    const handle = normalizeHandle(body.handle ?? "");
    const password = String(body.password ?? "");

    if (!handle) return sendBad(res, "handle requerido", 400);
    if (!isValidPassword(password)) return sendBad(res, "password requerida", 400);

    const user = await getUserByHandle(handle);
    if (!user) return sendBad(res, "usuario no existe", 404);
    if (!user.hash || !user.salt) return sendBad(res, "usuario sin password", 401);

    if (!verifyPassword(password, user.hash, user.salt)) {
      return sendBad(res, "password incorrecta", 401);
    }

    const sess = await createSession(user);
    setCookieNode(res, SESSION_COOKIE, sess.token, { maxAge: 60 * 60 * 24 * 30 });

    return sendJson(res, {
      ok: true,
      user: await toClientUser(user),
    });
  } catch (error) {
    console.error("auth/login crash:", error);
    return sendBad(res, "server error", 500);
  }
}