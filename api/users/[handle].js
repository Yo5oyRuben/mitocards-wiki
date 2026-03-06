import {
  DECKS_PREFIX,
  getUserByHandle,
  redis,
  sendBad,
  sendJson,
  toPublicUser,
  USER_DECKS_PUBLIC,
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
    if (req.method !== "GET") return sendBad(res, "GET only", 405);

    const url = new URL(req.url, `http://${req.headers.host}`);
    const handle = decodeURIComponent(url.pathname.split("/").pop() || "").trim().toLowerCase();
    if (!handle) return sendBad(res, "handle requerido", 400);

    const user = await getUserByHandle(handle);
    if (!user) return sendBad(res, "usuario no encontrado", 404);

    const ids = (await redis.smembers(USER_DECKS_PUBLIC(user.id))) || [];
    const keys = ids.map((id) => DECKS_PREFIX + id);
    const rawDecks = keys.length ? await redis.mget(...keys) : [];
    const decks = (rawDecks || [])
      .map(parseMaybeJson)
      .filter(Boolean)
      .map((d) => ({
        id: d.id,
        nombre: d.nombre || "",
        descripcion: d.descripcion || "",
        xenoMax: Number(d.xenoMax || 0),
        huecosMax: Number(d.huecosMax || 0),
        updatedAt: d.updatedAt || d.createdAt || null,
        ids: Array.isArray(d.ids) ? d.ids : [],
      }))
      .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));

    return sendJson(
      res,
      {
        user: toPublicUser(user, { decksPublic: ids.length }),
        decks,
      },
      200,
      {
        "Cache-Control": "public, max-age=30, stale-while-revalidate=120",
      }
    );
  } catch (error) {
    console.error("users/[handle] crash:", error);
    return sendBad(res, "server error", 500);
  }
}
