# Membership Site UI — Implementation Plan (Plan 02)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the Hugo site so `ECBS.Auth` gets the user's role + request-status from the worker's `/api/me` (the JWT is now identity-only), shows reader/member/admin-appropriate nav (including a self-service "Request access" control), and adds an admin-only `/account/members` panel for approving requests and assigning roles.

**Architecture:** `site/static/js/auth.js` gains an async "session" loaded from `GET /api/me` and cached in `sessionStorage`; `getUser().role` and `isAdmin()` read that cache instead of the (now absent) JWT `role` claim. Nav renders reactively — an initial paint, then a re-paint when the session resolves (`ecbs:session` event). `calendar.js` listens for that event to re-render once the role is known. A new static page `/account/members` drives the admin membership APIs.

**Tech Stack:** Hugo (layouts/partials, `menu`/`params` in `hugo.yaml`), vanilla browser JS (IIFE, `var`/`function` style — no build step, no TypeScript), Node's built-in test runner (`node --test`) with a `vm` sandbox for JS units, Tailwind classes already compiled to `css/output.css`.

## Global Constraints

- Frontend JS matches the existing style in `site/static/js/auth.js`: an IIFE on `window.ECBS`, ES5-compatible (`var`, `function`, no arrow/async-only APIs except `async/await`/`fetch` which the existing code already uses), no bundler, no TypeScript.
- The worker base URL comes from `<meta name="ecbs:worker-base">` (value `hugo.yaml` `params.calendarApiBase`); the site base from `<meta name="ecbs:site-base">`. `auth.js` already reads both.
- Worker endpoints consumed: `GET /api/me` → `{sub,name,role,request_status}`; `POST /api/access-request` → `{status}`; `GET /api/members` → `{members:[],pending:[]}`; `POST /api/members/approve|deny` → `{ok:true}` body `{email}`; `POST /api/members/role` → `{ok:true}` body `{email,role}`. All require `Authorization: Bearer <token>` (attach via `ECBS.Auth.fetch`).
- Roles are exactly `reader`, `member`, `admin`; request statuses exactly `none`, `pending`, `denied`.
- The admin membership panel lives at `/account/members` — NOT `/admin` (that path is Decap CMS).
- JS unit tests run from `site/`: `node --test tests/auth.test.js` (and any new test file). NOTE: `tests/calendar.test.js` has ~11 PRE-EXISTING date-coupled failures unrelated to this work — do not attempt to fix them and do not treat them as regressions; run the specific test file(s) for the task, not the whole `npm test`, when judging green.
- Hugo build must succeed: from `site/`, `hugo --gc --minify` (or `hugo`) exits 0 with no template errors. For local viewing use `hugo server -D --baseURL "http://127.0.0.1:1313/"`.
- Every commit message ends with the trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

## File Structure

- Modify `site/static/js/auth.js` — add the session model (`getSession`, `refreshSession`, `ready`, `requestAccess`), source `role` from the session cache, render reader/member/admin nav states into both desktop and mobile containers.
- Modify `site/tests/auth.test.js` — the `load()` harness gains an `/api/me` fetch mock and a `ready()` await; existing role assertions move from token-claim to `/api/me`-sourced; new tests for session refresh, request-access, and nav states.
- Modify `site/layouts/partials/header.html` — drop the brittle `innerHTML`-copy script; let `renderButtons()` populate both `#ecbs-auth` and `#ecbs-auth-mobile` with wired handlers.
- Modify `site/static/js/calendar.js` — re-render the calendar when `ecbs:session` fires so the admin view appears once the role loads.
- Create `site/content/account/members.md` + `site/layouts/account/members.html` + `site/static/js/members-admin.js` — the admin membership panel.
- Create `site/tests/members-admin.test.js` — unit tests for the panel's pure render/orchestration helpers.

---

### Task 1: Session model + role from `/api/me` in `auth.js`

**Files:**
- Modify: `site/static/js/auth.js`
- Modify: `site/tests/auth.test.js`

