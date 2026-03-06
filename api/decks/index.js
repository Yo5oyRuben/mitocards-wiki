// /api/decks/index.js
import {
  getSessionFromCookie, redis,
  USER_DECKS, DECKS_PREFIX, randomUUID,
  PUBLIC_DECKS, USER_DECKS_PUBLIC, USER_DECKS_PRIVATE,
  sendBad, sendJson, readBody
} from '../_lib.js';
import crypto from 'node:crypto';

export const config = { runtime: 'nodejs' };

// ---- util: ETag ----
function etagFor(obj) {
  const str = JSON.stringify(obj);
  return '"' + crypto.createHash('sha1').update(str).digest('base64') + '"';
}

// ---- util: parseo robusto de docs devueltos por Redis ----
function parseMaybeJson(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return null; }
  }
  return null;
}

export default async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const scope = url.searchParams.get('scope');           // 'public' | null (mine)
  const expand = url.searchParams.get('expand') === '1' || url.searchParams.get('expand') === 'true';

  // ===================== GET /api/decks =====================
  if (req.method === 'GET') {
    try {
      if (scope === 'public') {
        // --- IDs públicos desde SET ---
        const ids = (await redis.smembers(PUBLIC_DECKS)) || [];
        // No expand → solo ids
        if (!expand) {
          const payload = { decks: ids.map(id => ({ id })) };
          const etag = etagFor(payload);
          if (req.headers['if-none-match'] === etag) { res.statusCode = 304; return res.end(); }
          res.setHeader('ETag', etag);
          res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=300');
          return sendJson(res, payload);
        }

        // expand=1 → MGET solo si hay claves
        const keys = ids.map(id => DECKS_PREFIX + id);
        let decks = [];
        if (keys.length > 0) {
          const raw = await redis.mget(...keys);                // <— IMPORTANTE: spread
          decks = (raw || []).map(parseMaybeJson).filter(Boolean);
        }
        const payload = { decks };
        const etag = etagFor(payload);
        if (req.headers['if-none-match'] === etag) { res.statusCode = 304; return res.end(); }
        res.setHeader('ETag', etag);
        res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=600');
        return sendJson(res, payload);
      }

      // --- Mis mazos (requiere sesión) ---
      const sess = await getSessionFromCookie(req);
      if (!sess) return sendBad(res, 'no autenticado', 401);

      const ids = (await redis.smembers(USER_DECKS(sess.userId))) || [];
      if (!expand) {
        const payload = { decks: ids.map(id => ({ id })) };
        const etag = etagFor(payload);
        if (req.headers['if-none-match'] === etag) { res.statusCode = 304; return res.end(); }
        res.setHeader('ETag', etag);
        res.setHeader('Cache-Control', 'private, max-age=15, stale-while-revalidate=120');
        return sendJson(res, payload);
      }

      const keys = ids.map(id => DECKS_PREFIX + id);
      let decks = [];
      if (keys.length > 0) {
        const raw = await redis.mget(...keys);                  // <— IMPORTANTE: spread
        decks = (raw || []).map(parseMaybeJson).filter(Boolean);
      }
      const payload = { decks };
      const etag = etagFor(payload);
      if (req.headers['if-none-match'] === etag) { res.statusCode = 304; return res.end(); }
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'private, max-age=30, stale-while-revalidate=120');
      return sendJson(res, payload);

    } catch (err) {
      // Nunca matar el dev-server: devuelve lista vacía
      console.error('GET /api/decks error:', err);
      res.setHeader('Cache-Control', 'no-store');
      return sendJson(res, { decks: [] });
    }
  }

  // ===================== POST /api/decks (crear) =====================
  if (req.method === 'POST') {
    const sess = await getSessionFromCookie(req);
    if (!sess) return sendBad(res, 'no autenticado', 401);

    let body = {};
    try { body = await readBody(req); } catch { return sendBad(res, 'invalid json', 400); }

    const id = randomUUID();
    const visibility = (body.visibility === 'public') ? 'public' : 'private';

    const data = {
      id,
      owner: sess.userId,
      ownerHandle: sess.handle,
      visibility,
      nombre: String(body.nombre ?? 'Mazo'),
      xenoMax: Number(body.xenoMax ?? 0),
      huecosMax: Number(body.huecosMax ?? 0),
      ids: Array.isArray(body.ids) ? body.ids.map(v => String(v).trim().toLowerCase()) : [],
      descripcion: String(body.descripcion ?? ''),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Guardar doc + actualizar índices
    await redis.set(DECKS_PREFIX + id, data);
    await redis.sadd(USER_DECKS(sess.userId), id);
    if (visibility === 'public') {
      await redis.sadd(PUBLIC_DECKS, id);
      await redis.sadd(USER_DECKS_PUBLIC(sess.userId), id);
    } else {
      await redis.sadd(USER_DECKS_PRIVATE(sess.userId), id);
    }

    // 201 Created
    return sendJson(res, { ok: true, deck: data }, 201);
  }

  // ===================== Otros métodos =====================
  return sendBad(res, 'GET/POST only', 405);
}

