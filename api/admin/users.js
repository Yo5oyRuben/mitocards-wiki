import {
  DECKS_PREFIX,
  getAvatarCatalog,
  getUserByHandle,
  hashPassword,
  listUsers,
  normalizeHandle,
  pickAvatar,
  putUser,
  PUBLIC_DECKS,
  readBody,
  redis,
  requireAdmin,
  sendBad,
  sendJson,
  USER_DECKS,
  USER_DECKS_PRIVATE,
  USER_DECKS_PUBLIC,
  USER_ID_HANDLE,
  USERS_INDEX,
  USERS_PREFIX,
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

function cleanHandle(v) {
  return normalizeHandle(v);
}

async function toAdminUser(user) {
  const deckIds = (await redis.smembers(USER_DECKS(user.id))) || [];
  return {
    id: user.id,
    handle: user.handle,
    createdAt: user.createdAt || null,
    hasPassword: Boolean(user.hash && user.salt),
    decks: deckIds.length,
    profile: user.profile || null,
  };
}

async function deleteUserData(user) {
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
  return ids.length;
}

export default async function handler(req, res) {
  try {
    if (!requireAdmin(req, res)) return;

    if (req.method === "GET") {
      const users = await listUsers();
      const out = [];
      for (const user of users) out.push(await toAdminUser(user));
      out.sort((a, b) => a.handle.localeCompare(b.handle));
      return sendJson(res, { users: out, avatars: await getAvatarCatalog() });
    }

    if (req.method !== "POST") return sendBad(res, "GET/POST only", 405);

    const body = await readBody(req);
    const action = String(body?.action ?? "").trim();
    const handle = cleanHandle(body?.handle);
    if (!action || !handle) return sendBad(res, "action y handle requeridos", 400);

    const user = await getUserByHandle(handle);
    if (!user) return sendBad(res, "usuario no encontrado", 404);

    if (action === "resetPassword") {
      const newPassword = String(body?.newPassword ?? "");
      if (!newPassword) return sendBad(res, "newPassword requerido", 400);
      const { hash, salt } = hashPassword(newPassword);
      user.hash = hash;
      user.salt = salt;
      const updated = await putUser(user);
      return sendJson(res, { ok: true, user: await toAdminUser(updated) });
    }

    if (action === "renameHandle") {
      const newHandle = cleanHandle(body?.newHandle);
      if (!newHandle) return sendBad(res, "newHandle requerido", 400);
      if (newHandle === handle) return sendBad(res, "handle sin cambios", 400);
      if (await getUserByHandle(newHandle)) return sendBad(res, "newHandle ya existe", 409);

      await redis.del(USERS_PREFIX + handle);
      await redis.srem(USERS_INDEX, handle);

      user.handle = newHandle;
      const display = String(user?.profile?.displayName || "").trim().toLowerCase();
      if (!display || display === handle) {
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

      return sendJson(res, { ok: true, user: await toAdminUser(updated) });
    }

    if (action === "setAvatar") {
      const avatars = await getAvatarCatalog();
      const avatar = pickAvatar(avatars, body?.avatarId);
      user.profile = {
        ...(user.profile || {}),
        avatarId: avatar.id,
        avatarName: avatar.name,
        avatarUrl: avatar.url,
      };
      const updated = await putUser(user);
      return sendJson(res, { ok: true, user: await toAdminUser(updated) });
    }

    if (action === "deleteUser") {
      const deletedDecks = await deleteUserData(user);
      return sendJson(res, { ok: true, deletedDecks });
    }

    return sendBad(res, "action no soportada", 400);
  } catch (error) {
    console.error("admin/users crash:", error);
    return sendBad(res, "server error", 500);
  }
}