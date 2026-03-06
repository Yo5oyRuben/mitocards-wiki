import { Redis } from "@upstash/redis";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "crypto";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const REDIS_URL =
  process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || process.env.REDIS_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const FORCE_LOCAL =
  String(process.env.MITOCARDS_FORCE_LOCAL || "").toLowerCase() === "1" ||
  String(process.env.MITOCARDS_FORCE_LOCAL || "").toLowerCase() === "true";
const redisClient = !FORCE_LOCAL && REDIS_URL && REDIS_TOKEN
  ? new Redis({ url: REDIS_URL, token: REDIS_TOKEN })
  : null;

const REDIS_RETRY_COOLDOWN_MS = 5 * 60_000;
const REDIS_OP_TIMEOUT_MS = 1_500;
let forceLocalUntil = !redisClient ? Number.POSITIVE_INFINITY : 0;
const warnedOps = new Set();

const FALLBACK_DIR = resolve(process.cwd(), ".local-db");
const FALLBACK_FILE = resolve(FALLBACK_DIR, "store.json");
let fallbackWriteQueue = Promise.resolve();

const AVATAR_FILE = resolve(process.cwd(), "public", "profile-avatars.json");
let avatarCatalogCache = null;

if (!redisClient) {
  if (FORCE_LOCAL) console.warn("[mitocards] Modo local forzado (MITOCARDS_FORCE_LOCAL=1).");
  else console.warn("[mitocards] Redis no configurado. Usando store local en archivo.");
}

function nowMs() {
  return Date.now();
}

function nowIso() {
  return new Date().toISOString();
}

function cloneValue(value) {
  if (value == null) return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
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

function warnFallback(op, error) {
  if (warnedOps.has(op)) return;
  warnedOps.add(op);
  const reason = error?.message || error?.code || "redis unavailable";
  console.warn(`[mitocards] Redis fallback activo para '${op}': ${reason}`);
}

async function ensureFallbackStoreFile() {
  await mkdir(FALLBACK_DIR, { recursive: true });
  try {
    await access(FALLBACK_FILE);
  } catch {
    await writeFile(FALLBACK_FILE, JSON.stringify({ kv: {}, sets: {} }, null, 2), "utf8");
  }
}

function normalizeStore(value) {
  const obj = value && typeof value === "object" ? value : {};
  const kv = obj.kv && typeof obj.kv === "object" ? obj.kv : {};
  const sets = obj.sets && typeof obj.sets === "object" ? obj.sets : {};
  return { kv, sets };
}

async function readFallbackStore() {
  await ensureFallbackStoreFile();
  try {
    const raw = await readFile(FALLBACK_FILE, "utf8");
    return normalizeStore(JSON.parse(raw));
  } catch {
    return { kv: {}, sets: {} };
  }
}

async function writeFallbackStore(store) {
  await ensureFallbackStoreFile();
  const tmpFile = `${FALLBACK_FILE}.tmp`;
  await writeFile(tmpFile, JSON.stringify(store, null, 2), "utf8");
  await rename(tmpFile, FALLBACK_FILE);
}

async function withFallbackWrite(mutator) {
  fallbackWriteQueue = fallbackWriteQueue.then(async () => {
    const store = await readFallbackStore();
    const result = await mutator(store);
    await writeFallbackStore(store);
    return result;
  });
  return fallbackWriteQueue;
}

function getEntryValue(store, key) {
  const entry = store.kv[key];
  if (!entry) return { exists: false, value: null, expired: false };
  const expiresAt = Number.isFinite(entry.expiresAt) ? Number(entry.expiresAt) : null;
  if (expiresAt != null && expiresAt <= nowMs()) return { exists: true, value: null, expired: true };
  return { exists: true, value: cloneValue(entry.value), expired: false };
}

async function fallbackGet(key) {
  const store = await readFallbackStore();
  const state = getEntryValue(store, key);
  if (state.expired) {
    await withFallbackWrite((s) => {
      delete s.kv[key];
    });
    return null;
  }
  return state.value;
}

async function fallbackSet(key, value, opts = {}) {
  return withFallbackWrite((store) => {
    const expiresAt = Number.isFinite(opts?.ex) ? nowMs() + Number(opts.ex) * 1000 : null;
    store.kv[key] = { value: cloneValue(value), expiresAt };
    return "OK";
  });
}

async function fallbackDel(...keys) {
  return withFallbackWrite((store) => {
    let removed = 0;
    for (const key of keys) {
      if (key in store.kv) {
        delete store.kv[key];
        removed += 1;
      }
      if (key in store.sets) {
        delete store.sets[key];
        removed += 1;
      }
    }
    return removed;
  });
}

async function fallbackMget(...keys) {
  const store = await readFallbackStore();
  const results = [];
  const expired = [];
  for (const key of keys) {
    const state = getEntryValue(store, key);
    if (state.expired) expired.push(key);
    results.push(state.value);
  }
  if (expired.length) {
    await withFallbackWrite((s) => {
      for (const key of expired) delete s.kv[key];
    });
  }
  return results;
}

async function fallbackSmembers(key) {
  const store = await readFallbackStore();
  const arr = Array.isArray(store.sets[key]) ? store.sets[key] : [];
  return [...new Set(arr)];
}

async function fallbackSadd(key, ...members) {
  return withFallbackWrite((store) => {
    const set = new Set(Array.isArray(store.sets[key]) ? store.sets[key] : []);
    let added = 0;
    for (const member of members) {
      if (!set.has(member)) {
        set.add(member);
        added += 1;
      }
    }
    store.sets[key] = [...set];
    return added;
  });
}

async function fallbackSrem(key, ...members) {
  return withFallbackWrite((store) => {
    const set = new Set(Array.isArray(store.sets[key]) ? store.sets[key] : []);
    let removed = 0;
    for (const member of members) {
      if (set.delete(member)) removed += 1;
    }
    store.sets[key] = [...set];
    return removed;
  });
}

async function withRedis(opName, remoteCall, fallbackCall) {
  if (!redisClient || forceLocalUntil > nowMs()) return fallbackCall();
  try {
    const remotePromise = Promise.resolve().then(remoteCall);
    remotePromise.catch(() => {});
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`redis timeout (${REDIS_OP_TIMEOUT_MS}ms)`)), REDIS_OP_TIMEOUT_MS)
    );
    return await Promise.race([remotePromise, timeoutPromise]);
  } catch (error) {
    warnFallback(opName, error);
    forceLocalUntil = nowMs() + REDIS_RETRY_COOLDOWN_MS;
    return fallbackCall();
  }
}

