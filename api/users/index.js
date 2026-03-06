import {
  listUsers,
  redis,
  sendBad,
  sendJson,
  toPublicUser,
  USER_DECKS_PUBLIC,
} from "../_lib.js";

export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return sendBad(res, "GET only", 405);

    const users = await listUsers();
    const out = [];
    for (const u of users) {
      const publicDecks = (await redis.smembers(USER_DECKS_PUBLIC(u.id))) || [];
      out.push(
        toPublicUser(u, {
          decksPublic: publicDecks.length,
        })
      );
    }

    out.sort((a, b) => String(a?.handle || "").localeCompare(String(b?.handle || "")));

    return sendJson(
      res,
      { users: out },
      200,
      {
        "Cache-Control": "public, max-age=30, stale-while-revalidate=120",
      }
    );
  } catch (error) {
    console.error("users/index crash:", error);
    return sendBad(res, "server error", 500);
  }
}
