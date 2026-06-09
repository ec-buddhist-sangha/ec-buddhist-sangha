# Google SSO — Plan 02: Decap CMS Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Depends on Plan 01** (`sangha-worker` scaffold + `index.js` + `middleware.js` must exist).

**Goal:** Move Decap CMS's OAuth proxy off the standalone `workers/oauth-proxy/` Worker and into the consolidated `sangha-worker`, then point Decap at the new endpoints and decommission the old Worker — with zero downtime for content editing.

**Architecture:** Decap CMS uses `backend: github`, which means **git commits must be authorized by a GitHub token** — a Google ID token cannot authorize GitHub git operations. So Decap continues to authenticate with **GitHub OAuth** (the existing, working flow), unchanged in behavior; we only re-home the proxy code into `sangha-worker` under a dedicated route prefix (`/decap/*`) so it doesn't collide with the Google login routes (`/auth/login`, `/auth/callback`) from Plan 01. Google SSO (Plan 01) gates the *site* (calendar/comments) and the *visibility* of the Admin affordance; Decap's own login stays GitHub.

> **⚠️ Spec reconciliation (read this):** The design spec (`docs/superpowers/specs/2026-05-28-google-sso-design.md`, §"Admin Login (Decap CMS)") describes Decap authenticating via Google at `/auth/admin`. That does not actually work with a GitHub git backend: Decap needs a GitHub access token to read/write the repo, and the Google flow produces a Google token. The spec also (correctly) keeps `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` in the env-var table "for the Decap CMS Git backend," which only makes sense if Decap still uses GitHub. This plan therefore keeps GitHub OAuth for Decap and treats the spec's `/auth/admin`-via-Google line as an error. If true Google-gated CMS auth is ever required, it needs a Git Gateway-style proxy (the Worker holding a server-side GitHub token and authorizing per the site JWT) — that is a separate, larger project and is explicitly **out of scope** here.

**Tech Stack:** Cloudflare Workers, `itty-router@^4`, GitHub OAuth web flow, `vitest@^2` with `@cloudflare/vitest-pool-workers`. Decap CMS v3.

---

## File Structure

```
workers/sangha-worker/
├── src/
│   ├── decap.js        # NEW: GitHub OAuth handlers for Decap (handleDecapAuth, handleDecapCallback)
│   └── index.js        # MODIFY: register /decap/auth + /decap/callback
├── test/
│   └── decap.test.js   # NEW
├── wrangler.toml       # MODIFY: document GITHUB_* + DECAP redirect note
└── vitest.config.js    # MODIFY: add GITHUB_* test bindings

site/static/admin/config.yml   # MODIFY: base_url + auth_endpoint → sangha-worker
workers/oauth-proxy/            # ARCHIVE after verification (final task)
```

**Responsibilities:** `decap.js` owns the GitHub OAuth dance and the Decap `postMessage` handshake — a faithful port of `workers/oauth-proxy/index.js`, namespaced under `/decap/*`. `index.js` only wires routes.

---

## Reference: the existing flow being ported

`workers/oauth-proxy/index.js` does exactly two things:
- `GET /auth` → 302 to `https://github.com/login/oauth/authorize` with `client_id`, `redirect_uri=<origin>/callback`, `scope=repo,read:org`, `state`.
- `GET /callback` → POST the `code` to `https://github.com/login/oauth/access_token`, then return an HTML page that `postMessage`s `authorization:github:success:{"token":"..."}` to `window.opener`.

We reproduce this under `/decap/auth` and `/decap/callback`.

---

## Task 1: Decap GitHub OAuth handlers (`decap.js`)

**Files:**
- Create: `workers/sangha-worker/src/decap.js`
- Test: `workers/sangha-worker/test/decap.test.js`
- Modify: `workers/sangha-worker/vitest.config.js` (add GitHub test bindings)

- [ ] **Step 1: Add GitHub bindings to `vitest.config.js`**

In `workers/sangha-worker/vitest.config.js`, inside `miniflare.bindings`, add these two entries alongside the existing ones:

```js
            GITHUB_CLIENT_ID: "gh-client-id",
            GITHUB_CLIENT_SECRET: "gh-client-secret",
```

- [ ] **Step 2: Write the failing test**

