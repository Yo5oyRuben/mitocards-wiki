(() => {
  if (window.__mitocardsAuthUiLoaded) return;
  window.__mitocardsAuthUiLoaded = true;

  const CACHE_KEY = "mc:me:v2";
  const CACHE_TTL_MS = 5 * 60 * 1000;
  const FALLBACK_AVATAR = {
    id: "alquimista",
    name: "Alquimista",
    url: "/img/cartas/webp_l/alquimista_dibujo.webp",
  };

  const state = {
    user: null,
    avatars: [FALLBACK_AVATAR],
    mode: "login",
    signupAvatarId: FALLBACK_AVATAR.id,
    accountAvatarId: FALLBACK_AVATAR.id,
    suggestions: [],
  };

  let ui = null;
  let inflightMe = null;
  let suggestTimer = null;

  const norm = (v) => String(v ?? "").trim().toLowerCase();
  const cleanHandle = (v) => norm(v).replace(/^@+/, "");

  async function call(url, opt) {
    try {
      const r = await fetch(url, { credentials: "include", ...(opt || {}) });
      const t = await r.text();
      let d = {};
      try {
        d = t ? JSON.parse(t) : {};
      } catch {
        d = { raw: t };
      }
      if (!r.ok) return { ok: false, status: r.status, error: d.error || d.raw || `HTTP ${r.status}`, data: d };
      return { ok: true, status: r.status, data: d };
    } catch (e) {
      return { ok: false, status: 0, error: e?.message || String(e), data: null };
    }
  }

  const api = {
    me: () => call(`/api/auth/me?ts=${Date.now()}`, { cache: "no-store" }),
    login: (handle, password) =>
      call("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle, password }),
      }),
    signup: (handle, password, avatarId) =>
      call("/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle, password, avatarId }),
      }),
    logout: () => call("/api/auth/logout", { method: "POST" }),
    handles: (q, limit = 8) =>
      call(`/api/auth/handles?q=${encodeURIComponent(q)}&limit=${limit}`, {
        cache: "no-store",
      }),
    profile: (payload) =>
      call("/api/auth/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
    changeHandle: (newHandle) =>
      call("/api/auth/change-handle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newHandle }),
      }),
    changePassword: (newPassword) =>
      call("/api/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newPassword }),
      }),
    saveDeck: (deck, visibility = "private") => {
      const hasId = !!deck?.id;
      const url = hasId ? `/api/decks/${encodeURIComponent(deck.id)}` : "/api/decks";
      const method = hasId ? "PUT" : "POST";
      return call(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...deck, visibility }),
      });
    },
  };

  function avatarById(id) {
    return state.avatars.find((a) => a.id === id) || state.avatars[0] || FALLBACK_AVATAR;
  }

  function readCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.ts) return null;
      if (Date.now() - Number(parsed.ts) > CACHE_TTL_MS) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function writeCache() {
    try {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({
          ts: Date.now(),
          user: state.user,
          avatars: state.avatars,
        })
      );
    } catch {}
  }

  function setData(payload, persist = true) {
    const avatars = Array.isArray(payload?.avatars) && payload.avatars.length ? payload.avatars : state.avatars;
    state.avatars = avatars.length ? avatars : [FALLBACK_AVATAR];
    state.user = payload?.user || null;
    state.signupAvatarId = state.signupAvatarId || state.avatars[0].id;
    state.accountAvatarId = state.user?.profile?.avatarId || state.avatars[0].id;

    renderTrigger();
    renderMode();

    if (persist) writeCache();
    window.dispatchEvent(new CustomEvent("mitocards:auth-change", { detail: { user: state.user } }));
  }

  async function refreshMe(force = false) {
    if (!force && inflightMe) return inflightMe;
    inflightMe = (async () => {
      const r = await api.me();
      if (r.ok) setData(r.data, true);
      inflightMe = null;
      return state.user;
    })();
    return inflightMe;
  }

  function showMsg(text, kind = "info") {
    ui.msg.textContent = text || "";
    ui.msg.className = `mc-msg ${kind}`;
    ui.msg.hidden = !text;
  }

  function toast(text, kind = "info") {
    const t = document.createElement("div");
    t.className = `mc-toast ${kind}`;
    t.textContent = text;
    ui.toasts.appendChild(t);
    setTimeout(() => {
      t.classList.add("out");
      setTimeout(() => t.remove(), 220);
    }, 2200);
  }

  function renderAvatarGrid(target, selectedId) {
    target.innerHTML = state.avatars
      .map(
        (a) => `
      <button type="button" class="mc-av ${a.id === selectedId ? "sel" : ""}" data-avatar-id="${a.id}" title="${a.name}">
        <img src="${a.url}" alt="${a.name}" loading="lazy" decoding="async" />
      </button>
    `
      )
      .join("");
  }

  function renderTrigger() {
    if (!ui) return;
    if (state.user) {
      const av = avatarById(state.user?.profile?.avatarId);
      ui.trLabel.textContent = `@${state.user.handle}`;
      ui.trSub.textContent = `${state.user.deckCount ?? 0} mazos`;
      ui.trImg.src = state.user?.profile?.avatarUrl || av.url;
      ui.trImg.hidden = false;
      ui.trGhost.hidden = true;
    } else {
      ui.trLabel.textContent = "Iniciar sesion";
      ui.trSub.textContent = "Login / Crear cuenta";
      ui.trImg.hidden = true;
      ui.trGhost.hidden = false;
    }
  }

  function renderMode() {
    if (!ui) return;
    if (state.mode === "account" && !state.user) state.mode = "login";

    ui.title.textContent = state.mode === "login" ? "Iniciar sesion" : state.mode === "signup" ? "Crear cuenta" : "Tu cuenta";
    ui.login.hidden = state.mode !== "login";
    ui.signup.hidden = state.mode !== "signup";
    ui.account.hidden = state.mode !== "account";

    if (state.mode === "signup") renderAvatarGrid(ui.signupAvatars, state.signupAvatarId);

    if (state.mode === "account" && state.user) {
      const av = avatarById(state.user?.profile?.avatarId);
      ui.accAvatar.src = state.user?.profile?.avatarUrl || av.url;
      ui.accHandle.textContent = `@${state.user.handle}`;
      ui.accDecks.textContent = `${state.user.deckCount ?? 0} mazos`;
      ui.accDisplay.value = state.user?.profile?.displayName || state.user.handle;
      ui.accBio.value = state.user?.profile?.bio || "";
      ui.accHandleInput.value = state.user.handle;
      renderAvatarGrid(ui.accAvatars, state.accountAvatarId);
    }
  }

  function open(mode) {
    state.mode = mode;
    showMsg("");
    renderMode();
    ui.overlay.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function close() {
    ui.overlay.hidden = true;
    document.body.style.overflow = "";
    showMsg("");
    ui.suggest.hidden = true;
    state.suggestions = [];
  }

  function renderSuggestions() {
    if (!state.suggestions.length) {
      ui.suggest.innerHTML = "";
      ui.suggest.hidden = true;
      return;
    }
    ui.suggest.innerHTML = state.suggestions.map((h) => `<button type="button" data-h="${h}">@${h}</button>`).join("");
    ui.suggest.hidden = false;
  }

  function scheduleSuggestions(value) {
    clearTimeout(suggestTimer);
    suggestTimer = setTimeout(async () => {
      const q = cleanHandle(value);
      if (!q) {
        state.suggestions = [];
        renderSuggestions();
        return;
      }
      const r = await api.handles(q);
      state.suggestions = r.ok ? (Array.isArray(r.data?.handles) ? r.data.handles : []) : [];
      renderSuggestions();
    }, 120);
  }

  async function onLoginSubmit(ev) {
    ev.preventDefault();
    showMsg("");
    const handle = cleanHandle(ui.loginHandle.value);
    const password = String(ui.loginPass.value || "");
    if (!handle) return showMsg("Escribe tu usuario", "error");
    if (!password) return showMsg("La password es obligatoria", "error");
    const r = await api.login(handle, password);
    if (!r.ok) return showMsg(r.error || "No se pudo iniciar sesion", "error");
    setData(r.data, true);
    ui.loginPass.value = "";
    close();
    toast("Sesion iniciada", "ok");
  }

  async function onSignupSubmit(ev) {
    ev.preventDefault();
    showMsg("");
    const handle = cleanHandle(ui.signupHandle.value);
    const password = String(ui.signupPass.value || "");
    if (!handle) return showMsg("Escribe un usuario", "error");
    if (!password) return showMsg("La password es obligatoria", "error");
    const r = await api.signup(handle, password, state.signupAvatarId);
    if (!r.ok) return showMsg(r.error || "No se pudo crear la cuenta", "error");
    setData(r.data, true);
    ui.signupPass.value = "";
    close();
    toast("Cuenta creada", "ok");
  }

  async function onProfileSubmit(ev) {
    ev.preventDefault();
    showMsg("");
    const r = await api.profile({
      displayName: ui.accDisplay.value,
      bio: ui.accBio.value,
      avatarId: state.accountAvatarId,
    });
    if (!r.ok) return showMsg(r.error || "No se pudo guardar perfil", "error");
    setData(r.data, true);
    showMsg("Perfil actualizado", "ok");
  }

  async function onHandleSubmit(ev) {
    ev.preventDefault();
    showMsg("");
    const newHandle = cleanHandle(ui.accHandleInput.value);
    if (!newHandle) return showMsg("Usuario invalido", "error");
    const r = await api.changeHandle(newHandle);
    if (!r.ok) return showMsg(r.error || "No se pudo cambiar usuario", "error");
    setData(r.data, true);
    showMsg("Usuario actualizado", "ok");
  }

  async function onPasswordSubmit(ev) {
    ev.preventDefault();
    showMsg("");
    const newPassword = String(ui.accPass.value || "");
    if (!newPassword) return showMsg("La password es obligatoria", "error");
    const r = await api.changePassword(newPassword);
    if (!r.ok) return showMsg(r.error || "No se pudo cambiar password", "error");
    ui.accPass.value = "";
    showMsg("Password actualizada", "ok");
  }

  async function doLogout() {
    const r = await api.logout();
    if (!r.ok) return showMsg(r.error || "No se pudo cerrar sesion", "error");
    setData({ user: null, avatars: state.avatars }, true);
    close();
    toast("Sesion cerrada", "ok");
  }

  function setupUI() {
    const style = document.createElement("style");
    style.textContent = `
      #mc-root{position:fixed;top:12px;right:12px;z-index:12000}
      .mc-trigger{display:flex;align-items:center;gap:9px;min-width:170px;padding:8px;border:1px solid rgba(255,255,255,.2);border-radius:12px;background:rgba(12,15,22,.95);color:#e8efff;cursor:pointer}
      .mc-tr-img,.mc-ghost{width:34px;height:34px;border-radius:8px;object-fit:cover;border:1px solid rgba(255,255,255,.2)}
      .mc-ghost{display:grid;place-items:center;background:#222b3a;font-weight:800}
      .mc-text{display:grid;text-align:left;line-height:1.1}.mc-text b{font-size:13px}.mc-text span{font-size:11px;opacity:.75}
      .mc-overlay{position:fixed;inset:0;z-index:13000;background:rgba(0,0,0,.68);display:grid;place-items:center;padding:12px}
      .mc-overlay[hidden]{display:none !important}
      .mc-panel{width:min(620px,94vw);max-height:92vh;overflow:auto;border-radius:16px;border:1px solid rgba(255,255,255,.2);background:#10161f;color:#edf4ff}
      .mc-head{position:sticky;top:0;display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.15);background:rgba(16,22,31,.95)}
      .mc-head h2{margin:0;font-size:18px}.mc-close{width:32px;height:32px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:#212a39;color:#fff;cursor:pointer}
      .mc-body{padding:14px;display:grid;gap:10px}
      .mc-msg{padding:8px 10px;border:1px solid rgba(255,255,255,.2);border-radius:10px}.mc-msg.error{background:rgba(120,30,40,.3)}.mc-msg.ok{background:rgba(30,95,50,.28)}
      .mc-form{display:grid;gap:9px}.mc-form label{display:grid;gap:5px;font-size:13px}.mc-form input,.mc-form textarea{width:100%;border:1px solid rgba(255,255,255,.18);border-radius:9px;padding:9px;background:#182130;color:#edf4ff}
      .mc-form textarea{min-height:72px;resize:vertical}
      .mc-row{display:flex;gap:8px;flex-wrap:wrap}.mc-btn{padding:8px 11px;border-radius:9px;border:1px solid rgba(255,255,255,.2);background:#222d3f;color:#edf4ff;font-weight:700;cursor:pointer}.mc-btn.pri{background:#2a5f9f}.mc-btn.warn{background:#4a2a2c}
      .mc-suggest{border:1px solid rgba(255,255,255,.18);border-radius:9px;overflow:auto;max-height:160px;background:#141c28}.mc-suggest button{display:block;width:100%;padding:8px 10px;text-align:left;background:transparent;border:0;border-bottom:1px solid rgba(255,255,255,.07);color:#eef4ff;cursor:pointer}
      .mc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(56px,1fr));gap:7px}.mc-av{padding:0;aspect-ratio:1/1;border:2px solid rgba(255,255,255,.14);border-radius:8px;overflow:hidden;background:#111826;cursor:pointer}.mc-av.sel{border-color:#8ec7ff}.mc-av img{width:100%;height:100%;object-fit:cover}
      .mc-card{display:grid;grid-template-columns:auto 1fr;gap:10px;align-items:center;padding:10px;border:1px solid rgba(255,255,255,.16);border-radius:10px;background:rgba(255,255,255,.03)}
      .mc-card img{width:60px;height:60px;border-radius:8px;object-fit:cover;border:1px solid rgba(255,255,255,.2)}
      .mc-toasts{position:fixed;top:60px;right:12px;z-index:14000;display:grid;gap:7px}.mc-toast{padding:8px 10px;border-radius:9px;background:#1d2737;border:1px solid rgba(255,255,255,.18);color:#eef4ff;transition:.2s}.mc-toast.ok{border-color:rgba(120,220,145,.45)}.mc-toast.out{opacity:0;transform:translateY(-4px)}
    `;
    document.head.appendChild(style);

    const root = document.createElement("div");
    root.id = "mc-root";
    root.innerHTML = `
      <button id="mcTrigger" class="mc-trigger" type="button">
        <img id="mcTrImg" class="mc-tr-img" src="" alt="avatar" hidden />
        <div id="mcGhost" class="mc-ghost">?</div>
        <div class="mc-text"><b id="mcTrLabel">Iniciar sesion</b><span id="mcTrSub">Login / Crear cuenta</span></div>
      </button>
      <div id="mcOverlay" class="mc-overlay" hidden>
        <div class="mc-panel" role="dialog" aria-modal="true" aria-label="Cuenta">
          <div class="mc-head"><h2 id="mcTitle">Iniciar sesion</h2><button id="mcClose" class="mc-close" type="button">X</button></div>
          <div class="mc-body">
            <div id="mcMsg" class="mc-msg" hidden></div>
            <section id="mcLogin">
              <form id="mcLoginForm" class="mc-form">
                <label>Usuario<input id="mcLoginHandle" type="text" autocomplete="off" placeholder="@usuario" /></label>
                <div id="mcSuggest" class="mc-suggest" hidden></div>
                <label>Password<input id="mcLoginPass" type="password" autocomplete="current-password" placeholder="Password" /></label>
                <div class="mc-row"><button class="mc-btn pri" type="submit">Entrar</button><button id="mcToSignup" class="mc-btn" type="button">Crear cuenta</button></div>
              </form>
            </section>
            <section id="mcSignup" hidden>
              <form id="mcSignupForm" class="mc-form">
                <label>Nuevo usuario<input id="mcSignupHandle" type="text" autocomplete="off" placeholder="@nuevo_usuario" /></label>
                <label>Password<input id="mcSignupPass" type="password" autocomplete="new-password" placeholder="Password" /></label>
                <div><div style="margin-bottom:5px;font-size:13px">Foto de perfil</div><div id="mcSignupAvatars" class="mc-grid"></div></div>
                <div class="mc-row"><button class="mc-btn pri" type="submit">Crear y entrar</button><button id="mcToLogin" class="mc-btn" type="button">Ya tengo cuenta</button></div>
              </form>
            </section>
            <section id="mcAccount" hidden>
              <div class="mc-card"><img id="mcAccAvatar" src="" alt="avatar" /><div><div id="mcAccHandle" style="font-weight:900"></div><div id="mcAccDecks" style="font-size:12px;opacity:.75"></div></div></div>
              <form id="mcProfileForm" class="mc-form" style="margin-top:8px">
                <label>Nombre visible<input id="mcAccDisplay" type="text" placeholder="Nombre visible" /></label>
                <label>Bio<textarea id="mcAccBio" placeholder="Bio (opcional)"></textarea></label>
                <div><div style="margin-bottom:5px;font-size:13px">Foto de perfil</div><div id="mcAccAvatars" class="mc-grid"></div></div>
                <div class="mc-row"><button class="mc-btn pri" type="submit">Guardar perfil</button></div>
              </form>
              <form id="mcHandleForm" class="mc-form" style="margin-top:8px">
                <label>Cambiar usuario<input id="mcAccHandleInput" type="text" placeholder="nuevo_usuario" /></label>
                <div class="mc-row"><button class="mc-btn" type="submit">Guardar usuario</button></div>
              </form>
              <form id="mcPassForm" class="mc-form" style="margin-top:8px">
                <label>Nueva password<input id="mcAccPass" type="password" autocomplete="new-password" placeholder="Nueva password" /></label>
                <div class="mc-row"><button class="mc-btn" type="submit">Cambiar password</button></div>
              </form>
              <div class="mc-row" style="margin-top:8px"><button id="mcLogout" class="mc-btn warn" type="button">Cerrar sesion</button></div>
            </section>
          </div>
        </div>
      </div>
      <div id="mcToasts" class="mc-toasts"></div>
    `;
    document.body.appendChild(root);

    ui = {
      overlay: root.querySelector("#mcOverlay"),
      title: root.querySelector("#mcTitle"),
      msg: root.querySelector("#mcMsg"),
      toasts: root.querySelector("#mcToasts"),
      trLabel: root.querySelector("#mcTrLabel"),
      trSub: root.querySelector("#mcTrSub"),
      trImg: root.querySelector("#mcTrImg"),
      trGhost: root.querySelector("#mcGhost"),
      login: root.querySelector("#mcLogin"),
      signup: root.querySelector("#mcSignup"),
      account: root.querySelector("#mcAccount"),
      loginHandle: root.querySelector("#mcLoginHandle"),
      loginPass: root.querySelector("#mcLoginPass"),
      suggest: root.querySelector("#mcSuggest"),
      signupHandle: root.querySelector("#mcSignupHandle"),
      signupPass: root.querySelector("#mcSignupPass"),
      signupAvatars: root.querySelector("#mcSignupAvatars"),
      accAvatar: root.querySelector("#mcAccAvatar"),
      accHandle: root.querySelector("#mcAccHandle"),
      accDecks: root.querySelector("#mcAccDecks"),
      accDisplay: root.querySelector("#mcAccDisplay"),
      accBio: root.querySelector("#mcAccBio"),
      accAvatars: root.querySelector("#mcAccAvatars"),
      accHandleInput: root.querySelector("#mcAccHandleInput"),
      accPass: root.querySelector("#mcAccPass"),
    };

    root.querySelector("#mcTrigger").addEventListener("click", () => open(state.user ? "account" : "login"));
    root.querySelector("#mcClose").addEventListener("click", close);
    ui.overlay.addEventListener("click", (ev) => {
      if (ev.target === ui.overlay) close();
    });
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && !ui.overlay.hidden) close();
    });

    root.querySelector("#mcToSignup").addEventListener("click", () => {
      state.mode = "signup";
      showMsg("");
      renderMode();
    });
    root.querySelector("#mcToLogin").addEventListener("click", () => {
      state.mode = "login";
      showMsg("");
      renderMode();
    });

    root.querySelector("#mcLoginForm").addEventListener("submit", onLoginSubmit);
    root.querySelector("#mcSignupForm").addEventListener("submit", onSignupSubmit);
    root.querySelector("#mcProfileForm").addEventListener("submit", onProfileSubmit);
    root.querySelector("#mcHandleForm").addEventListener("submit", onHandleSubmit);
    root.querySelector("#mcPassForm").addEventListener("submit", onPasswordSubmit);
    root.querySelector("#mcLogout").addEventListener("click", doLogout);

    ui.loginHandle.addEventListener("input", () => scheduleSuggestions(ui.loginHandle.value));
    ui.loginHandle.addEventListener("focus", () => scheduleSuggestions(ui.loginHandle.value));
    ui.loginHandle.addEventListener("blur", () => {
      setTimeout(() => {
        ui.suggest.hidden = true;
      }, 120);
    });
    ui.suggest.addEventListener("click", (ev) => {
      const btn = ev.target.closest("button[data-h]");
      if (!btn) return;
      ui.loginHandle.value = btn.dataset.h || "";
      ui.suggest.hidden = true;
      ui.loginPass.focus();
    });
    ui.signupAvatars.addEventListener("click", (ev) => {
      const btn = ev.target.closest("button[data-avatar-id]");
      if (!btn) return;
      state.signupAvatarId = btn.dataset.avatarId || state.signupAvatarId;
      renderAvatarGrid(ui.signupAvatars, state.signupAvatarId);
    });
    ui.accAvatars.addEventListener("click", (ev) => {
      const btn = ev.target.closest("button[data-avatar-id]");
      if (!btn) return;
      state.accountAvatarId = btn.dataset.avatarId || state.accountAvatarId;
      renderAvatarGrid(ui.accAvatars, state.accountAvatarId);
    });
  }

  function setupGlobalApi() {
    window.AuthLite = {
      me: async () => state.user || (await refreshMe(true)),
      require: async () => {
        const user = await window.AuthLite.me();
        if (user) return user;
        open("login");
        toast("Inicia sesion para continuar", "warn");
        return null;
      },
      login: async (handle, password) => {
        const r = await api.login(cleanHandle(handle), String(password || ""));
        if (!r.ok) return { error: r.error, status: r.status };
        setData(r.data, true);
        return { ok: true, user: state.user };
      },
      signup: async (handle, password, avatarId) => {
        const r = await api.signup(cleanHandle(handle), String(password || ""), avatarId || state.signupAvatarId);
        if (!r.ok) return { error: r.error, status: r.status };
        setData(r.data, true);
        return { ok: true, user: state.user };
      },
      logout: async () => {
        const r = await api.logout();
        if (!r.ok) return { error: r.error, status: r.status };
        setData({ user: null, avatars: state.avatars }, true);
        return { ok: true };
      },
      saveDeck: async (deck, visibility = "private") => {
        const r = await api.saveDeck(deck, visibility);
        if (!r.ok) return { error: r.error, status: r.status };
        return r.data;
      },
      open: (mode = "login") => open(mode),
      refresh: () => refreshMe(true),
    };
  }

  function boot() {
    setupUI();
    setupGlobalApi();

    const cached = readCache();
    if (cached) setData(cached, false);
    else setData({ user: null, avatars: [FALLBACK_AVATAR] }, false);

    refreshMe(true);

    window.addEventListener("storage", (ev) => {
      if (ev.key !== CACHE_KEY || !ev.newValue) return;
      try {
        const parsed = JSON.parse(ev.newValue);
        if (parsed) setData(parsed, false);
      } catch {}
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
