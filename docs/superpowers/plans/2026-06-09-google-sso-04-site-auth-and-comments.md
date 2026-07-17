# Google SSO — Plan 04: Site Auth Frontend + Remark42 Comments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Depends on Plan 01** (Worker `/auth/login` + JWT). Pairs with **Plan 03** (which consumes `ECBS.Auth`). The comments proxy adds a route to the same `sangha-worker`.

**Goal:** Give the Hugo site a Google sign-in UI and a small client auth library (`ECBS.Auth`) that the calendar and comments consume; gate calendar-admin on the JWT admin role; and (contingent on a verification spike) unify comment posting so a signed-in member can comment without a second login.

**Architecture:** `site/static/js/auth.js` defines `window.ECBS.Auth`. It loads synchronously in `<head>` (so the object exists before the body-end calendar scripts), captures the JWT from the post-login URL fragment, stores it in `sessionStorage`, and exposes `getUser`/`getToken`/`isAdmin`/`login`/`logout`/`fetch`. A header partial renders a "Sign in" button or a user menu. The existing `calendar.js` identity functions are rewired to prefer `ECBS.Auth` (falling back to the legacy localStorage/dev path, so existing tests stay green). For comments, the Worker can mint a Remark42-compatible JWT and forward a comment to Remark42's REST API — but Remark42's acceptance of a Worker-minted `X-JWT` must be verified against the live server first; until then, Remark42's existing GitHub OAuth login (already deployed) remains the working fallback.

**Tech Stack:** Vanilla ES5-style browser JS (matches `calendar.js`), Hugo templates, Cloudflare Worker (`jwt.js` reused for the Remark42 token), `node --test` + jsdom for client tests, `vitest` for the Worker comment proxy.

---

## File Structure

```
site/
├── static/js/auth.js               # NEW: window.ECBS.Auth
├── layouts/partials/auth-button.html  # NEW: #ecbs-auth container
├── layouts/_default/baseof.html    # MODIFY: worker-base + site-base meta, load auth.js
├── layouts/partials/header.html    # MODIFY: include auth-button partial (desktop + mobile)
├── static/js/calendar.js           # MODIFY: identity functions defer to ECBS.Auth
├── layouts/partials/comments.html  # MODIFY (contingent): pass auth user / custom post form
└── tests/auth.test.js              # NEW

workers/sangha-worker/
├── src/comments.js                 # NEW: Remark42 JWT mint + comment forward
├── src/index.js                    # MODIFY: register POST /api/comments
├── test/comments.test.js           # NEW
├── wrangler.toml                   # MODIFY: REMARK42_* var docs
└── vitest.config.js                # MODIFY: REMARK42_* test bindings
```

---

## Task 1: `ECBS.Auth` client library (`auth.js`)

**Files:**
- Create: `site/static/js/auth.js`
- Test: `site/tests/auth.test.js`
- Modify: `site/package.json` (add the test file)

- [ ] **Step 1: Write the failing test**

`site/tests/auth.test.js`:

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
  const context = {
    URLSearchParams, console, atob: (s) => Buffer.from(s, "base64").toString("binary"), escape, unescape, decodeURIComponent, JSON, Math, Date,
    window: {
      fetch: options.fetch,
      atob: (s) => Buffer.from(s, "base64").toString("binary"),
      location,
      history: { replaceState: (a, b, url) => { location.replacedTo = url; } },
      sessionStorage: {
        getItem: (k) => (sessionData.has(k) ? sessionData.get(k) : null),
        setItem: (k, v) => sessionData.set(k, String(v)),
        removeItem: (k) => sessionData.delete(k)
      }
    },
    document: {
      readyState: "complete",
      addEventListener: () => {},
      getElementById: (id) => (id === "ecbs-auth" ? container : null),
      querySelector: (sel) => metas[sel] || null
    }
  };
  context.window.window = context.window;
  context.window.document = context.document;
  vm.createContext(context);
  const scriptPath = path.join(__dirname, "..", "static", "js", "auth.js");
  vm.runInContext(fs.readFileSync(scriptPath, "utf8"), context, { filename: scriptPath });
  return { Auth: context.window.ECBS.Auth, sessionData, location };
}