```js
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { handleDecapAuth, handleDecapCallback } from "../src/decap.js";

describe("decap github oauth", () => {
  it("redirects to GitHub authorize with the decap callback URI", async () => {
    const req = new Request("https://worker.test/decap/auth?provider=github");
    const res = await handleDecapAuth(req, env);
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("Location"));
    expect(loc.origin + loc.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(loc.searchParams.get("client_id")).toBe("gh-client-id");
    expect(loc.searchParams.get("redirect_uri")).toBe("https://worker.test/decap/callback");
    expect(loc.searchParams.get("scope")).toBe("repo,read:org");
    expect(loc.searchParams.get("state")).toBeTruthy();
  });

  it("returns 400 when no code is present on callback", async () => {
    const res = await handleDecapCallback(new Request("https://worker.test/decap/callback"), env);
    expect(res.status).toBe(400);
  });

  it("exchanges the code and returns the Decap postMessage HTML", async () => {
    const fetchImpl = async (url, init) => {
      expect(url).toBe("https://github.com/login/oauth/access_token");
      const body = JSON.parse(init.body);
      expect(body.code).toBe("gh-code");
      expect(body.client_secret).toBe("gh-client-secret");
      expect(body.redirect_uri).toBe("https://worker.test/decap/callback");
      return new Response(JSON.stringify({ access_token: "gho_token123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    };
    const req = new Request("https://worker.test/decap/callback?code=gh-code&state=s");
    const res = await handleDecapCallback(req, env, { fetch: fetchImpl });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("authorization:github:success:");
    expect(html).toContain("gho_token123");
  });

  it("surfaces a GitHub error response", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ error: "bad_verification_code", error_description: "expired" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    const req = new Request("https://worker.test/decap/callback?code=expired&state=s");
    const res = await handleDecapCallback(req, env, { fetch: fetchImpl });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("expired");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd workers/sangha-worker && npx vitest run test/decap.test.js`
Expected: FAIL — `Cannot find module '../src/decap.js'`.

- [ ] **Step 4: Write minimal implementation**

```js
// workers/sangha-worker/src/decap.js
// GitHub OAuth proxy for Decap CMS, ported from workers/oauth-proxy/index.js and
// namespaced under /decap/* so it co-exists with the Google login routes.
// Decap's git backend is GitHub, so it authenticates with a GitHub token here.

const GITHUB_BASE = "https://github.com";

function decapRedirectUri(request) {
  return new URL(request.url).origin + "/decap/callback";
}

export async function handleDecapAuth(request, env) {
  const clientId = env.GITHUB_CLIENT_ID || "";
  if (!clientId) return new Response("GITHUB_CLIENT_ID not configured", { status: 500 });
  const url = new URL(GITHUB_BASE + "/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", decapRedirectUri(request));
  url.searchParams.set("scope", "repo,read:org");
  url.searchParams.set("state", crypto.randomUUID());
  return Response.redirect(url.toString(), 302);
}

export async function handleDecapCallback(request, env, options = {}) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  if (!code) return new Response("No code provided", { status: 400 });

  const clientId = env.GITHUB_CLIENT_ID || "";
  const clientSecret = env.GITHUB_CLIENT_SECRET || "";
  if (!clientId || !clientSecret) return new Response("OAuth credentials not configured", { status: 500 });

  const fetchImpl = options.fetch || fetch;
  let tokenData;
  try {
    const tokenResponse = await fetchImpl(GITHUB_BASE + "/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: decapRedirectUri(request)
      })
    });
    tokenData = await tokenResponse.json();
  } catch (error) {
    return new Response("Authentication failed", { status: 500 });
  }

  if (tokenData.error) {
    return new Response("Error: " + (tokenData.error_description || tokenData.error), { status: 400 });
  }

  const html = `<!DOCTYPE html>
<html>
<head><title>Decap CMS Authorization</title></head>
<body>
  <p>Authorizing Decap CMS...</p>
  <script>
    (function() {
      const token = ${JSON.stringify(tokenData.access_token)};
      const receiveMessage = (message) => {
        window.opener.postMessage(
          'authorization:github:success:' + JSON.stringify({ token: token }),
          '*'
        );
        window.removeEventListener("message", receiveMessage, false);
        setTimeout(function() { window.close(); }, 100);
      };
      window.addEventListener("message", receiveMessage, false);
      window.opener.postMessage("authorizing:github", "*");
    })();
  </script>
</body>
</html>`;

  return new Response(html, { status: 200, headers: { "Content-Type": "text/html" } });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd workers/sangha-worker && npx vitest run test/decap.test.js`
Expected: PASS — 4 tests.

