import {
  createSession,
  getAvatarCatalog,
  getUserByHandle,
  hashPassword,
  isValidHandle,
  isValidPassword,
  normalizeHandle,
  pickAvatar,
  putUser,
  randomUUID,
  readBody,
  sendBad,
  sendJson,
  SESSION_COOKIE,
  setCookieNode,
  toClientUser,
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

    const handle = normalizeHandle(body.handle ?? body.alias ?? body.username ?? body.user ?? "");
    const password = String(body.password ?? "");
    const avatarId = String(body.avatarId ?? "");

    if (!isValidHandle(handle)) {
      return sendBad(res, "handle invalido (2-32, a-z, 0-9, _, -, .)", 400);
    }
    if (!isValidPassword(password)) {
      return sendBad(res, "password requerida", 400);
    }

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
    setCookieNode(res, SESSION_COOKIE, sess.token, { maxAge: 60 * 60 * 24 * 30 });

    return sendJson(
      res,
      {
        ok: true,
        user: await toClientUser(user),
      },
      201
    );
  } catch (error) {
    console.error("auth/signup crash:", error);
    return sendBad(res, "server error", 500);
  }
}