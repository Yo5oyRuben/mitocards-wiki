# Mitocards - Notas tecnicas

Este archivo contiene las notas operativas y de arquitectura para no tocar el `README.md` publico de GitHub.

## Stack

- Frontend: Astro + Tailwind
- Backend: Vercel Serverless Functions (`/api/*`)
- Persistencia: Upstash Redis (con fallback local en `.local-db/store.json`)
- Auth: cookie `httpOnly` (`mitocards.sid`) + sesiones en Redis/local

## Arranque local

1. `npx vercel env pull .env.local`
2. `npx vercel dev`

Atajos:

- `npm run dev:vercel:pull`
- `npm run dev:vercel`
- `dev-vercel-pull.cmd`
- `dev-vercel.cmd`
- `arrancar.cmd`

## Variables de entorno

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `MITOCARDS_ADMIN_KEY` (recomendado para proteger `/api/admin/*`)
- `MITOCARDS_FORCE_LOCAL=1` (fuerza store local, sin Redis)
- `MITOCARDS_ALLOW_LOCAL_ADMIN=1` (solo local: admin sin key)

## API actual (optimizada para Vercel Hobby)

El proyecto esta compactado para no superar limites de Functions en plan Hobby.

Functions activas:

1. `api/auth/[action].js`
2. `api/admin/users.js`
3. `api/decks/index.js`
4. `api/decks/[id].js`
5. `api/users/index.js`
6. `api/users/[handle].js`

## Frontend principal

- `src/pages/index.astro`
- `src/pages/cartas/index.astro`
- `src/pages/cartas/[slug].astro`
- `src/pages/constructor.astro`
- `src/pages/repositorio.astro`
- `src/pages/perfiles.astro`
- `src/pages/perfil.astro`
- `src/pages/admin.astro`
- `src/layouts/Layout.astro`

## Catalogo y assets

- Fuente de verdad de cartas: `public/cards.json`
- Avatares de perfil: `public/profile-avatars.json`
- UI auth cliente: `public/js/auth-ui.js`
- Service Worker: `public/sw.js`