- [ ] **Step 6: Commit**

```bash
git add workers/sangha-worker/src/decap.js workers/sangha-worker/test/decap.test.js workers/sangha-worker/vitest.config.js
git commit -m "feat(worker): port Decap GitHub OAuth into sangha-worker under /decap"
```

---

## Task 2: Register Decap routes in `index.js`

**Files:**
- Modify: `workers/sangha-worker/src/index.js`
- Modify: `workers/sangha-worker/test/index.test.js`

- [ ] **Step 1: Add a failing route test**

In `workers/sangha-worker/test/index.test.js`, add inside the `describe("router", ...)` block:

```js
  it("/decap/auth redirects to GitHub", async () => {
    const res = await call("/decap/auth?provider=github");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("github.com/login/oauth/authorize");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd workers/sangha-worker && npx vitest run test/index.test.js`
Expected: FAIL — `/decap/auth` currently hits the `*` 404 handler (status 404, not 302).

- [ ] **Step 3: Wire the routes**

In `workers/sangha-worker/src/index.js`, add the import and two routes. The file becomes:

```js
// workers/sangha-worker/src/index.js
import { Router } from "itty-router";
import { handleLogin, handleCallback } from "./auth.js";
import { handleDecapAuth, handleDecapCallback } from "./decap.js";
import { handlePreflight, jsonResponse, errorHandler } from "./middleware.js";

const router = Router();

router.options("*", (request, env) => handlePreflight(request, env));
router.get("/api/health", (request, env) => jsonResponse(env, { status: "ok" }));
router.get("/auth/login", (request, env) => handleLogin(request, env));
router.get("/auth/callback", (request, env) => handleCallback(request, env));
router.get("/decap/auth", (request, env) => handleDecapAuth(request, env));
router.get("/decap/callback", (request, env) => handleDecapCallback(request, env));
router.all("*", (request, env) => jsonResponse(env, { error: "not_found" }, 404));

export default {
  async fetch(request, env, ctx) {
    try {
      return await router.fetch(request, env, ctx);
    } catch (error) {
      return errorHandler(error, env);
    }
  }
};
```

- [ ] **Step 4: Run the full suite**

Run: `cd workers/sangha-worker && npm test`
Expected: PASS — all suites including the new `/decap/auth` route test.

- [ ] **Step 5: Commit**

```bash
git add workers/sangha-worker/src/index.js workers/sangha-worker/test/index.test.js
git commit -m "feat(worker): register Decap OAuth routes"
```

---

## Task 3: Configure secrets & deploy the new endpoints

This task touches Cloudflare + GitHub, not code. Do it before flipping Decap's config.

- [ ] **Step 1: Add GitHub OAuth secrets to the Worker**

```bash
cd workers/sangha-worker
wrangler secret put GITHUB_CLIENT_ID       # reuse the existing Decap GitHub OAuth app's client id
wrangler secret put GITHUB_CLIENT_SECRET   # ...and its secret
```

(Reuse the same GitHub OAuth App currently backing `oauth-proxy`, or create a new one. Either works.)

- [ ] **Step 2: Add the new callback URL to the GitHub OAuth App**