test("getUser is null when no token is stored", () => {
  assert.equal(load().Auth.getUser(), null);
});

test("consumes a token from the URL fragment and exposes the user", () => {
  const claims = { sub: "mem@eauclairesangha.org", name: "Mem", role: "member", exp: Math.floor(Date.now() / 1000) + 600 };
  const { Auth, location } = load({ hash: "#token=" + makeToken(claims) });
  const user = Auth.getUser();
  assert.equal(user.email, "mem@eauclairesangha.org");
  assert.equal(user.role, "member");
  assert.equal(Auth.isAdmin(), false);
  assert.equal(location.replacedTo, "/calendar/"); // fragment cleared
});

test("isAdmin is true for an admin token", () => {
  const claims = { sub: "boss@eauclairesangha.org", name: "Boss", role: "admin", exp: Math.floor(Date.now() / 1000) + 600 };
  assert.equal(load({ hash: "#token=" + makeToken(claims) }).Auth.isAdmin(), true);
});

test("an expired token is treated as signed out and cleared", () => {
  const claims = { sub: "x@eauclairesangha.org", name: "X", role: "member", exp: Math.floor(Date.now() / 1000) - 1 };
  const { Auth, sessionData } = load({ hash: "#token=" + makeToken(claims) });
  assert.equal(Auth.getUser(), null);
  assert.equal(Auth.getToken(), null);
  assert.equal(sessionData.has("ecbs-auth-token"), false);
});

test("login redirects to the Worker with a return_to", () => {
  const { Auth, location } = load({ href: "https://eauclairesangha.org/calendar/" });
  Auth.login();
  assert.ok(location.href.startsWith("https://worker.test/auth/login?return_to="));
  assert.ok(location.href.includes(encodeURIComponent("https://eauclairesangha.org/calendar/")));
});