**Interfaces:**
- Produces on `window.ECBS.Auth`: `getSession() -> {role, request_status}|null` (sync, from cache); `refreshSession() -> Promise<session|null>` (GET `/api/me`, caches, re-renders, dispatches `ecbs:session`); `ready() -> Promise<session|null>` (resolves after the initial refresh, or immediately when signed out); `requestAccess() -> Promise<{status}|null>` (POST `/api/access-request`, then refresh). `getUser()` now returns `{email, name, role}` with `role` from the session cache (`null` until loaded — never a false default). `isAdmin()` reads the session cache.

- [ ] **Step 1: Update the test harness and write failing tests**

Replace `site/tests/auth.test.js` with the following. It adds an `/api/me` fetch to `load()`, a `document.dispatchEvent`/`addEventListener` stub so `ecbs:session` doesn't throw, and both migrated and new tests.

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function makeToken(claims) {
  return b64url({ alg: "HS256", typ: "JWT" }) + "." + b64url(claims) + ".sig";
}

function load(options = {}) {
  const sessionData = new Map();
  const metas = {
    'meta[name="ecbs:worker-base"]': { getAttribute: () => options.workerBase ?? "https://worker.test" },
    'meta[name="ecbs:site-base"]': { getAttribute: () => options.siteBase ?? "/" }
  };
  const container = { innerHTML: "", querySelector: () => null, querySelectorAll: () => [] };
  const location = { href: options.href || "https://eauclairesangha.org/calendar/", hash: options.hash || "", pathname: "/calendar/", search: "" };
  const events = [];
  const context = {
    URLSearchParams, console, atob: (s) => Buffer.from(s, "base64").toString("binary"), escape, unescape, decodeURIComponent, encodeURIComponent, JSON, Math, Date, Promise, Object,
    window: {
      fetch: options.fetch,
      atob: (s) => Buffer.from(s, "base64").toString("binary"),
      location,
      history: { replaceState: (a, b, url) => { location.replacedTo = url; } },
      dispatchEvent: (e) => { events.push(e); return true; },
      addEventListener: () => {},
      CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
      sessionStorage: {
        getItem: (k) => (sessionData.has(k) ? sessionData.get(k) : null),
        setItem: (k, v) => sessionData.set(k, String(v)),
        removeItem: (k) => sessionData.delete(k)
      }
    },
    document: {
      readyState: "complete",
      addEventListener: () => {},
      dispatchEvent: (e) => { events.push(e); return true; },
      getElementById: (id) => (id === "ecbs-auth" ? container : null),
      querySelector: (sel) => metas[sel] || null
    }
  };
  context.window.window = context.window;
  context.window.document = context.document;
  vm.createContext(context);
  const scriptPath = path.join(__dirname, "..", "static", "js", "auth.js");
  vm.runInContext(fs.readFileSync(scriptPath, "utf8"), context, { filename: scriptPath });
  return { Auth: context.window.ECBS.Auth, sessionData, location, events };
}

// Fetch stub that answers /api/me with the given session, and records calls.
function apiFetch(session, opts = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/api/me")) {
      if (opts.meStatus && opts.meStatus !== 200) return new Response("", { status: opts.meStatus });
      return new Response(JSON.stringify(session), { status: 200 });
    }
    if (String(url).endsWith("/api/access-request")) {
      return new Response(JSON.stringify({ status: opts.requestStatus || "pending" }), { status: 200 });
    }
    return new Response("", { status: 404 });
  };
  fn.calls = calls;
  return fn;
}

const future = () => Math.floor(Date.now() / 1000) + 600;

test("getUser is null when no token is stored", () => {
  assert.equal(load().Auth.getUser(), null);
});

test("getUser role comes from /api/me, not the token", async () => {
  const fetch = apiFetch({ sub: "mem@x.org", name: "Mem", role: "member", request_status: "none" });
  const { Auth } = load({ hash: "#token=" + makeToken({ sub: "mem@x.org", name: "Mem", exp: future() }), fetch });
  await Auth.ready();
  const user = Auth.getUser();
  assert.equal(user.email, "mem@x.org");
  assert.equal(user.role, "member");
  assert.ok(fetch.calls.some((c) => c.url.endsWith("/api/me")));
});

