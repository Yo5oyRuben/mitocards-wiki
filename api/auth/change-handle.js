import {
  createSession,
  deleteSession,
  DECKS_PREFIX,
  getSessionContext,
  getUserByHandle,
  isValidHandle,
  normalizeHandle,
  putUser,
  readBody,
  redis,
  sendBad,
  sendJson,
  SESSION_COOKIE,
  setCookieNode,
  USER_DECKS,
  USERS_INDEX,
  USERS_PREFIX,
  toClientUser,
} from "../_lib.js";

export const config = { runtime: "nodejs" };

function parseMaybeJson(value) {
  if (value == null) return null;
  if (typeof value === "object") return value;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return null;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return sendBad(res, "POST only", 405);

    const { session, user } = await getSessionContext(req);
    if (!session || !user) return sendBad(res, "no autenticado", 401);

    const body = await readBody(req);
    const newHandle = normalizeHandle(body?.newHandle);
    if (!isValidHandle(newHandle)) {
      return sendBad(res, "newHandle invalido (2-32, a-z, 0-9, _, -, .)", 400);
    }
    if (newHandle === user.handle) return sendBad(res, "nuevo handle igual", 400);

    const already = await getUserByHandle(newHandle);
    if (already) return sendBad(res, "handle ya existe", 409);

    const oldHandle = user.handle;
    await redis.del(USERS_PREFIX + oldHandle);
    await redis.srem(USERS_INDEX, oldHandle);

    user.handle = newHandle;
    const currentDisplay = String(user?.profile?.displayName || "").trim().toLowerCase();
    if (!currentDisplay || currentDisplay === oldHandle) {
      user.profile = {
        ...(user.profile || {}),
        displayName: newHandle,
      };
    }

    const updated = await putUser(user);

    const ids = (await redis.smembers(USER_DECKS(updated.id))) || [];
    for (const id of ids) {
      const deck = parseMaybeJson(await redis.get(DECKS_PREFIX + id));
      if (!deck) continue;
      deck.ownerHandle = newHandle;
      await redis.set(DECKS_PREFIX + id, deck);
    }

    await deleteSession(session.token);
    const nextSession = await createSession(updated);
    setCookieNode(res, SESSION_COOKIE, nextSession.token, { maxAge: 60 * 60 * 24 * 30 });

    return sendJson(res, {
      ok: true,
      user: await toClientUser(updated),
    });
  } catch (error) {
    console.error("auth/change-handle crash:", error);
    return sendBad(res, "server error", 500);
  }
}