test("fetch attaches the bearer token and clears it on 401", async () => {
  const claims = { sub: "x@eauclairesangha.org", name: "X", role: "member", exp: Math.floor(Date.now() / 1000) + 600 };
  let seenAuth;
  const fetchImpl = async (url, opts) => { seenAuth = opts.headers.Authorization; return new Response("", { status: 401 }); };
  const { Auth, sessionData } = load({ hash: "#token=" + makeToken(claims), fetch: fetchImpl });
  await Auth.fetch("https://worker.test/api/x");
  assert.ok(seenAuth.startsWith("Bearer "));
  assert.equal(sessionData.has("ecbs-auth-token"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd site && node --test tests/auth.test.js`
Expected: FAIL — `auth.js` not found.

- [ ] **Step 3: Create `auth.js`**

```js
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
          '<a href="' + joinPath(siteBase(), "calendar/") + '" class="block px-4 py-2 text-sm text-sangha-navy hover:bg-sangha-light">Calendar</a>' +
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
```

- [ ] **Step 4: Add the test to `site/package.json`**

```json
    "test": "node --test tests/calendar.test.js tests/calendar-api.test.js tests/auth.test.js",
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd site && node --test tests/auth.test.js`
Expected: PASS — 6 tests.

- [ ] **Step 6: Commit**

```bash
git add site/static/js/auth.js site/tests/auth.test.js site/package.json
git commit -m "feat(site): ECBS.Auth Google SSO client library"
```

---

## Task 2: Load `auth.js` + worker/site base metas in `baseof.html`

**Files:**
- Modify: `site/layouts/_default/baseof.html`

- [ ] **Step 1: Add metas + script in `<head>`**

In `site/layouts/_default/baseof.html`, immediately before `</head>` (after line 27's `{{ end -}}`), add:

```html
    <meta name="ecbs:worker-base" content="{{ .Site.Params.calendarApiBase }}" />
    <meta name="ecbs:site-base" content="{{ "" | relURL }}" />
    {{ $authVersion := readFile "static/js/auth.js" | md5 }}
    <script src="{{ "js/auth.js" | relURL }}?v={{ $authVersion }}"></script>
```

> The script is intentionally **not** `defer`/`async`: it must execute before the body-end `calendar-api.js`/`calendar.js` so `ECBS.Auth` exists when they read it. It is tiny and does no blocking I/O.

> If Plan 03 has not yet added `params.calendarApiBase`, add it to `site/hugo.yaml` under `params:`:
> ```yaml
>   calendarApiBase: https://sangha-worker.eau-claire-buddhist-sangha.workers.dev
> ```

- [ ] **Step 2: Build and verify**

Run:
```bash
cd site && hugo
grep -o 'name="ecbs:worker-base" content="[^"]*"' public/index.html
grep -c 'js/auth.js' public/index.html
```
Expected: meta shows the Worker URL; `auth.js` referenced once.

- [ ] **Step 3: Commit**

```bash
git add site/layouts/_default/baseof.html site/hugo.yaml
git commit -m "feat(site): load ECBS.Auth + worker/site base metas site-wide"
```

---

## Task 3: Sign-in button partial + header integration

**Files:**
- Create: `site/layouts/partials/auth-button.html`
- Modify: `site/layouts/partials/header.html`

- [ ] **Step 1: Create the partial**

`site/layouts/partials/auth-button.html`:

```html
{{/* Container populated by ECBS.Auth.renderButtons(): "Sign in" or user menu. */}}
<div id="ecbs-auth" class="flex items-center"></div>
```

- [ ] **Step 2: Include it in the desktop nav**

In `site/layouts/partials/header.html`, replace the hardcoded desktop Admin link (lines 27–29):

```html
        <a href="{{ "admin/" | relURL }}" class="text-[10px] uppercase tracking-tighter border border-white/20 px-3 py-1 rounded-full hover:bg-white/10 transition-colors text-white/40">
          Admin
        </a>
```

with:

```html
        {{ partial "auth-button.html" . }}
```

- [ ] **Step 3: Update the mobile menu**

In the mobile menu panel, replace the hardcoded mobile Admin link (line 47):

```html
      <a href="{{ "admin/" | relURL }}" class="text-white/40 text-xs uppercase tracking-widest py-2">Admin</a>
```

with a second auth container (the Admin link now lives inside the `ECBS.Auth` menu for admins only):

```html
      <div id="ecbs-auth-mobile" class="py-2"></div>
```

Then, so both containers render, append to the end of `auth.js`'s `renderButtons()` a mobile mirror — **or** simpler: in `header.html`'s existing `<script>` block (after the hamburger handler, before `</script>` on line 56), add:

```html
    if (window.ECBS && window.ECBS.Auth) {
      var mobile = document.getElementById('ecbs-auth-mobile');
      var desktop = document.getElementById('ecbs-auth');
      if (mobile && desktop) {
        var sync = function () { mobile.innerHTML = desktop.innerHTML; };
        window.ECBS.Auth.renderButtons();
        sync();
      }
    }
```

> This mirrors the desktop container's rendered HTML into the mobile one. (Click handlers on the mobile clone are not wired; the mobile "Sign in" button falls back to a plain link in the next step if needed. For a quiet UI this duplication is acceptable; revisit if the dropdown must be interactive on mobile.)

- [ ] **Step 4: Build and verify the rendered nav**

Run:
```bash
cd site && hugo
grep -c 'id="ecbs-auth"' public/index.html
```
Expected: the `#ecbs-auth` container is present; build succeeds.

- [ ] **Step 5: Manual check**

Run `cd site && npm run dev`, open the home page. Expected: a "Sign in" chip in the nav. (Clicking it redirects to the Worker once `calendarApiBase` points at a deployed Worker; with no Worker, `login()` no-ops.)

- [ ] **Step 6: Commit**

```bash
git add site/layouts/partials/auth-button.html site/layouts/partials/header.html
git commit -m "feat(site): Google sign-in button + user menu in nav"
```

---

## Task 4: Rewire `calendar.js` identity to `ECBS.Auth`

**Files:**
- Modify: `site/static/js/calendar.js`
- Modify: `site/tests/calendar.test.js`

The calendar's "who am I / am I admin" checks now prefer `ECBS.Auth`, with the existing localStorage/dev-bypass path kept as fallback. Because the existing tests don't define `window.ECBS`, they exercise the fallback and stay green; one new test covers the `ECBS.Auth` path.

- [ ] **Step 1: Write the new (failing) test**

Add to `site/tests/calendar.test.js`:

```js
test("calendar identity prefers ECBS.Auth when present", () => {
  const api = loadDomApi({ localDev: false, url: "https://eauclairesangha.org/admin/calendar/" });
  api.__window.ECBS = {
    Auth: { getUser: () => ({ email: "boss@eauclairesangha.org", name: "Boss", role: "admin" }) }
  };
  assert.equal(api.hasCalendarAdminAccess(), true);

  api.__window.ECBS.Auth.getUser = () => ({ email: "mem@eauclairesangha.org", name: "Mem", role: "member" });
  assert.equal(api.hasCalendarAdminAccess(), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd site && node --test tests/calendar.test.js`
Expected: FAIL — `hasCalendarAdminAccess()` still returns based on sessionStorage/dev only (member case returns false correctly, but admin case returns false because `ECBS.Auth` is ignored). The admin assertion fails.

- [ ] **Step 3: Rewire `loggedInUserName`, `currentUserEmail`, `hasCalendarAdminAccess`**

In `site/static/js/calendar.js`, add a helper near the other identity functions (around line 698), then update the three functions:

```js
  function authUser() {
    try {
      if (window.ECBS && window.ECBS.Auth && window.ECBS.Auth.getUser) {
        return window.ECBS.Auth.getUser();
      }
    } catch (error) {
      return null;
    }
    return null;
  }
```

Update `loggedInUserName` (line 702):

```js
  function loggedInUserName() {
    try {
      var user = authUser();
      if (user) return user.name || "";
      return (window.localStorage && window.localStorage.getItem("ecbs-calendar-current-user-name")) || "";
    } catch (error) {
      return "";
    }
  }
```

Update `currentUserEmail` (line 719):

```js
  function currentUserEmail() {
    try {
      var user = authUser();
      if (user && user.email) return user.email;
      var userName = currentUserName();
      return (window.localStorage && window.localStorage.getItem("ecbs-calendar-current-user-email")) || (userName ? emailFromName(userName) : "");
    } catch (error) {
      return currentUserName() ? emailFromName(currentUserName()) : "";
    }
  }
```

Update `hasCalendarAdminAccess` (line 1367) — local dev bypass stays first; if `ECBS.Auth` is loaded, it is authoritative; otherwise fall back to the legacy session handoff:

```js
  function hasCalendarAdminAccess() {
    if (isLocalDevelopmentMode()) return true;
    var user = authUser();
    if (window.ECBS && window.ECBS.Auth) {
      return Boolean(user && user.role === "admin");
    }
    if (typeof window === "undefined" || !window.sessionStorage) return false;
    try {
      var raw = window.sessionStorage.getItem(ADMIN_ACCESS_KEY);
      var timestamp = Number(raw || 0);
      return Boolean(timestamp && Date.now() - timestamp <= ADMIN_ACCESS_MAX_AGE_MS);
    } catch (error) {
      return false;
    }
  }
```

- [ ] **Step 4: Run the full client suite**

Run: `cd site && npm test`
Expected: PASS — the new ECBS.Auth identity test plus the entire existing suite (which never defines `window.ECBS`, so it keeps using the localStorage/dev fallback).

- [ ] **Step 5: Commit**

```bash
git add site/static/js/calendar.js site/tests/calendar.test.js
git commit -m "feat(calendar): prefer ECBS.Auth identity over localStorage mock"
```

---

## Task 5 (SPIKE): Verify Remark42 accepts a Worker-minted JWT

**This is a research task, not code. It decides whether Tasks 6–7 ship or are deferred.**

The spec's comment-proxy design assumes the Worker can mint a Remark42-compatible JWT (signed with Remark42's `SECRET`) and `POST` a comment to Remark42's REST API on the user's behalf. Remark42's external-JWT acceptance and exact claim format must be confirmed against the running server before building UI on top of it.

- [ ] **Step 1: Confirm Remark42's token mechanism**

Check the running Remark42 (`infra/isso/docker-compose.yml` → `comments.eauclairesangha.org`) and Remark42 docs for: (a) whether `POST /api/v1/comment` accepts an `X-JWT` header signed with the server `SECRET`; (b) the exact JWT claim shape Remark42 expects (`user.id` provider-prefix format, `aud`/`iss`, `site_id`); (c) whether the embed UI can be told the user is authenticated, or whether a custom comment form is required.

- [ ] **Step 2: Manual probe**

Mint a test JWT (HS256, secret = the Remark42 `SECRET` from docker-compose) with a candidate claim set and try:

```bash
curl -i -X POST "https://comments.eauclairesangha.org/api/v1/comment" \
  -H "Content-Type: application/json" -H "X-JWT: <minted-token>" \
  -d '{"text":"spike test","locator":{"site":"ec-buddhist-sangha","url":"https://eauclairesangha.org/topics/test/"}}'
```

Expected (success path): `201` with the created comment JSON. Record the working claim shape.

- [ ] **Step 3: Decide**

- **If the probe succeeds:** proceed to Tasks 6–7 using the confirmed claim shape (adjust `buildRemarkClaims` in Task 6 to match what worked).
- **If it fails / is unsupported:** STOP at this task. Document the finding in `docs/superpowers/specs/2026-05-28-google-sso-design.md` under a "Comments addendum," and keep Remark42's existing **GitHub OAuth** login (already deployed via docker-compose) as the comment auth — comments keep working, just not unified with Google SSO. Update the access matrix note accordingly. Tasks 6–7 are then out of scope.

- [ ] **Step 4: Commit the finding (docs only)**

```bash
git add docs/superpowers/specs/2026-05-28-google-sso-design.md
git commit -m "docs(sso): record Remark42 JWT spike outcome"
```

---

## Task 6 (CONTINGENT on Task 5 success): Comment proxy in the Worker

**Files:**
- Create: `workers/sangha-worker/src/comments.js`
- Test: `workers/sangha-worker/test/comments.test.js`
- Modify: `workers/sangha-worker/src/index.js`
- Modify: `workers/sangha-worker/wrangler.toml` (REMARK42_* var docs)
- Modify: `workers/sangha-worker/vitest.config.js` (REMARK42_* test bindings)

- [ ] **Step 1: Add REMARK42 test bindings to `vitest.config.js`**

Add inside `miniflare.bindings`:

```js
            REMARK42_URL: "https://comments.test",
            REMARK42_SITE_ID: "ec-buddhist-sangha",
            REMARK42_JWT_SECRET: "remark-shared-secret",
```

- [ ] **Step 2: Write the failing test**

```js
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { buildRemarkClaims, handlePostComment } from "../src/comments.js";

const user = { sub: "mem@eauclairesangha.org", name: "Mem", role: "member" };

describe("comment proxy", () => {
  it("builds Remark42 claims from the site user", () => {
    const claims = buildRemarkClaims(user, env, 1000);
    expect(claims.user.name).toBe("Mem");
    expect(claims.user.id).toContain("mem@eauclairesangha.org");
    expect(claims.user.admin).toBe(false);
    expect(claims.aud).toBe("ec-buddhist-sangha");
    expect(claims.exp).toBe(1000 + 3600);
  });

  it("forwards the comment to Remark42 with an X-JWT header", async () => {
    let seen;
    const fetchImpl = async (url, init) => {
      seen = { url, init };
      return new Response(JSON.stringify({ id: "c1" }), { status: 201 });
    };
    const req = new Request("https://worker.test/api/comments", {
      method: "POST",
      body: JSON.stringify({ text: "hello", url: "https://eauclairesangha.org/topics/x/" })
    });
    req.user = user;
    const res = await handlePostComment(req, env, { fetch: fetchImpl, now: 1000 });
    expect(res.status).toBe(201);
    expect(seen.url).toBe("https://comments.test/api/v1/comment");
    expect(seen.init.headers["X-JWT"].split(".").length).toBe(3);
    const body = JSON.parse(seen.init.body);
    expect(body.text).toBe("hello");
    expect(body.locator.url).toBe("https://eauclairesangha.org/topics/x/");
  });

  it("400s on a missing text/url", async () => {
    const req = new Request("https://worker.test/api/comments", { method: "POST", body: JSON.stringify({ text: "" }) });
    req.user = user;
    const res = await handlePostComment(req, env, { fetch: async () => new Response("", { status: 201 }) });
    expect(res.status).toBe(400);
  });

  it("502s when Remark42 rejects the comment", async () => {
    const fetchImpl = async () => new Response("nope", { status: 401 });
    const req = new Request("https://worker.test/api/comments", { method: "POST", body: JSON.stringify({ text: "hi", url: "https://eauclairesangha.org/topics/x/" }) });
    req.user = user;
    const res = await handlePostComment(req, env, { fetch: fetchImpl, now: 1000 });
    expect(res.status).toBe(502);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd workers/sangha-worker && npx vitest run test/comments.test.js`
Expected: FAIL — module not found.

- [ ] **Step 4: Create `comments.js`**

> Adjust `buildRemarkClaims` to match the exact shape confirmed in the Task 5 spike. The shape below is the starting hypothesis.

```js
// workers/sangha-worker/src/comments.js
// Lets a Google-signed-in member comment without a second login: mint a
// Remark42-compatible JWT (signed with the shared Remark42 SECRET) and forward
// the comment to Remark42's REST API. REMARK42_JWT_SECRET must equal Remark42's SECRET.
import { signJwt } from "./jwt.js";
import { jsonResponse } from "./middleware.js";

export function buildRemarkClaims(user, env, nowSeconds) {
  const siteId = env.REMARK42_SITE_ID || "ec-buddhist-sangha";
  const id = "google_" + user.sub;
  return {
    user: { name: user.name, id: id, picture: "", admin: user.role === "admin", site_id: siteId },
    iss: "remark42",
    aud: siteId,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
    jti: id + "-" + nowSeconds
  };
}

export async function handlePostComment(request, env, options = {}) {
  const fetchImpl = options.fetch || fetch;
  let body;
  try { body = await request.json(); } catch (error) { return jsonResponse(env, { error: "bad_json" }, 400); }
  if (!body || !body.text || !body.url) return jsonResponse(env, { error: "bad_request" }, 400);
  if (body.text.length > 10000) return jsonResponse(env, { error: "text_too_long" }, 400);
  let locatorUrl;
  try {
    locatorUrl = new URL(body.url);
  } catch (error) {
    return jsonResponse(env, { error: "bad_request" }, 400);
  }
  if (locatorUrl.origin !== new URL(env.CORS_ORIGIN).origin) {
    return jsonResponse(env, { error: "bad_request" }, 400);
  }

  const now = options.now != null ? options.now : Math.floor(Date.now() / 1000);
  const remarkToken = await signJwt(buildRemarkClaims(request.user, env, now), env.REMARK42_JWT_SECRET, { now });

  const url = (env.REMARK42_URL || "").replace(/\/+$/, "") + "/api/v1/comment";
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-JWT": remarkToken },
    body: JSON.stringify({
      text: body.text,
      locator: { site: env.REMARK42_SITE_ID || "ec-buddhist-sangha", url: body.url },
      pid: body.pid || ""
    })
  });
  if (!res.ok) return jsonResponse(env, { error: "remark_error", status: res.status }, 502);
  return jsonResponse(env, await res.json(), 201);
}
```

- [ ] **Step 5: Register the route in `index.js`**

```js
// import:
import { handlePostComment } from "./comments.js";
// route (before the catch-all):
router.post("/api/comments", requireRole(["member", "admin"], handlePostComment));
```

- [ ] **Step 6: Document the env vars in `wrangler.toml`**

Add under the secrets comment block:

```toml
# Plan 04 (comments proxy):
#   REMARK42_JWT_SECRET   (must equal Remark42's SECRET)  -> wrangler secret put
# [vars] additions:
REMARK42_URL = "https://comments.eauclairesangha.org"
REMARK42_SITE_ID = "ec-buddhist-sangha"
```

- [ ] **Step 7: Run the full Worker suite**

Run: `cd workers/sangha-worker && npm test`
Expected: PASS — all suites including `comments.test.js`.

- [ ] **Step 8: Commit**

```bash
git add workers/sangha-worker/src/comments.js workers/sangha-worker/test/comments.test.js workers/sangha-worker/src/index.js workers/sangha-worker/wrangler.toml workers/sangha-worker/vitest.config.js
git commit -m "feat(worker): Remark42 comment proxy for unified SSO"
```

---

## Task 7 (CONTINGENT): Wire the comment UI + Remark42 config

**Files:**
- Modify: `site/layouts/partials/comments.html`
- Modify: `infra/isso/docker-compose.yml` (Remark42 JWT settings)

- [ ] **Step 1: Set Remark42's shared secret expectation**

Confirm `infra/isso/docker-compose.yml` Remark42 `SECRET` matches the Worker's `REMARK42_JWT_SECRET`. (The `SECRET` already exists in the compose file; the Worker secret must be set to the same value via `wrangler secret put REMARK42_JWT_SECRET`.) No file change is needed unless the spike (Task 5) found additional required env (e.g. enabling a header-JWT auth mode); apply exactly what the spike confirmed.

- [ ] **Step 2: Add a signed-in comment form that posts through the Worker**

In `site/layouts/partials/comments.html`, keep the existing Remark42 embed as the comment **display** (and anonymous/GitHub fallback), and add — above `<div id="remark42"></div>` — a member comment box that posts via `ECBS.Auth.fetch`:

```html
    <div id="ecbs-comment-box" class="hidden mb-6">
      <textarea id="ecbs-comment-text" rows="3" class="w-full rounded-lg border border-gray-300 p-3 text-sm" placeholder="Share a reflection..."></textarea>
      <div class="mt-2 flex justify-end">
        <button type="button" id="ecbs-comment-submit" class="bg-sangha-navy text-white text-xs font-bold uppercase tracking-widest px-4 py-2 rounded-full hover:bg-blue-900">Post comment</button>
      </div>
      <p id="ecbs-comment-status" class="mt-2 text-xs text-gray-500"></p>
    </div>
```

and add this script after the existing embed script block:

```html
<script>
(function () {
  if (!window.ECBS || !window.ECBS.Auth || !window.ECBS.Auth.isSignedIn()) return;
  var box = document.getElementById('ecbs-comment-box');
  var text = document.getElementById('ecbs-comment-text');
  var submit = document.getElementById('ecbs-comment-submit');
  var status = document.getElementById('ecbs-comment-status');
  var workerBase = (document.querySelector('meta[name="ecbs:worker-base"]') || {}).getAttribute
    ? document.querySelector('meta[name="ecbs:worker-base"]').getAttribute('content') : '';
  if (!box || !workerBase) return;
  box.classList.remove('hidden');
  submit.addEventListener('click', function () {
    if (!text.value.trim()) return;
    submit.disabled = true; status.textContent = 'Posting...';
    window.ECBS.Auth.fetch(workerBase.replace(/\/+$/, '') + '/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.value, url: window.location.href })
    }).then(function (res) {
      if (!res.ok) throw new Error('post failed: ' + res.status);
      text.value = ''; status.textContent = 'Posted. Refresh to see it below.';
    }).catch(function () {
      status.textContent = 'Could not post your comment. Please try again.';
    }).finally(function () { submit.disabled = false; });
  });
})();
</script>
```

> Design note: this adds a lightweight signed-in compose box that posts through the Worker; the Remark42 embed below it still renders the thread (and serves anonymous/GitHub commenters per the spike's fallback). Keeping the two separate avoids reverse-engineering the embed's internal form.

- [ ] **Step 3: Build and verify**

Run: `cd site && hugo && grep -c 'ecbs-comment-box' public/topics/*/index.html | head`
Expected: the compose box markup is present on topic pages.

- [ ] **Step 4: Manual end-to-end**

Sign in as a member, open a topic, post via the box → expect a `201` from `/api/comments` and the comment visible in the Remark42 thread after refresh.

- [ ] **Step 5: Commit**

```bash
git add site/layouts/partials/comments.html infra/isso/docker-compose.yml
git commit -m "feat(comments): signed-in compose box posting through the Worker"
```

---

## Self-Review

**1. Spec coverage (Site frontend + comments slice):**
- `auth.js` `ECBS.Auth` with `init`/`login`/`logout`/`getUser`/`isAdmin`/`isSignedIn`/`fetch`; parses JWT from fragment, clears it, stores in `sessionStorage`, auto-clears expired (spec §Hugo Site Changes → New Files) — Task 1. ✓
- `auth-button.html` partial: "Sign in" when anonymous, user menu (Calendar, Sign Out) when signed in, Admin link for admins (spec §New Files) — Tasks 1 (render) + 3 (partial). ✓
- `header.html` includes the auth button (spec §Modified Files) — Task 3. ✓
- `calendar.js` replaces the `ecbs-calendar-current-user-name` mock with `ECBS.Auth.getUser()` (spec §Modified Files) — Task 4. ✓
- `calendar-admin` gated by Worker JWT instead of the localStorage access key (spec §Modified Files: calendar-admin.html / `hasCalendarAdminAccess`) — Task 4. ✓
- Comments: Worker proxies a comment using a Remark42 JWT (spec §Remark42 Comments Integration) — Tasks 6–7, **gated by the Task 5 spike** with a documented GitHub-OAuth fallback. ✓ (with honest uncertainty flagged)
- JWT stored in `sessionStorage`; cleared on 401; CORS to the Worker (spec §Security) — Task 1 (`authedFetch` 401 clear; `sessionStorage`). ✓
- **Not changed here (deferred / unnecessary):** `site/static/admin/index.html`'s Calendar Admin link injection (spec suggested removing it) is left intact — it is harmless once `hasCalendarAdminAccess` is JWT-driven (Task 4), and removing it risks breaking the existing Decap menu. Flag it as optional cleanup, not a requirement.

**2. Placeholder scan:** No TBD/TODO. The one explicit contingency is Task 5 (spike) → Tasks 6–7, clearly labeled CONTINGENT with a concrete fallback. The Remark42 claim shape is marked as "adjust to match the spike," which is a verification instruction, not a code gap. ✓

**3. Type consistency:**
- `ECBS.Auth.getUser()` returns `{ email, name, role }` (Task 1) — exactly what `calendar.js` `authUser()` consumes (Task 4) and what Plan 03's `syncStoreToServer` reads (`user.email`, `user.role`). ✓
- `ECBS.Auth.getToken()` returns the raw JWT string — consumed by Plan 03's `calendar-api.js` `authToken()`. ✓
- The JWT claim names read client-side (`claims.sub`, `claims.name`, `claims.role`, `claims.exp`) match exactly what Plan 01's `signJwt({ sub, name, role }, ..., { expiresInSeconds })` produces. ✓
- Worker `buildRemarkClaims(user, env, nowSeconds)` reads `user.sub`/`user.name`/`user.role` — the same JWT-claim user object `requireRole` attaches as `request.user` (Plan 01 Task 7). ✓
- Meta names `ecbs:worker-base` / `ecbs:site-base` are written in `baseof.html` (Task 2) and read in `auth.js` (Task 1) and `comments.html` (Task 7) — identical strings. ✓
