import {
  getSessionContext,
  hashPassword,
  isValidPassword,
  putUser,
  readBody,
  sendBad,
  sendJson,
} from "../_lib.js";

export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return sendBad(res, "POST only", 405);

    const { user } = await getSessionContext(req);
    if (!user) return sendBad(res, "no autenticado", 401);

    const body = await readBody(req);
    const newPassword = String(body?.newPassword ?? body?.password ?? "");
    if (!isValidPassword(newPassword)) {
      return sendBad(res, "password requerida", 400);
    }

    const { hash, salt } = hashPassword(newPassword);
    user.hash = hash;
    user.salt = salt;
    await putUser(user);

    return sendJson(res, { ok: true });
  } catch (error) {
    console.error("auth/change-password crash:", error);
    return sendBad(res, "server error", 500);
  }
}