test("isAdmin reflects the /api/me role", async () => {
  const fetch = apiFetch({ sub: "boss@x.org", name: "Boss", role: "admin", request_status: "none" });
  const { Auth } = load({ hash: "#token=" + makeToken({ sub: "boss@x.org", name: "Boss", exp: future() }), fetch });
  await Auth.ready();
  assert.equal(Auth.isAdmin(), true);
});

test("getSession exposes role + request_status and getUser.role is null before refresh", async () => {
  const fetch = apiFetch({ sub: "r@x.org", name: "R", role: "reader", request_status: "pending" });
  const { Auth } = load({ hash: "#token=" + makeToken({ sub: "r@x.org", name: "R", exp: future() }), fetch });
  assert.equal(Auth.getSession(), null);       // not loaded yet
  assert.equal(Auth.getUser().role, null);     // no false "member" default
  await Auth.ready();
  assert.deepEqual(Auth.getSession(), { role: "reader", request_status: "pending" });
});

test("refresh dispatches an ecbs:session event", async () => {
  const fetch = apiFetch({ sub: "r@x.org", name: "R", role: "reader", request_status: "none" });
  const { Auth, events } = load({ hash: "#token=" + makeToken({ sub: "r@x.org", name: "R", exp: future() }), fetch });
  await Auth.ready();
  assert.ok(events.some((e) => e.type === "ecbs:session"));
});

test("a 401 from /api/me clears the token", async () => {
  const fetch = apiFetch({}, { meStatus: 401 });
  const { Auth, sessionData } = load({ hash: "#token=" + makeToken({ sub: "x@x.org", name: "X", exp: future() }), fetch });
  await Auth.ready();
  assert.equal(Auth.getToken(), null);
  assert.equal(sessionData.has("ecbs-auth-token"), false);
});

test("requestAccess posts and refreshes to pending", async () => {
  const fetch = apiFetch({ sub: "r@x.org", name: "R", role: "reader", request_status: "none" }, { requestStatus: "pending" });
  const { Auth } = load({ hash: "#token=" + makeToken({ sub: "r@x.org", name: "R", exp: future() }), fetch });
  await Auth.ready();
  // after the request, /api/me should now report pending
  fetch.calls.length = 0;
  const meAfter = apiFetch({ sub: "r@x.org", name: "R", role: "reader", request_status: "pending" });
  Auth.__setFetchForTest && Auth.__setFetchForTest(meAfter); // no-op if not provided; see note
  const res = await Auth.requestAccess();
  assert.equal(res.status, "pending");
});

test("ready resolves immediately when signed out", async () => {
  const { Auth } = load();
  assert.equal(await Auth.ready(), null);
});

test("login redirects to the Worker with a return_to", () => {
  const { Auth, location } = load({ href: "https://eauclairesangha.org/calendar/" });
  Auth.login();
  assert.ok(location.href.startsWith("https://worker.test/auth/login?return_to="));
});

test("fetch attaches the bearer token and clears it on 401", async () => {
  let seenAuth;
  const fetchImpl = async (url, opts) => { seenAuth = opts.headers.Authorization; return new Response("", { status: 401 }); };
  const { Auth, sessionData } = load({ hash: "#token=" + makeToken({ sub: "x@x.org", name: "X", exp: future() }), fetch: fetchImpl });
  await Auth.fetch("https://worker.test/api/x");
  assert.ok(seenAuth.startsWith("Bearer "));
  assert.equal(sessionData.has("ecbs-auth-token"), false);
});
```

Note on the `requestAccess` test: it does not depend on `__setFetchForTest` (that line is a guarded no-op) — it only asserts the POST response `{status:"pending"}` is returned. Keep it simple; do not add a test-only setter to production code.

- [ ] **Step 2: Run tests to verify they fail**

Run (from `site/`): `node --test tests/auth.test.js`
Expected: FAIL — `Auth.ready`/`getSession`/`refreshSession`/`requestAccess` are undefined and `getUser().role` is `"member"` (old default), so the new assertions fail.

- [ ] **Step 3: Rewrite `site/static/js/auth.js`**

Replace the file with:

```js
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
      s.removeItem(TOKEN_KEY);
      s.removeItem(SESSION_KEY);
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
    if (s) s.setItem(SESSION_KEY, JSON.stringify({ role: sess.role, request_status: sess.request_status }));
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
    var s = sessionStore();
    if (s) { s.removeItem(TOKEN_KEY); s.removeItem(SESSION_KEY); }
    renderButtons();
  }

  async function authedFetch(url, options) {
    options = options || {};
    var headers = Object.assign({}, options.headers || {});
    var token = getToken();
    if (token) headers["Authorization"] = "Bearer " + token;
    var res = await window.fetch(url, Object.assign({}, options, { headers: headers }));
    if (res.status === 401) { var s = sessionStore(); if (s) { s.removeItem(TOKEN_KEY); s.removeItem(SESSION_KEY); } }
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `site/`): `node --test tests/auth.test.js`
Expected: PASS (all tests). Output should be clean.

