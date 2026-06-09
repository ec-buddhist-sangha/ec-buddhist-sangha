// site/static/js/auth.js
// window.ECBS.Auth — Google SSO session for the static site. Loads synchronously
// in <head> so getUser()/getToken() are correct before calendar scripts run.
(function () {
  "use strict";
  var ECBS = (window.ECBS = window.ECBS || {});
  var TOKEN_KEY = "ecbs-auth-token";

  function metaContent(name) {
    var meta = document.querySelector('meta[name="' + name + '"]');
    return meta ? meta.getAttribute("content") : "";
  }
  function workerBase() {
    return (metaContent("ecbs:worker-base") || "").replace(/\/+$/, "");
  }
  function siteBase() {
    return metaContent("ecbs:site-base") || "/";
  }
  function sessionStore() {
    try { return window.sessionStorage; } catch (e) { return null; }
  }
  function nowSeconds() { return Math.floor(Date.now() / 1000); }

  function decodePayload(token) {
    try {
      var part = String(token).split(".")[1];
      var b64 = part.replace(/-/g, "+").replace(/_/g, "/");
      var padded = b64 + "===".slice((b64.length + 3) % 4);
      return JSON.parse(decodeURIComponent(escape(window.atob(padded))));
    } catch (e) {
      return null;
    }
  }

  function getToken() {
    var s = sessionStore();
    if (!s) return null;
    var token = s.getItem(TOKEN_KEY);
    if (!token) return null;
    var claims = decodePayload(token);
    if (!claims || (claims.exp != null && nowSeconds() >= claims.exp)) {
      s.removeItem(TOKEN_KEY);
      return null;
    }
    return token;
  }

  function getUser() {
    var token = getToken();
    if (!token) return null;
    var claims = decodePayload(token);
    if (!claims) return null;
    return { email: claims.sub, name: claims.name || claims.sub, role: claims.role || "member" };
  }

  function isSignedIn() { return getUser() !== null; }
  function isAdmin() { var u = getUser(); return Boolean(u && u.role === "admin"); }

  function login() {
    var base = workerBase();
    if (!base) return;
    window.location.href = base + "/auth/login?return_to=" + encodeURIComponent(window.location.href);
  }
  function logout() {
    var s = sessionStore();
    if (s) s.removeItem(TOKEN_KEY);
    renderButtons();
  }

  async function authedFetch(url, options) {
    options = options || {};
    var headers = Object.assign({}, options.headers || {});
    var token = getToken();
    if (token) headers["Authorization"] = "Bearer " + token;
    var res = await window.fetch(url, Object.assign({}, options, { headers: headers }));
    if (res.status === 401) { var s = sessionStore(); if (s) s.removeItem(TOKEN_KEY); }
    return res;
  }

  function consumeHash() {
    var hash = window.location.hash || "";
    if (!hash) return;
    var params = new URLSearchParams(hash.slice(1));
    var token = params.get("token");
    if (token) {
      var s = sessionStore();
      if (s) s.setItem(TOKEN_KEY, token);
      cleanHash();
    } else if (params.get("auth_error")) {
      window.__ecbsAuthError = params.get("auth_error");
      cleanHash();
    }
  }
  function cleanHash() {
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    } else {
      window.location.hash = "";
    }
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

  function renderButtons() {
    var container = document.getElementById("ecbs-auth");
    if (!container) return;
    var user = getUser();
    if (!user) {
      container.innerHTML =
        '<button type="button" data-ecbs-login class="text-[10px] uppercase tracking-tighter border border-white/20 px-3 py-1 rounded-full hover:bg-white/10 transition-colors text-white/70">Sign in</button>';
      var loginBtn = container.querySelector("[data-ecbs-login]");
      if (loginBtn) loginBtn.addEventListener("click", login);
      return;
    }
    var adminLink = user.role === "admin"
      ? '<a href="' + joinPath(siteBase(), "admin/") + '" class="block px-4 py-2 text-sm text-sangha-navy hover:bg-sangha-light">Admin</a>'
      : "";
    container.innerHTML =
      '<div class="relative">' +
        '<button type="button" data-ecbs-toggle class="flex items-center gap-2 text-xs font-bold text-white/90 hover:text-white">' +
          '<span class="w-7 h-7 rounded-full bg-sangha-gold text-sangha-navy flex items-center justify-center">' + escapeHtml(initials(user.name)) + '</span>' +
          '<span class="hidden lg:inline">' + escapeHtml(user.name) + '</span>' +
        '</button>' +
        '<div data-ecbs-dropdown class="hidden absolute right-0 mt-2 w-44 bg-white rounded-lg shadow-lg py-1 z-50">' +
          '<a href="' + joinPath(siteBase(), "calendar/") + '" class="block px-4 py-2 text-sm text-sangha-navy hover:bg-sangha-light">My RSVPs</a>' +
          adminLink +
          '<button type="button" data-ecbs-logout class="block w-full text-left px-4 py-2 text-sm text-sangha-navy hover:bg-sangha-light">Sign out</button>' +
        '</div>' +
      '</div>';
    var toggle = container.querySelector("[data-ecbs-toggle]");
    var dropdown = container.querySelector("[data-ecbs-dropdown]");
    var logoutBtn = container.querySelector("[data-ecbs-logout]");
    if (toggle && dropdown) toggle.addEventListener("click", function () { dropdown.classList.toggle("hidden"); });
    if (logoutBtn) logoutBtn.addEventListener("click", logout);
  }

  // Capture the token immediately (head, pre-body) so later scripts see the session.
  consumeHash();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderButtons);
  } else {
    renderButtons();
  }

  ECBS.Auth = {
    login: login,
    logout: logout,
    getToken: getToken,
    getUser: getUser,
    isAdmin: isAdmin,
    isSignedIn: isSignedIn,
    fetch: authedFetch,
    renderButtons: renderButtons
  };
})();