export const redis = {
  async get(key) {
    return withRedis("get", () => redisClient.get(key), () => fallbackGet(key));
  },

  async set(key, value, opts = {}) {
    return withRedis("set", () => redisClient.set(key, value, opts), () => fallbackSet(key, value, opts));
  },

  async del(...keys) {
    return withRedis("del", () => redisClient.del(...keys), () => fallbackDel(...keys));
  },

  async mget(...keys) {
    if (!keys.length) return [];
    return withRedis("mget", () => redisClient.mget(...keys), () => fallbackMget(...keys));
  },

  async smembers(key) {
    return withRedis("smembers", () => redisClient.smembers(key), () => fallbackSmembers(key));
  },

  async sadd(key, ...members) {
    return withRedis("sadd", () => redisClient.sadd(key, ...members), () => fallbackSadd(key, ...members));
  },

  async srem(key, ...members) {
    return withRedis("srem", () => redisClient.srem(key, ...members), () => fallbackSrem(key, ...members));
  },
};

export function isUsingLocalStore() {
  return !redisClient || forceLocalUntil > nowMs();
}

export const ADMIN_KEY = process.env.MITOCARDS_ADMIN_KEY || "1234";
const ALLOW_LOCAL_ADMIN =
  String(process.env.MITOCARDS_ALLOW_LOCAL_ADMIN || "").toLowerCase() === "1" ||
  String(process.env.MITOCARDS_ALLOW_LOCAL_ADMIN || "").toLowerCase() === "true";

function readHeader(req, name) {
  if (!req?.headers) return "";
  const direct = req.headers[name];
  if (typeof direct === "string") return direct;
  const lower = req.headers[name.toLowerCase()];
  return typeof lower === "string" ? lower : "";
}

function requestIsLocal(req) {
  const host = readHeader(req, "host");
  return /(^|:)(localhost|127\.0\.0\.1)(:|$)/i.test(host);
}

export function isAdminRequest(req) {
  const key = readHeader(req, "x-admin-key");
  if (ADMIN_KEY) return key === ADMIN_KEY;
  if (ALLOW_LOCAL_ADMIN) return requestIsLocal(req) && process.env.NODE_ENV !== "production";
  return false;
}

export function requireAdmin(req, res) {
  if (isAdminRequest(req)) return true;
  sendBad(res, "admin forbidden", 403);
  return false;
}