- [ ] **Step 5: Commit**

```bash
git add site/static/js/auth.js site/tests/auth.test.js
git commit -m "feat(site): ECBS.Auth session from /api/me (identity-only JWT)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Wire nav into both desktop and mobile containers

**Files:**
- Modify: `site/layouts/partials/header.html`

**Interfaces:**
- Consumes: `ECBS.Auth.renderButtons()` (Task 1), which now populates both `#ecbs-auth` and `#ecbs-auth-mobile` and wires handlers in each.

- [ ] **Step 1: Replace the brittle auth mirror script**

In `site/layouts/partials/header.html`, the trailing `<script>` currently copies `desktopAuth.innerHTML` into the mobile container (which produces dead, unwired buttons on mobile). Replace ONLY the auth portion of that script so it calls `renderButtons()` (which now fills both containers with wired handlers). Change the script block (lines ~48-63) to:

```html
  <script>
    document.getElementById('mobile-menu-btn').addEventListener('click', function() {
      var menu = document.getElementById('mobile-menu');
      var expanded = this.getAttribute('aria-expanded') === 'true';
      menu.classList.toggle('hidden');
      this.setAttribute('aria-expanded', !expanded);
    });
    if (window.ECBS && window.ECBS.Auth) {
      window.ECBS.Auth.renderButtons();
    }
  </script>
```

(The `#ecbs-auth` and `#ecbs-auth-mobile` divs stay as-is. `renderButtons()` handles both; the mobile menu-toggle behavior is unchanged.)

- [ ] **Step 2: Verify the Hugo build compiles**

Run (from `site/`): `hugo --gc --minify`
Expected: exits 0, no template errors, `public/` regenerated.

- [ ] **Step 3: Commit**

```bash
git add site/layouts/partials/header.html
git commit -m "feat(site): render auth nav into desktop + mobile via renderButtons

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Re-render the calendar when the session loads

**Files:**
- Modify: `site/static/js/calendar.js`

**Interfaces:**
- Consumes: the `ecbs:session` event dispatched by `ECBS.Auth.refreshSession()` (Task 1). The calendar's existing `getUser().role` checks (`syncStoreToServer`, `hasCalendarAdminAccess`) then see the correct role.

- [ ] **Step 1: Add a session-aware re-render**

In `site/static/js/calendar.js`, find the bootstrap block near the end:

```js
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot);
    } else {
      boot();
    }
  }
```

Immediately AFTER that block, add:

```js
  if (typeof window !== "undefined" && window.addEventListener) {
    // Role arrives asynchronously from /api/me; re-render once it does so the
    // admin view (or member controls) reflects the resolved role.
    window.addEventListener("ecbs:session", function () {
      var root = typeof document !== "undefined" ? document.getElementById("calendar-app") : null;
      if (root) renderForView(root, root.getAttribute("data-calendar-view"));
    });
  }
```

(`renderForView` is already defined in this IIFE — it is called the same way at the existing line ~228.)

- [ ] **Step 2: Verify the Hugo build still compiles and calendar JS loads**

Run (from `site/`): `hugo --gc --minify`
Expected: exits 0.
Then a syntax sanity check on the changed file: `node --check static/js/calendar.js`
Expected: no output (valid JS).

- [ ] **Step 3: Commit**

```bash
git add site/static/js/calendar.js
git commit -m "feat(site): re-render calendar on ecbs:session (async role)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `/account/members` admin panel

