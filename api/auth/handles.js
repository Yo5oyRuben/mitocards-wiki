import { searchHandles, sendBad, sendJson } from "../_lib.js";

export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  try {
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
      {
        "Cache-Control": "private, max-age=10, stale-while-revalidate=30",
      }
    );
  } catch (error) {
    console.error("auth/handles crash:", error);
    return sendBad(res, "server error", 500);
  }
}
