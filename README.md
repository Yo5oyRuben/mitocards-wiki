# Mitocards Wiki

Proyecto recreativo para construir una wiki + deckbuilder del TCG Mitocards.

## Stack

- Frontend: Astro + Tailwind
- Backend: Vercel Serverless Functions (`/api/*`)
- Persistencia: Upstash Redis
- Auth: cookie `httpOnly` (`mitocards.sid`) + sesiones en Redis

## Arranque local

1. `npx vercel env pull .env.local`
2. `npx vercel dev`

Atajos:

- `npm run dev:vercel:pull`
- `npm run dev:vercel`
- `dev-vercel-pull.cmd`
- `dev-vercel.cmd`
- `arrancar.cmd` (pull + dev en un paso)

Variables necesarias:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `MITOCARDS_ADMIN_KEY` (recomendado: obligatorio para `/api/admin/*`)
- `MITOCARDS_FORCE_LOCAL=1` (opcional en local: desactiva Redis y usa `.local-db/store.json`)
- `MITOCARDS_ALLOW_LOCAL_ADMIN=1` (solo si quieres permitir admin sin clave en localhost)

## Troubleshooting rapido (login/decks)

Si aparece `FUNCTION_INVOCATION_FAILED` con errores tipo `ENOTFOUND ...upstash.io`:

- El backend ahora entra en fallback local en archivo (`.local-db/store.json`) y no debe caerse.
- Podras iniciar sesion y probar mazos localmente, con persistencia entre reinicios de `vercel dev`.
- Si quieres evitar completamente timeouts de Redis en local, usa `MITOCARDS_FORCE_LOCAL=1`.
- Para persistencia real, corrige las variables Upstash y vuelve a ejecutar:
  - `npx vercel env pull .env.local`

## Estructura principal

- `public/cards.json`: catalogo unico de cartas
- `public/img/*`: assets e ilustraciones
- `public/sw.js`: cache de imagenes y API
- `public/js/auth-ui.js`: UI de cuenta/login (boton arriba derecha, modal propio, ajustes de cuenta)
- `public/profile-avatars.json`: catalogo cerrado de fotos de perfil (id, name, url)

- `src/pages/index.astro`: home
- `src/pages/cartas/index.astro`: explorador de cartas
- `src/pages/cartas/[slug].astro`: detalle de carta
- `src/pages/constructor.astro`: constructor/edicion de mazos
- `src/pages/repositorio.astro`: mazos publicos y de usuario
- `src/pages/admin.astro`: panel de administracion de usuarios
- `src/pages/perfiles.astro`: listado publico de perfiles
- `src/pages/perfil.astro`: ficha publica de usuario
- `src/layouts/Layout.astro`: shell compartido (auth-ui + service worker)
- `src/lib/cards-catalog.ts`: lector unificado de `public/cards.json`

- `api/auth/*`: signup/login/logout/me, sugerencias de handle, perfil y gestion de cuenta
- `api/admin/users.js`: listar/reset/renombrar/eliminar usuarios
- `api/users/index.js`: listado publico de perfiles
- `api/users/[handle].js`: ficha publica de perfil + mazos publicos
- `api/decks/index.js`: listado y creacion de mazos
- `api/decks/[id].js`: lectura, edicion y borrado por ID
- `api/_lib.js`: helpers compartidos (Redis, cookies, body parser, respuestas)

## Estado de datos

- La fuente de verdad del catalogo es `public/cards.json`.
- El frontend de cartas consume esa fuente via `src/lib/cards-catalog.ts`.

## Avatares de perfil

- Edita el listado cerrado en `public/profile-avatars.json`.
- Cada entrada usa: `id`, `name`, `url`.
- Guarda las imagenes donde prefieras dentro de `public/img/...` y referencia esa ruta en `url`.
- Recomendado: formato cuadrado para que se vea bien en la UI de cuenta.
