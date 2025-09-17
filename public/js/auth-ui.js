// /public/js/auth-ui.js
(() => {
  const $ = (s, r = document) => r.querySelector(s);

  // --- Cache de sesión (10 min) ---
  const LS_KEY = 'mc:me';
  const ME_TTL_MS = 10 * 60 * 1000;
  let inflightMe = null;

  const now = () => Date.now();
  function readCachedMe() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      const { user, ts } = JSON.parse(raw);
      if (!user || !ts) return null;
      if (now() - ts > ME_TTL_MS) return null; // expirado
      return user;
    } catch { return null; }
  }
  function writeCachedMe(user) {
    if (!user) localStorage.removeItem(LS_KEY);
    else localStorage.setItem(LS_KEY, JSON.stringify({ user, ts: now() }));
  }

  async function call(url, opt) {
    try {
      const r = await fetch(url, { credentials: 'include', ...(opt || {}) });
      const txt = await r.text();
      let data; try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
      if (!r.ok) return { error: data?.error || data?.raw || `HTTP ${r.status}`, status: r.status };
      return data;
    } catch (e) { return { error: e?.message || String(e), status: 0 }; }
  }

  const api = {
    me:     ()    => call('/api/auth/me?ts=' + Date.now(), { cache: 'no-store' }),
    login:  (h,p) => call('/api/auth/login',  { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ handle:h, password:p }) }),
    signup: (h,p) => call('/api/auth/signup', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ handle:h, password:p }) }),
    logout: ()    => call('/api/auth/logout', { method:'POST' }),
    saveDeck: (d, visibility='private') => {
      const hasId = !!d?.id;
      const url = hasId ? `/api/decks/${encodeURIComponent(d.id)}` : '/api/decks';
      const method = hasId ? 'PUT' : 'POST';
      return call(url, {
        method,
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ ...d, visibility })
      });
    },

  };

  function ensureBadge() {
    let el = $('#auth-badge');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'auth-badge';
    el.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:10000;display:flex;gap:8px;align-items:center;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.18);backdrop-filter:blur(6px);padding:8px 10px;border-radius:12px;font:600 13px system-ui,Segoe UI,Roboto,sans-serif;color:inherit;';
    el.innerHTML = `<span id="auth-name"></span>
      <button id="auth-in"  style="padding:6px 10px;border-radius:10px;border:1px solid rgba(255,255,255,0.2);background:#2a2f3a;color:inherit;cursor:pointer">Entrar/Registrarse</button>
      <button id="auth-out" style="padding:6px 10px;border-radius:10px;border:1px solid rgba(255,255,255,0.2);background:#2a2f3a;color:inherit;cursor:pointer">Salir</button>`;
    document.body.appendChild(el);
    return el;
  }

  function paint(user) {
    ensureBadge();
    $('#auth-name').textContent = user ? `Hola, ${user.handle}` : 'No identificado';
    $('#auth-in').style.display  = user ? 'none' : '';
    $('#auth-out').style.display = user ? '' : 'none';
  }

  async function refreshMe() {
    if (inflightMe) return inflightMe; // de-dup
    inflightMe = (async () => {
      const resp = await api.me(); // "/api/auth/me" (no crea sesión nueva)
      const user = resp?.user || null;
      writeCachedMe(user);
      paint(user);
      inflightMe = null;
      return user;
    })();
    return inflightMe;
  }

  async function render() {
    // 1) Pintar instantáneo desde cache (si existe)
    paint(readCachedMe());

    // 2) Refrescar en segundo plano (SWr)
    refreshMe();

    // 3) Wire-up botones
    $('#auth-in').onclick = async () => {
      const handle = (prompt('Alias (handle):') || '').trim().toLowerCase();
      if (!handle) return;
      const usePwd = confirm('¿Poner contraseña? (opcional)');
      const pwd = usePwd ? (prompt('Contraseña:') || '') : '';

      // Login; si no existe, signup. (Lógica existente)
      let resp = await api.login(handle, pwd);
      if (resp?.error) {
        if (/no existe/i.test(resp.error)) {
          resp = await api.signup(handle, pwd);
          if (resp?.error) { alert(`No se pudo registrar: ${resp.error}`); return; }
        } else if (/contrase/i.test(resp.error)) {
          alert('Contraseña incorrecta o requerida para ese alias.'); return;
        } else {
          alert(`No se pudo iniciar sesión: ${resp.error}`); return;
        }
      }
      // Persistir y pintar sin esperar a otra navegación
      writeCachedMe(resp.user);
      paint(resp.user);
      // Revalidar de fondo por si acaso
      refreshMe();
    };

    $('#auth-out').onclick = async () => {
      const r = await api.logout();
      if (r?.error) { alert(`No se pudo cerrar sesión: ${r.error}`); return; }
      writeCachedMe(null);
      paint(null);
    };

    // 4) Sincronizar entre pestañas
    window.addEventListener('storage', (e) => {
      if (e.key === LS_KEY) paint(readCachedMe());
    });

    // Helpers globales
    window.AuthLite = {
      me: async () => readCachedMe() ?? await refreshMe(),
      require: async () => (await window.AuthLite.me()) || (alert('Inicia sesión para continuar'), null),
      login:  api.login,
      logout: async () => { await api.logout(); writeCachedMe(null); paint(null); },
      saveDeck: api.saveDeck,
    };
  }

  if (document.readyState !== 'loading') render();
  else document.addEventListener('DOMContentLoaded', render);
})();
