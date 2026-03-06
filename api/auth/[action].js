import {
  clearCookieNode,
  createSession,
  DECKS_PREFIX,
  deleteSession,
  getAvatarCatalog,
  getSessionContext,
  getSessionFromCookie,
  getUserByHandle,
  hashPassword,
  isValidHandle,
  isValidPassword,
  normalizeHandle,
  pickAvatar,
  PUBLIC_DECKS,
  putUser,
  randomUUID,
  readBody,
  redis,
  searchHandles,
  sendBad,
  sendJson,
  SESSION_COOKIE,
  setCookieNode,
  toClientUser,
  USER_DECKS,
  USER_DECKS_PRIVATE,
  USER_DECKS_PUBLIC,
  USER_ID_HANDLE,
  USERS_INDEX,
  USERS_PREFIX,
  verifyPassword,
} from "../_lib.js";

export const config = { runtime: "nodejs" };

const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

function getAction(req) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  return String(url.pathname.split("/").pop() || "").trim().toLowerCase();
}

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

async function actionLogin(req, res) {
  if (req.method !== "POST") return sendBad(res, "POST only", 405);

  const body = await readBody(req);
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
  setCookieNode(res, SESSION_COOKIE, sess.token, { maxAge: SESSION_MAX_AGE });
  return sendJson(res, { ok: true, user: await toClientUser(user) });
}

async function actionSignup(req, res) {
  if (req.method !== "POST") return sendBad(res, "POST only", 405);

  const body = await readBody(req);
  const handle = normalizeHandle(body.handle ?? body.alias ?? body.username ?? body.user ?? "");
  const password = String(body.password ?? "");
  const avatarId = String(body.avatarId ?? "");

  if (!isValidHandle(handle)) return sendBad(res, "handle invalido (2-32, a-z, 0-9, _, -, .)", 400);
  if (!isValidPassword(password)) return sendBad(res, "password requerida", 400);

  const existing = await getUserByHandle(handle);
  if (existing) return sendBad(res, "handle ya existe", 409);

  const avatars = await getAvatarCatalog();
  const chosenAvatar = pickAvatar(avatars, avatarId);
  const { hash, salt } = hashPassword(password);

  const user = await putUser({
    id: randomUUID(),
    handle,
    createdAt: new Date().toISOString(),
    hash,
    salt,
    profile: {
      avatarId: chosenAvatar.id,
      avatarName: chosenAvatar.name,
      avatarUrl: chosenAvatar.url,
      displayName: handle,
      bio: "",
      extras: {},
    },
  });

  const sess = await createSession(user);
  setCookieNode(res, SESSION_COOKIE, sess.token, { maxAge: SESSION_MAX_AGE });
  return sendJson(res, { ok: true, user: await toClientUser(user) }, 201);
}

async function actionMe(req, res) {
  if (req.method !== "GET") return sendJson(res, { error: "GET only" }, 405);

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
}

async function actionLogout(req, res) {
  if (req.method !== "POST") return sendJson(res, { error: "POST only" }, 405);

  const sess = await getSessionFromCookie(req);
  if (sess) await deleteSession(sess.token);
  clearCookieNode(res, SESSION_COOKIE);
  return sendJson(res, { ok: true });
}

