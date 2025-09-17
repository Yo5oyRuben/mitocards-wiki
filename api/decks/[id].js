// /api/decks/[id].js
import {
  getSessionFromCookie, redis,
  DECKS_PREFIX, USER_DECKS,
  PUBLIC_DECKS, USER_DECKS_PUBLIC, USER_DECKS_PRIVATE,
  sendBad, sendJson
} from '../_lib.js'; // ← ruta corregida

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const id  = url.pathname.split('/').pop();
    if (!id) return sendBad(res, 'missing id', 400);

    const deck = await redis.get(DECKS_PREFIX + id);
    if (!deck) return sendBad(res, 'no encontrado', 404);

    if (req.method === 'GET') {
      if (deck.visibility === 'public') return sendJson(res, { deck });
      const sess = await getSessionFromCookie(req);
      if (!sess) return sendBad(res, 'no autenticado', 401);
      if (deck.owner !== sess.userId) return sendBad(res, 'forbidden', 403);
      return sendJson(res, { deck });
    }

    const sess = await getSessionFromCookie(req);
    if (!sess) return sendBad(res, 'no autenticado', 401);
    if (deck.owner !== sess.userId) return sendBad(res, 'forbidden', 403);

    if (req.method === 'PUT') {
      // Leer JSON
      let body = {};
      try {
        let raw = '';
        await new Promise((ok, ko) => {
          req.on('data', c => raw += c);
          req.on('end', ok);
          req.on('error', ko);
        });
        body = raw ? JSON.parse(raw) : {};
      } catch {
        return sendBad(res, 'invalid json', 400);
      }

      const next = {
        ...deck,
        nombre: String(body.nombre ?? deck.nombre ?? ''),
        xenoMax: Number(body.xenoMax ?? deck.xenoMax ?? 0) || 0,
        huecosMax: Number(body.huecosMax ?? deck.huecosMax ?? 0) || 0,
        ids: Array.isArray(body.ids) ? body.ids.map(s => String(s).toLowerCase()) : deck.ids,
        descripcion: String(body.descripcion ?? deck.descripcion ?? ''),
        visibility: String(body.visibility ?? deck.visibility ?? 'private').toLowerCase() === 'public' ? 'public' : 'private',
      };

      // Actualizar índices si cambia visibilidad
      if (deck.visibility !== next.visibility) {
        if (deck.visibility === 'public') await redis.srem(PUBLIC_DECKS, id);
        if (next.visibility === 'public') await redis.sadd(PUBLIC_DECKS, id);
        await redis.srem(USER_DECKS_PUBLIC(sess.userId), id);
        await redis.srem(USER_DECKS_PRIVATE(sess.userId), id);
        await redis.sadd(next.visibility === 'public'
          ? USER_DECKS_PUBLIC(sess.userId)
          : USER_DECKS_PRIVATE(sess.userId), id);
      }

      await redis.set(DECKS_PREFIX + id, next);
      return sendJson(res, { ok: true, deck: next });
    }

    if (req.method === 'DELETE') {
      await redis.del(DECKS_PREFIX + id);
      await redis.srem(USER_DECKS(sess.userId), id);
      await redis.srem(USER_DECKS_PUBLIC(sess.userId), id);
      await redis.srem(USER_DECKS_PRIVATE(sess.userId), id);
      await redis.srem(PUBLIC_DECKS, id);
      return sendJson(res, { ok: true });
    }

    return sendBad(res, 'GET/DELETE only', 405);
  } catch (e) {
    console.error('Deck handler crash', e);
    return sendBad(res, 'internal error', 500);
  }
}