**Files:**
- Create: `site/content/account/members.md`
- Create: `site/layouts/account/members.html`
- Create: `site/static/js/members-admin.js`
- Create: `site/tests/members-admin.test.js`

**Interfaces:**
- Consumes: `ECBS.Auth.ready()`, `ECBS.Auth.isAdmin()`, `ECBS.Auth.fetch()` (Task 1); worker endpoints `GET /api/members`, `POST /api/members/approve|deny|role`.
- Produces on `window.ECBS.MembersAdmin`: `renderMembersHtml(data) -> string` (pure; builds the panel markup from `{members, pending}`); `init(root, deps)` (wires data load + button handlers; `deps` defaults to `ECBS.Auth`, injectable for tests).

- [ ] **Step 1: Write failing tests for the pure render**

`site/tests/members-admin.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function load() {
  const context = { window: {}, document: { getElementById: () => null }, console, JSON, Object, Array, String };
  context.window.window = context.window;
  vm.createContext(context);
  const p = path.join(__dirname, "..", "static", "js", "members-admin.js");
  vm.runInContext(fs.readFileSync(p, "utf8"), context, { filename: p });
  return context.window.ECBS.MembersAdmin;
}

test("renderMembersHtml lists pending requests with approve/deny actions", () => {
  const html = load().renderMembersHtml({
    pending: [{ email: "p@x.org", name: "Pat" }],
    members: [{ email: "p@x.org", name: "Pat", role: "reader", request_status: "pending" }]
  });
  assert.ok(html.includes("p@x.org"));
  assert.ok(html.includes('data-approve="p@x.org"'));
  assert.ok(html.includes('data-deny="p@x.org"'));
});

test("renderMembersHtml renders a role selector per member", () => {
  const html = load().renderMembersHtml({
    pending: [],
    members: [{ email: "m@x.org", name: "Mem", role: "member", request_status: "none" }]
  });
  assert.ok(html.includes('data-role-email="m@x.org"'));
  assert.ok(html.includes("reader") && html.includes("member") && html.includes("admin"));
  // current role preselected
  assert.ok(html.includes('value="member" selected'));
});

test("renderMembersHtml shows an empty-state when there are no pending requests", () => {
  const html = load().renderMembersHtml({ pending: [], members: [] });
  assert.ok(/no pending/i.test(html));
});

test("escapes member-provided values", () => {
  const html = load().renderMembersHtml({
    pending: [],
    members: [{ email: "x@x.org", name: "<script>bad</script>", role: "reader", request_status: "none" }]
  });
  assert.ok(!html.includes("<script>bad"));
  assert.ok(html.includes("&lt;script&gt;"));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `site/`): `node --test tests/members-admin.test.js`
Expected: FAIL — `members-admin.js` does not exist.

- [ ] **Step 3: Write `site/static/js/members-admin.js`**

```js
// site/static/js/members-admin.js
// Admin-only membership panel for /account/members. Renders the pending queue
// (approve/deny) and the full member list (role assignment), driven by the
// worker's /api/members endpoints. All role gating is enforced server-side; the
// client checks isAdmin() only to render the right view.
(function () {
  "use strict";
  var ECBS = (window.ECBS = window.ECBS || {});
  var ROLES = ["reader", "member", "admin"];

  function workerBase() {
    var meta = typeof document !== "undefined" ? document.querySelector('meta[name="ecbs:worker-base"]') : null;
    return meta ? (meta.getAttribute("content") || "").replace(/\/+$/, "") : "";
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function roleSelect(member) {
    var opts = ROLES.map(function (r) {
      return '<option value="' + r + '"' + (member.role === r ? " selected" : "") + ">" + r + "</option>";
    }).join("");
    return '<select data-role-email="' + esc(member.email) + '" class="border border-gray-300 rounded px-2 py-1 text-sm">' + opts + "</select>";
  }

  function renderMembersHtml(data) {
    var pending = (data && data.pending) || [];
    var members = (data && data.members) || [];
    var pendingRows = pending.length
      ? pending.map(function (m) {
          return '<li class="flex items-center justify-between gap-3 py-2 border-b border-gray-100">' +
            '<span class="text-sm text-sangha-navy">' + esc(m.name || m.email) + ' &lt;' + esc(m.email) + '&gt;</span>' +
            '<span class="flex gap-2">' +
              '<button type="button" data-approve="' + esc(m.email) + '" class="rounded bg-sangha-navy text-white text-xs px-3 py-1">Approve</button>' +
              '<button type="button" data-deny="' + esc(m.email) + '" class="rounded border border-gray-300 text-xs px-3 py-1">Deny</button>' +
            '</span></li>';
        }).join("")
      : '<li class="py-2 text-sm text-gray-500">No pending requests.</li>';
    var memberRows = members.length
      ? members.map(function (m) {
          return '<li class="flex items-center justify-between gap-3 py-2 border-b border-gray-100">' +
            '<span class="text-sm text-sangha-navy">' + esc(m.name || m.email) + ' &lt;' + esc(m.email) + '&gt;</span>' +
            roleSelect(m) + '</li>';
        }).join("")
      : '<li class="py-2 text-sm text-gray-500">No members yet.</li>';
    return '' +
      '<div class="bg-white rounded-xl border border-gray-200 p-6 mb-8">' +
        '<h2 class="font-serif text-xl font-bold text-sangha-navy mb-4">Pending requests</h2>' +
        '<ul>' + pendingRows + '</ul>' +
      '</div>' +
      '<div class="bg-white rounded-xl border border-gray-200 p-6">' +
        '<h2 class="font-serif text-xl font-bold text-sangha-navy mb-4">Members</h2>' +
        '<ul>' + memberRows + '</ul>' +
      '</div>';
  }

  function deny() { return "Only administrators can view this page."; }

  async function init(root, deps) {
    var auth = deps || ECBS.Auth;
    if (!root || !auth) return;
    await auth.ready();
    if (!auth.isAdmin()) {
      root.innerHTML = '<div class="bg-white rounded-xl border border-gray-200 p-6 text-sm text-gray-600">' + deny() + "</div>";
      return;
    }
    var base = workerBase();
    async function load() {
      var res = await auth.fetch(base + "/api/members");
      if (!res.ok) { root.innerHTML = '<p class="text-sm text-red-600">Failed to load members.</p>'; return; }
      root.innerHTML = renderMembersHtml(await res.json());
      wire();
    }
    async function post(path, body) {
      await auth.fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      await load();
    }
    function wire() {
      root.querySelectorAll("[data-approve]").forEach(function (b) {
        b.addEventListener("click", function () { post("/api/members/approve", { email: b.getAttribute("data-approve") }); });
      });
      root.querySelectorAll("[data-deny]").forEach(function (b) {
        b.addEventListener("click", function () { post("/api/members/deny", { email: b.getAttribute("data-deny") }); });
      });
      root.querySelectorAll("[data-role-email]").forEach(function (sel) {
        sel.addEventListener("change", function () { post("/api/members/role", { email: sel.getAttribute("data-role-email"), role: sel.value }); });
      });
    }
    await load();
  }

  ECBS.MembersAdmin = { renderMembersHtml: renderMembersHtml, init: init };

  if (typeof document !== "undefined") {
    var start = function () {
      var root = document.getElementById("ecbs-members-app");
      if (root) init(root);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
  }
})();
```

NOTE: `workerBase()` mirrors `auth.js`'s meta-reading approach (read `meta[name="ecbs:worker-base"]`, strip trailing slashes, guard when absent). After writing the file, confirm `node --check static/js/members-admin.js` passes.

- [ ] **Step 4: Run the unit tests to verify they pass**

Run (from `site/`): `node --test tests/members-admin.test.js`
Expected: PASS. Also run `node --check static/js/members-admin.js` (valid JS).

- [ ] **Step 5: Create the page content and layout**

`site/content/account/members.md`:

```markdown
---
title: "Members"
type: account
layout: members
---
```

`site/layouts/account/members.html`:

```html
{{ define "main" }}
<section class="bg-sangha-light min-h-screen py-10 md:py-14">
  <div class="container mx-auto px-4 max-w-3xl">
    <div class="mb-8">
      <p class="text-[10px] uppercase tracking-widest text-sangha-gold font-bold mb-2">Membership</p>
      <h1 class="font-serif text-3xl md:text-4xl font-bold text-sangha-navy">{{ .Title }}</h1>
      <p class="text-sm text-gray-500 mt-2">Approve access requests and assign roles.</p>
    </div>
    <div id="ecbs-members-app"><p class="text-sm text-gray-500">Loading…</p></div>
  </div>
</section>
{{ $v := readFile "static/js/members-admin.js" | md5 }}
<script src="{{ "js/members-admin.js" | relURL }}?v={{ $v }}"></script>
{{ end }}
```

- [ ] **Step 6: Verify the Hugo build renders the new page**

Run (from `site/`): `hugo --gc --minify`
Expected: exits 0, and `public/account/members/index.html` exists.
Check: `test -f public/account/members/index.html && echo OK`

- [ ] **Step 7: Commit**

```bash
git add site/static/js/members-admin.js site/tests/members-admin.test.js site/content/account/members.md site/layouts/account/members.html
git commit -m "feat(site): /account/members admin panel

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Integration verification

**Files:** none (verification).

- [ ] **Step 1: Run the JS unit suites for this plan**

Run (from `site/`): `node --test tests/auth.test.js tests/members-admin.test.js`
Expected: PASS (all). Do NOT run `tests/calendar.test.js` for a green check — it has pre-existing date-coupled failures unrelated to this plan.

- [ ] **Step 2: Full production build**

Run (from `site/`): `hugo --gc --minify`
Expected: exits 0; confirm `public/account/members/index.html` and `public/index.html` exist.

- [ ] **Step 3: Manual/Playwright navigation smoke (per CLAUDE.md)**

Start a local server: `hugo server -D --baseURL "http://127.0.0.1:1313/"` and verify (Playwright or browser):
- Home, About, Updates, Forum load with no console errors.
- The nav shows a "Sign in" button when signed out (both desktop and, via the hamburger, mobile).
- `/account/members/` loads and shows the "administrators only" message when signed out (server would 401/403 the APIs regardless).
Record findings; a signed-in run requires a real worker + token and is a deploy-time check, out of scope for local verification.

- [ ] **Step 4: Commit any fixes** (only if Steps 1-3 surfaced issues)

```bash
git add -A site
git commit -m "fix(site): membership UI verification fixes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Deferred to User / Later

- Signed-in end-to-end (real Google sign-in → reader → request → admin approve → member) is a deploy-time check requiring the live worker; not part of local verification.
- Comments UI still uses Remark42 (`layouts/partials/comments.html`) — replaced in Plan 03 (native D1 comments).
- The pre-existing `tests/calendar.test.js` date-coupled failures remain (separate cleanup, unrelated to membership).

## Self-Review

**Spec coverage** (design doc, Phase-1 site items):
- `ECBS.Auth` calls `/api/me`, renders member/admin vs reader vs pending → Tasks 1, 2. ✓
- Role no longer read off the JWT (fixes the `|| "member"` bug) → Task 1. ✓
- "Request access" control → Task 1 (`requestAccess`, nav button). ✓
- `/account/members` admin panel (not `/admin`) → Task 4. ✓
- Calendar keeps working with the async role → Task 3. ✓
- Comments untouched (Plan 03) → Deferred. ✓

**Placeholder scan:** No TBD/TODO. The one deliberate broken line in Task 4 Step 3 is explicitly called out with instructions to implement base-URL resolution correctly (mirrors `auth.js`), plus a `node --check` gate — it is a guard against blind transcription, not a placeholder in the shipped code.

**Type/interface consistency:** `getSession()/refreshSession()/ready()/requestAccess()/getUser().role` are defined in Task 1 and consumed by Tasks 3 (event), 4 (`ready`/`isAdmin`/`fetch`). `ecbs:session` is dispatched in Task 1 and listened for in Task 3. `renderMembersHtml`/`init` on `ECBS.MembersAdmin` are defined and tested in Task 4. Endpoint paths and payloads match Plan 01's worker routes.