export const json = (data, init = 200) =>
  new Response(JSON.stringify(data), {
    status: typeof init === "number" ? init : init.status ?? 200,
    headers: { "content-type": "application/json", ...(typeof init === "number" ? {} : init.headers) },
  });

export const bad = (msg, code = 400) => json({ error: msg }, code);

export const PUBLIC_DECKS = "decks:public";
export const USER_DECKS_PUBLIC = (uid) => `user:${uid}:decks:pub`;
export const USER_DECKS_PRIVATE = (uid) => `user:${uid}:decks:priv`;
export const USERS_PREFIX = "user:";
export const USERS_INDEX = "users:all";
export const USER_ID_HANDLE = (uid) => `user:id:${uid}`;
export const SESSIONS_PREFIX = "sess:";
export const DECKS_PREFIX = "deck:";
export const USER_DECKS = (uid) => `user:${uid}:decks`;
export const SESSION_COOKIE = "mitocards.sid";
const SESSION_TTL = 60 * 60 * 24 * 30;
const HANDLE_REGEX = /^[a-z0-9][a-z0-9_.-]{1,31}$/;

const DEFAULT_AVATAR_CATALOG = [
  { id: "alquimista", name: "Alquimista", url: "/img/cartas/webp_l/alquimista_dibujo.webp" },
];

export async function getAvatarCatalog() {
  if (avatarCatalogCache) return avatarCatalogCache;
  try {
    const raw = await readFile(AVATAR_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) {
      avatarCatalogCache = parsed
        .map((x) => ({
          id: String(x?.id || "").trim(),
          name: String(x?.name || x?.id || "").trim(),
          url: String(x?.url || "").trim(),
        }))
        .filter((x) => x.id && x.url);
      if (avatarCatalogCache.length) return avatarCatalogCache;
    }
  } catch {}
  avatarCatalogCache = DEFAULT_AVATAR_CATALOG;
  return avatarCatalogCache;
}

export function normalizeHandle(handle) {
  return String(handle ?? "").trim().toLowerCase();
}

export function isValidHandle(handle) {
  return HANDLE_REGEX.test(normalizeHandle(handle));
}

export function isValidPassword(password) {
  return String(password ?? "").length > 0;
}

export function pickAvatar(catalog, avatarId) {
  const id = String(avatarId || "").trim();
  return catalog.find((a) => a.id === id) || catalog[0];
}

export async function normalizeUserRecord(rawUser) {
  const catalog = await getAvatarCatalog();
  const source = parseMaybeJson(rawUser) || {};
  const handle = normalizeHandle(source.handle);
  const profile = source.profile && typeof source.profile === "object" ? source.profile : {};
  const avatar = pickAvatar(catalog, profile.avatarId);
  return {
    ...source,
    id: source.id || randomUUID(),
    handle,
    createdAt: source.createdAt || nowIso(),
    profile: {
      avatarId: avatar.id,
      avatarName: avatar.name,
      avatarUrl: avatar.url,
      displayName: String(profile.displayName || handle),
      bio: String(profile.bio || ""),
      extras: profile.extras && typeof profile.extras === "object" ? profile.extras : {},
    },
  };
}

export function toPublicUser(user, extras = {}) {
  if (!user) return null;
  return {
    id: user.id,
    handle: user.handle,
    createdAt: user.createdAt || null,
    profile: user.profile || null,
    ...extras,
  };
}

export async function getUserByHandle(handle) {
  const h = normalizeHandle(handle);
  if (!h) return null;
  const raw = await redis.get(USERS_PREFIX + h);
  if (!raw) return null;
  return normalizeUserRecord(raw);
}

export async function putUser(user) {
  const normalized = await normalizeUserRecord(user);
  await redis.set(USERS_PREFIX + normalized.handle, normalized);
  await redis.sadd(USERS_INDEX, normalized.handle);
  await redis.set(USER_ID_HANDLE(normalized.id), normalized.handle);
  return normalized;
}

export async function getUserById(userId) {
  const uid = String(userId || "").trim();
  if (!uid) return null;
  const handle = normalizeHandle(await redis.get(USER_ID_HANDLE(uid)));
  if (handle) {
    const user = await getUserByHandle(handle);
    if (user) return user;
  }
  const users = await listUsers();
  return users.find((u) => u.id === uid) || null;
}

