// /api/decks/index.js
import {
  getSessionFromCookie, redis,
  USER_DECKS, DECKS_PREFIX, randomUUID,
  PUBLIC_DECKS, USER_DECKS_PUBLIC, USER_DECKS_PRIVATE,
  sendBad, sendJson
} from '../_lib.js';

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const scope = url.searchParams.get('scope');
  const expand = url.searchParams.get('expand') === '1' || url.searchParams.get('expand') === 'true';

  if (req.method === 'GET') {
  if (scope === 'public') {
    const ids = (await redis.smembers(PUBLIC_DECKS)) || [];
    if (!expand) {
      return sendJson(res, { decks: ids.map(id => ({ id })) });
    }
    // expand=1 -> devolver documentos completos en una sola llamada
    const keys = ids.map(id => DECKS_PREFIX + id);
    const decks = (await redis.mget(...keys)).filter(Boolean);
    return sendJson(res, { decks });
  }

  // Mis mazos (requiere sesión)
  const sess = await getSessionFromCookie(req);
  if (!sess) return sendBad(res, 'no autenticado', 401);

  const ids = (await redis.smembers(USER_DECKS(sess.userId))) || [];
  if (!expand) {
    return sendJson(res, { decks: ids.map(id => ({ id })) });
  }
  const keys = ids.map(id => DECKS_PREFIX + id);
  const decks = (await redis.mget(...keys)).filter(Boolean);
  return sendJson(res, { decks });
}


  if (req.method === 'POST') {
    const sess = await getSessionFromCookie(req);
    if (!sess) return sendBad(res, 'no autenticado', 401);

    let body = {};
    try { body = await parseJson(req); } catch { return sendBad(res, 'invalid json', 400); }
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
    };

    await redis.set(DECKS_PREFIX + id, data);
    await redis.sadd(USER_DECKS(sess.userId), id);
    if (visibility === 'public') {
      await redis.sadd(PUBLIC_DECKS, id);
      await redis.sadd(USER_DECKS_PUBLIC(sess.userId), id);
    } else {
      await redis.sadd(USER_DECKS_PRIVATE(sess.userId), id);
    }

    return sendJson(res, { ok: true, deck: data }, 201);
  }

  return sendBad(res, 'GET/POST only', 405);
}

async function parseJson(req) {
  // 1) Si algún runtime/middleware ya colocó el body:
  if (req.body != null) {
    if (typeof req.body === 'string') {
      try { return JSON.parse(req.body); } catch { return {}; }
    }
    if (Buffer.isBuffer(req.body)) {
      const txt = req.body.toString('utf8');
      try { return txt ? JSON.parse(txt) : {}; } catch { return {}; }
    }
    if (typeof req.body === 'object') return req.body; // ya parseado
  }

  // 2) Leer el stream Node (fallback estándar)
  const chunks = [];
  for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
  const txt = Buffer.concat(chunks).toString('utf8') || '';

  // (Opcional) trazas para ver exactamente qué llega:
  // console.log('[POST /api/decks] CT=', req.headers['content-type']);
  // console.log('[POST /api/decks] RAW=', txt);

  if (!txt) return {};

  // 3) JSON normal
  try { return JSON.parse(txt); } catch {}

  // 4) x-www-form-urlencoded por si algún cliente lo usa
  const ct = String(req.headers['content-type'] || '').split(';')[0].trim();
  if (ct === 'application/x-www-form-urlencoded') {
    return Object.fromEntries(new URLSearchParams(txt));
  }

  return {};
}