async function actionChangeHandle(req, res) {
  if (req.method !== "POST") return sendBad(res, "POST only", 405);

  const { session, user } = await getSessionContext(req);
  if (!session || !user) return sendBad(res, "no autenticado", 401);

  const body = await readBody(req);
  const newHandle = normalizeHandle(body?.newHandle);
  if (!isValidHandle(newHandle)) return sendBad(res, "newHandle invalido (2-32, a-z, 0-9, _, -, .)", 400);
  if (newHandle === user.handle) return sendBad(res, "nuevo handle igual", 400);

  const already = await getUserByHandle(newHandle);
  if (already) return sendBad(res, "handle ya existe", 409);

  const oldHandle = user.handle;
  await redis.del(USERS_PREFIX + oldHandle);
  await redis.srem(USERS_INDEX, oldHandle);

  user.handle = newHandle;
  const currentDisplay = String(user?.profile?.displayName || "").trim().toLowerCase();
  if (!currentDisplay || currentDisplay === oldHandle) {
    user.profile = { ...(user.profile || {}), displayName: newHandle };
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
  setCookieNode(res, SESSION_COOKIE, nextSession.token, { maxAge: SESSION_MAX_AGE });

  return sendJson(res, { ok: true, user: await toClientUser(updated) });
}

async function actionChangePassword(req, res) {
  if (req.method !== "POST") return sendBad(res, "POST only", 405);

  const { user } = await getSessionContext(req);
  if (!user) return sendBad(res, "no autenticado", 401);

  const body = await readBody(req);
  const newPassword = String(body?.newPassword ?? body?.password ?? "");
  if (!isValidPassword(newPassword)) return sendBad(res, "password requerida", 400);

  const { hash, salt } = hashPassword(newPassword);
  user.hash = hash;
  user.salt = salt;
  await putUser(user);

  return sendJson(res, { ok: true });
}

async function actionDelete(req, res) {
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
}

async function actionProfile(req, res) {
  const { user } = await getSessionContext(req);
  if (!user) return sendBad(res, "no autenticado", 401);

  const avatars = await getAvatarCatalog();

  if (req.method === "GET") {
    return sendJson(res, { user: await toClientUser(user), avatars });
  }

  if (req.method !== "POST") return sendBad(res, "GET/POST only", 405);

  const body = await readBody(req);
  const nextProfile = { ...(user.profile || {}) };

  if (body.avatarId != null) {
    const avatar = pickAvatar(avatars, body.avatarId);
    nextProfile.avatarId = avatar.id;
    nextProfile.avatarName = avatar.name;
    nextProfile.avatarUrl = avatar.url;
  }
  if (body.displayName != null) {
    nextProfile.displayName = String(body.displayName ?? "").trim().slice(0, 48) || user.handle;
  }
  if (body.bio != null) {
    nextProfile.bio = String(body.bio ?? "").trim().slice(0, 280);
  }
  if (body.extras && typeof body.extras === "object" && !Array.isArray(body.extras)) {
    nextProfile.extras = {
      ...(nextProfile.extras && typeof nextProfile.extras === "object" ? nextProfile.extras : {}),
      ...body.extras,
    };
  }

  user.profile = nextProfile;
  const updated = await putUser(user);
  return sendJson(res, { ok: true, user: await toClientUser(updated), avatars });
}

async function actionHandles(req, res) {
  if (req.method !== "GET") return sendBad(res, "GET only", 405);
  const url = new URL(req.url, `http://${req.headers.host}`);
  const q = String(url.searchParams.get("q") || "");
  const limitRaw = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 20) : 8;
  const handles = await searchHandles(q, limit);
  return sendJson(
    res,
    { handles },
    200,
    { "Cache-Control": "private, max-age=10, stale-while-revalidate=30" }
  );
}

export default async function handler(req, res) {
  try {
    const action = getAction(req);

    if (action === "login") return await actionLogin(req, res);
    if (action === "signup") return await actionSignup(req, res);
    if (action === "me") return await actionMe(req, res);
    if (action === "logout") return await actionLogout(req, res);
    if (action === "change-handle") return await actionChangeHandle(req, res);
    if (action === "change-password") return await actionChangePassword(req, res);
    if (action === "delete") return await actionDelete(req, res);
    if (action === "profile") return await actionProfile(req, res);
    if (action === "handles") return await actionHandles(req, res);

    return sendBad(res, "auth action no soportada", 404);
  } catch (error) {
    console.error("auth/[action] crash:", error);
    return sendBad(res, "server error", 500);
  }
}