export async function listUsers() {
  const handles = (await redis.smembers(USERS_INDEX)) || [];
  if (handles.length) {
    const users = [];
    for (const h of handles) {
      const u = await getUserByHandle(h);
      if (u) users.push(u);
    }
    return users;
  }
  if (isUsingLocalStore()) {
    const store = await readFallbackStore();
    const users = [];
    for (const [k, entry] of Object.entries(store.kv)) {
      if (!k.startsWith(USERS_PREFIX)) continue;
      if (entry?.value) users.push(await normalizeUserRecord(entry.value));
    }
    return users;
  }
  return [];
}

export async function searchHandles(query = "", limit = 8) {
  const q = normalizeHandle(query);
  const users = await listUsers();
  const handles = users
    .map((u) => u.handle)
    .filter(Boolean)
    .filter((h) => (q ? h.includes(q) : true))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, Math.max(1, Number(limit) || 8));
  return handles;
}

export async function getDeckCountByUserId(userId) {
  const uid = String(userId || "").trim();
  if (!uid) return 0;
  const ids = (await redis.smembers(USER_DECKS(uid))) || [];
  return ids.length;
}

export async function toClientUser(user, extras = {}) {
  if (!user) return null;
  const deckCount = Number.isFinite(extras?.deckCount)
    ? Number(extras.deckCount)
    : await getDeckCountByUserId(user.id);
  return toPublicUser(user, {
    deckCount,
    hasPassword: Boolean(user.hash && user.salt),
    ...extras,
  });
}

export function hashPassword(password, salt) {
  const s = salt || randomBytes(16).toString("hex");
  const key = scryptSync(password, s, 32).toString("hex");
  return { salt: s, hash: key };
}

export function verifyPassword(password, hash, salt) {
  const cand = scryptSync(password, salt, 32);
  const target = Buffer.from(hash, "hex");
  return cand.length === target.length && timingSafeEqual(cand, target);
}

export async function createSession(user) {
  const token = randomBytes(24).toString("hex");
  const sess = {
    token,
    userId: user.id,
    handle: user.handle,
    createdAt: nowIso(),
  };
  await redis.set(SESSIONS_PREFIX + token, sess, { ex: SESSION_TTL });
  return sess;
}

export async function deleteSession(token) {
  await redis.del(SESSIONS_PREFIX + token);
}

export async function getSessionFromCookie(req) {
  const cookieHeader = req?.headers?.cookie || "";
  if (!cookieHeader) return null;
  const escaped = SESSION_COOKIE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = cookieHeader.match(new RegExp(`${escaped}=([^;]+)`));
  if (!match) return null;
  const token = match[1];
  return (await redis.get(SESSIONS_PREFIX + token)) ?? null;
}

export async function getSessionContext(req) {
  const session = await getSessionFromCookie(req);
  if (!session) return { session: null, user: null };
  let user = await getUserByHandle(session.handle);
  if (!user && session.userId) {
    user = await getUserById(session.userId);
  }
  return { session, user: user || null };
}

export { randomUUID };

export function setCookie(res, name, value, opts = {}) {
  const parts = [`${name}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (opts.maxAge) parts.push(`Max-Age=${opts.maxAge}`);
  res.headers.append("Set-Cookie", parts.join("; "));
  return res;
}

export function clearCookie(res, name) {
  res.headers.append("Set-Cookie", `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return res;
}

export function sendJson(res, data, status = 200, headers = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(data));
}

export function sendBad(res, msg, status = 400) {
  sendJson(res, { error: msg }, status);
}

export function setCookieNode(res, name, value, opts = {}) {
  const parts = [`${name}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (opts.maxAge) parts.push(`Max-Age=${opts.maxAge}`);
  res.setHeader("Set-Cookie", parts.join("; "));
}

export function clearCookieNode(res, name) {
  res.setHeader("Set-Cookie", `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export async function readBody(req) {
  if (req.body != null) {
    if (typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
    if (typeof req.body === "string") {
      try {
        return JSON.parse(req.body);
      } catch {}
      try {
        return Object.fromEntries(new URLSearchParams(req.body));
      } catch {}
    }
    if (Buffer.isBuffer(req.body)) {
      const txt = req.body.toString("utf8");
      try {
        return JSON.parse(txt);
      } catch {}
      try {
        return Object.fromEntries(new URLSearchParams(txt));
      } catch {}
    }
  }

  const chunks = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  const txt = Buffer.concat(chunks).toString("utf8");
  if (!txt) return {};

  try {
    return JSON.parse(txt);
  } catch {}
  try {
    return Object.fromEntries(new URLSearchParams(txt));
  } catch {}
  return {};
}
