// site/static/js/auth.js
// window.ECBS.Auth — Google SSO session for the static site. The site JWT is
// identity-only ({sub,name}); role + request_status come from GET /api/me and
// are cached in sessionStorage. Nav renders once immediately and again when the
// session resolves (ecbs:session event).
(function () {
  "use strict";
  var ECBS = (window.ECBS = window.ECBS || {});
  var TOKEN_KEY = "ecbs-auth-token";
  var SESSION_KEY = "ecbs-auth-session";
  var readyPromise = null;

  function metaContent(name) {
    var meta = document.querySelector('meta[name="' + name + '"]');
    return meta ? meta.getAttribute("content") : "";
  }
  function workerBase() { return (metaContent("ecbs:worker-base") || "").replace(/\/+$/, ""); }
  function siteBase() { return metaContent("ecbs:site-base") || "/"; }
  function sessionStore() { try { return window.sessionStorage; } catch (e) { return null; } }
  function nowSeconds() { return Math.floor(Date.now() / 1000); }

  function clearAuth() {
    var s = sessionStore();
    if (s) { s.removeItem(TOKEN_KEY); s.removeItem(SESSION_KEY); }
  }

  function decodePayload(token) {
    try {
      var part = String(token).split(".")[1];
      var b64 = part.replace(/-/g, "+").replace(/_/g, "/");
      var padded = b64 + "===".slice((b64.length + 3) % 4);
      return JSON.parse(decodeURIComponent(escape(window.atob(padded))));
    } catch (e) { return null; }
  }

  function getToken() {
    var s = sessionStore();
    if (!s) return null;
    var token = s.getItem(TOKEN_KEY);
    if (!token) return null;
    var claims = decodePayload(token);
    if (!claims || (claims.exp != null && nowSeconds() >= claims.exp)) {
      clearAuth();
      return null;
    }
    return token;
  }

  function getSession() {
    var s = sessionStore();
    if (!s) return null;
    var raw = s.getItem(SESSION_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }
  function writeSession(sess) {
    var s = sessionStore();
    if (s) s.setItem(SESSION_KEY, JSON.stringify({ role: sess.role || null, request_status: sess.request_status || "none" }));
  }
  function clearSession() { var s = sessionStore(); if (s) s.removeItem(SESSION_KEY); }

  function getUser() {
    var token = getToken();
    if (!token) return null;
    var claims = decodePayload(token);
    if (!claims) return null;
    var sess = getSession();
    return { email: claims.sub, name: claims.name || claims.sub, role: sess ? sess.role : null };
  }

  function isSignedIn() { return getToken() !== null; }
  function isAdmin() { var sess = getSession(); return Boolean(sess && sess.role === "admin"); }

  function login() {
    var base = workerBase();
    if (!base) return;
    window.location.href = base + "/auth/login?return_to=" + encodeURIComponent(window.location.href);
  }
  function logout() {
    clearAuth();
    readyPromise = null;
    renderButtons();
  }

  async function authedFetch(url, options) {
    options = options || {};
    var headers = Object.assign({}, options.headers || {});
    var token = getToken();
    if (token) headers["Authorization"] = "Bearer " + token;
    var res = await window.fetch(url, Object.assign({}, options, { headers: headers }));
    if (res.status === 401) clearAuth();
    return res;
  }

  function dispatchSession() {
    try {
      var evt = new window.CustomEvent("ecbs:session", { detail: getSession() });
      (window.dispatchEvent || document.dispatchEvent).call(window.dispatchEvent ? window : document, evt);
    } catch (e) { /* no-op in environments without CustomEvent */ }
  }

  async function refreshSession() {
    var base = workerBase();
    if (!getToken() || !base) { clearSession(); renderButtons(); return null; }
    try {
      var res = await authedFetch(base + "/api/me");
      if (!res.ok) { clearSession(); renderButtons(); return null; }
      var data = await res.json();
      writeSession({ role: data.role, request_status: data.request_status });
    } catch (e) {
      // network error: leave any prior cache, render what we have
      renderButtons();
      return getSession();
    }
    renderButtons();
    dispatchSession();
    return getSession();
  }

  function ready() {
    if (!readyPromise) readyPromise = getToken() ? refreshSession() : Promise.resolve(null);
    return readyPromise;
  }

  async function requestAccess() {
    var base = workerBase();
    if (!getToken() || !base) return null;
    var res = await authedFetch(base + "/api/access-request", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}"
    });
    if (!res.ok) return null;
    var data = await res.json();
    await refreshSession();
    return data;
  }

  function consumeHash() {
    var hash = window.location.hash || "";
    if (!hash) return;
    var params = new URLSearchParams(hash.slice(1));
    var token = params.get("token");
    if (token) {
      var s = sessionStore();
      if (s) { s.setItem(TOKEN_KEY, token); s.removeItem(SESSION_KEY); }
      cleanHash();
    } else if (params.get("auth_error")) {
      window.__ecbsAuthError = params.get("auth_error");
      cleanHash();
    }
  }
  function cleanHash() {
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    } else { window.location.hash = ""; }
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function initials(name) {
    return (name || "?").trim().split(/\s+/).map(function (p) { return p.charAt(0); }).slice(0, 2).join("").toUpperCase();
  }
  function joinPath(base, path) { return (base || "/").replace(/\/+$/, "") + "/" + path; }

  // Build the menu item HTML for a signed-in user based on the loaded session.
  function menuItemsFor(user) {
    var link = 'class="block px-4 py-2 text-sm text-sangha-navy hover:bg-sangha-light"';
    var items = '<a href="' + joinPath(siteBase(), "calendar/") + '" ' + link + '>My RSVPs</a>';
    var role = user.role;
    if (role === "admin") {
      items += '<a href="' + joinPath(siteBase(), "account/members/") + '" ' + link + '>Members</a>';
      items += '<a href="' + joinPath(siteBase(), "admin/") + '" ' + link + '>CMS</a>';
    } else if (role === "reader" || role === null) {
      var sess = getSession();
      if (sess && sess.request_status === "pending") {
        items += '<span class="block px-4 py-2 text-sm text-gray-400">Access requested</span>';
      } else if (role === "reader") {
        items += '<button type="button" data-ecbs-request ' + link + ' style="width:100%;text-align:left">Request access</button>';
      }
    }
    items += '<button type="button" data-ecbs-logout ' + link + ' style="width:100%;text-align:left">Sign out</button>';
    return items;
  }

  function wireContainer(container) {
    var loginBtn = container.querySelector("[data-ecbs-login]");
    if (loginBtn) loginBtn.addEventListener("click", login);
    var toggle = container.querySelector("[data-ecbs-toggle]");
    var dropdown = container.querySelector("[data-ecbs-dropdown]");
    if (toggle && dropdown) toggle.addEventListener("click", function () { dropdown.classList.toggle("hidden"); });
    var logoutBtn = container.querySelector("[data-ecbs-logout]");
    if (logoutBtn) logoutBtn.addEventListener("click", logout);
    var requestBtn = container.querySelector("[data-ecbs-request]");
    if (requestBtn) requestBtn.addEventListener("click", function () { requestAccess(); });
  }

  function renderInto(container) {
    if (!container) return;
    var user = getUser();
    if (!user) {
      container.innerHTML =
        '<button type="button" data-ecbs-login class="text-[10px] uppercase tracking-tighter border border-white/20 px-3 py-1 rounded-full hover:bg-white/10 transition-colors text-white/70">Sign in</button>';
      wireContainer(container);
      return;
    }
    container.innerHTML =
      '<div class="relative">' +
        '<button type="button" data-ecbs-toggle class="flex items-center gap-2 text-xs font-bold text-white/90 hover:text-white">' +
          '<span class="w-7 h-7 rounded-full bg-sangha-gold text-sangha-navy flex items-center justify-center">' + escapeHtml(initials(user.name)) + '</span>' +
          '<span class="hidden lg:inline">' + escapeHtml(user.name) + '</span>' +
        '</button>' +
        '<div data-ecbs-dropdown class="hidden absolute right-0 mt-2 w-44 bg-white rounded-lg shadow-lg py-1 z-50">' +
          menuItemsFor(user) +
        '</div>' +
      '</div>';
    wireContainer(container);
  }

  function renderButtons() {
    renderInto(document.getElementById("ecbs-auth"));
    renderInto(document.getElementById("ecbs-auth-mobile"));
  }

  consumeHash();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { renderButtons(); ready(); });
  } else {
    renderButtons();
    ready();
  }

  ECBS.Auth = {
    login: login, logout: logout, getToken: getToken, getUser: getUser,
    getSession: getSession, refreshSession: refreshSession, ready: ready, requestAccess: requestAccess,
    isAdmin: isAdmin, isSignedIn: isSignedIn, fetch: authedFetch, renderButtons: renderButtons
  };
})();
