import {
  getAvatarCatalog,
  getSessionContext,
  pickAvatar,
  putUser,
  readBody,
  sendBad,
  sendJson,
  toClientUser,
} from "../_lib.js";

export const config = { runtime: "nodejs" };

function sanitizeText(value, maxLen = 120) {
  return String(value ?? "")
    .trim()
    .slice(0, maxLen);
}

export default async function handler(req, res) {
  try {
    const { user } = await getSessionContext(req);
    if (!user) return sendBad(res, "no autenticado", 401);

    const avatars = await getAvatarCatalog();

    if (req.method === "GET") {
      return sendJson(res, {
        user: await toClientUser(user),
        avatars,
      });
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
      nextProfile.displayName = sanitizeText(body.displayName, 48) || user.handle;
    }

    if (body.bio != null) {
      nextProfile.bio = sanitizeText(body.bio, 280);
    }

    if (body.extras && typeof body.extras === "object" && !Array.isArray(body.extras)) {
      nextProfile.extras = {
        ...(nextProfile.extras && typeof nextProfile.extras === "object" ? nextProfile.extras : {}),
        ...body.extras,
      };
    }

    user.profile = nextProfile;
    const updated = await putUser(user);

    return sendJson(res, {
      ok: true,
      user: await toClientUser(updated),
      avatars,
    });
  } catch (error) {
    console.error("auth/profile crash:", error);
    return sendBad(res, "server error", 500);
  }
}