In GitHub → Settings → Developer settings → OAuth Apps → (the Decap app):
add Authorization callback URL `https://sangha-worker.<subdomain>.workers.dev/decap/callback`. (GitHub OAuth Apps allow one callback URL per app; if reusing the existing app, update it to the new URL — the old `oauth-proxy` stays usable until cutover because we don't remove it yet. If that is a concern, create a second OAuth App for the new worker.)

- [ ] **Step 3: Deploy**

Run: `cd workers/sangha-worker && npm run deploy`

- [ ] **Step 4: Smoke-test the auth redirect**

Run: `curl -sI "https://sangha-worker.<subdomain>.workers.dev/decap/auth?provider=github" | grep -i location`
Expected: a `location:` header pointing at `github.com/login/oauth/authorize` with the `/decap/callback` redirect URI.

- [ ] **Step 5 (no commit — infra only).** Record the deployed Worker URL for the next task.

---

## Task 4: Point Decap CMS at the new Worker

**Files:**
- Modify: `site/static/admin/config.yml`

- [ ] **Step 1: Update the backend block**

In `site/static/admin/config.yml`, change the `base_url` and `auth_endpoint` (lines 5–6):

```yaml
backend:
  name: github
  repo: ec-buddhist-sangha/ec-buddhist-sangha
  branch: main
  base_url: https://sangha-worker.eau-claire-buddhist-sangha.workers.dev
  auth_endpoint: /decap/auth
```

(Replace the host with the actual deployed Worker URL from Task 3 if different.)

- [ ] **Step 2: Build the site**

Run: `cd site && hugo`
Expected: build succeeds; `site/public/admin/config.yml` reflects the new `base_url`/`auth_endpoint`.

- [ ] **Step 3: Verify the rendered admin config**

Run: `grep -E "base_url|auth_endpoint" site/public/admin/config.yml`
Expected: shows `https://sangha-worker...workers.dev` and `/decap/auth`.

- [ ] **Step 4: Manual login verification (the real test)**

Deploy the site (or run `cd site && npm run dev`), open `/admin/`, click **Login with GitHub**. Expected: GitHub OAuth popup → after authorizing, the popup closes and Decap loads the collections (events, announcements, pages, topics, calendar_admin). Create a trivial draft edit and confirm Decap can read/write the repo.

> If login fails, check: (a) the GitHub OAuth App callback URL exactly matches `/decap/callback`; (b) the Worker has `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` secrets; (c) the browser console for the `postMessage` origin.

- [ ] **Step 5: Commit**

```bash
git add site/static/admin/config.yml
git commit -m "feat(cms): point Decap OAuth at sangha-worker /decap endpoints"
```

---

## Task 5: Archive the old `oauth-proxy` Worker

Do this **only after** Task 4's manual login verification passes.

**Files:**
- Rename: `workers/oauth-proxy/` → `workers/_archived-oauth-proxy/`
- Create: `workers/_archived-oauth-proxy/ARCHIVED.md`

- [ ] **Step 1: Move the directory**

```bash
cd /Users/chriscortner/dev/projects/eau-claire-buddhist-sangha
git mv workers/oauth-proxy workers/_archived-oauth-proxy
```

- [ ] **Step 2: Add an archive note**

Create `workers/_archived-oauth-proxy/ARCHIVED.md`:

```markdown
# Archived: decap-oauth-proxy

Superseded by `workers/sangha-worker` (Decap GitHub OAuth now lives at
`/decap/auth` + `/decap/callback`). Kept for reference only — not deployed.

To fully remove the deployed Cloudflare Worker named `decap-oauth-proxy`:

    npx wrangler delete --name decap-oauth-proxy

Do this only after confirming Decap login works against sangha-worker in production.
```

- [ ] **Step 3: Verify the repo still builds and tests pass**

Run: `cd workers/sangha-worker && npm test && cd ../../site && hugo`
Expected: Worker tests PASS; Hugo build succeeds.

- [ ] **Step 4: Commit**

```bash
git add -A workers/_archived-oauth-proxy workers/oauth-proxy
git commit -m "chore(worker): archive standalone decap-oauth-proxy"
```

- [ ] **Step 5 (optional infra cleanup):** After production verification, delete the deployed old Worker: `npx wrangler delete --name decap-oauth-proxy`.

---

## Self-Review

**1. Spec coverage (Decap migration slice):**
- "Switch Decap CMS — Update config.yml to point at new Worker; verify Decap CMS login works; archive old `workers/oauth-proxy/`" (spec §Migration Path Phase 3) — Tasks 4, 5. ✓
- "Decap OAuth (ported from current proxy)" → `decap.js` module (spec §Worker Architecture) — Task 1. ✓
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` env vars (spec §Environment Variables) — Tasks 1, 3. ✓
- Rollback path ("switch Decap config.yml back to GitHub Worker if needed") — preserved: the old worker stays deployed until Task 5; reverting is a one-line `config.yml` change. ✓
- **Deviation documented:** spec's `/auth/admin` Google-for-Decap flow is replaced with the working GitHub flow under `/decap/*`, with full rationale in the Architecture section. ✓

**2. Placeholder scan:** No TBD/TODO/vague steps. The `postMessage` HTML and OAuth params are copied verbatim from the working proxy. Host placeholders (`<subdomain>`) are clearly marked as values to substitute, not code gaps. ✓

**3. Type consistency:** `handleDecapAuth(request, env)` and `handleDecapCallback(request, env, options)` signatures match their registration in `index.js`. `decapRedirectUri(request)` is used identically in both handlers (auth sets it; callback echoes it in the token exchange — GitHub requires them to match). `options.fetch` injection matches the convention from Plan 01. ✓
