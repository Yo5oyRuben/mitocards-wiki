import {
  clearCookieNode,
  DECKS_PREFIX,
  deleteSession,
  getSessionContext,
  PUBLIC_DECKS,
  readBody,
  redis,
  sendBad,
  sendJson,
  SESSION_COOKIE,
  USER_DECKS,
  USER_DECKS_PRIVATE,
  USER_DECKS_PUBLIC,
  USER_ID_HANDLE,
  USERS_INDEX,
  USERS_PREFIX,
} from "../_lib.js";

export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return sendBad(res, "POST only", 405);

    const { session, user } = await getSessionContext(req);
    if (!session || !user) return sendBad(res, "no autenticado", 401);

    const body = await readBody(req);
    const confirm = ["1", "true", true, 1].includes(body?.confirm);
    if (!confirm) return sendBad(res, "confirm requerido", 400);

    const ids = (await redis.smembers(USER_DECKS(user.id))) || [];
    for (const id of ids) {
      await redis.del(DECKS_PREFIX + id);
      await redis.srem(PUBLIC_DECKS, id);
      await redis.srem(USER_DECKS(user.id), id);
      await redis.srem(USER_DECKS_PUBLIC(user.id), id);
      await redis.srem(USER_DECKS_PRIVATE(user.id), id);
    }

    await redis.del(USER_DECKS(user.id));
    await redis.del(USER_DECKS_PUBLIC(user.id));
    await redis.del(USER_DECKS_PRIVATE(user.id));
    await redis.del(USERS_PREFIX + user.handle);
    await redis.del(USER_ID_HANDLE(user.id));
    await redis.srem(USERS_INDEX, user.handle);

    await deleteSession(session.token);
    clearCookieNode(res, SESSION_COOKIE);

    return sendJson(res, { ok: true, deletedDecks: ids.length });
  } catch (error) {
    console.error("auth/delete crash:", error);
    return sendBad(res, "server error", 500);
  }
}