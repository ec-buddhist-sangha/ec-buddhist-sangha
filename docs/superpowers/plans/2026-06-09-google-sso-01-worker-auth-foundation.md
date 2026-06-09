# Google SSO — Plan 01: Worker Auth Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up `workers/sangha-worker/` — a single Cloudflare Worker that authenticates users with Google SSO, verifies Google Group membership to assign a role (`admin`/`member`), and issues a stateless HMAC-signed site JWT that every other endpoint can verify.

**Architecture:** A `fetch` handler routed with `itty-router` (v4, same as the existing `oauth-proxy`). Login redirects to Google's OAuth consent screen carrying a signed `state`. The callback exchanges the code for an `id_token`, reads the user's email, checks their role in the Google Group via the Admin SDK Directory API (using a service-account access token minted with the OAuth 2.0 JWT-bearer flow), then signs an 8-hour site JWT and redirects back to the site with the JWT in the URL fragment. All secrets live in Worker env vars. This plan is the dependency for Plans 02 (Decap), 03 (Calendar D1), and 04 (Site frontend + Comments).

**Tech Stack:** Cloudflare Workers, `itty-router@^4`, Web Crypto (`crypto.subtle` — HMAC-SHA256 for site JWTs, RSASSA-PKCS1-v1_5/SHA-256 for the Google service-account assertion), `wrangler@^3`, `vitest@^2` with `@cloudflare/vitest-pool-workers`.

---

## Prerequisite — Task 0 (manual, blocks integration testing only)

Phase 1 of the spec is manual Google setup and is **not** code. The unit tests in this plan run without it (all network calls are mocked). End-to-end testing against real Google requires:

1. Enroll `eauclairesangha.org` in Google for Nonprofits; create the Workspace.
2. Create the Google Group `sangha@eauclairesangha.org`; add members; set OWNER/MANAGER for admins.
3. In Google Cloud Console: create a project, enable the **Admin SDK API**.
4. Create a **service account**; create a JSON key; enable **domain-wide delegation**; in the Workspace Admin console authorize the service account's client ID for scopes `https://www.googleapis.com/auth/admin.directory.group.member.readonly` and `https://www.googleapis.com/auth/admin.directory.group.readonly`.
5. Configure the **OAuth consent screen** as Internal.
6. Create an **OAuth client ID** (Web application). Add the authorized redirect URI `https://sangha-worker.<your-workers-subdomain>.workers.dev/auth/callback` (and later the production custom Worker route).

Capture these for Worker env vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_GROUP_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_KEY` (the entire JSON), `GOOGLE_ADMIN_EMAIL` (an admin user the service account impersonates), `JWT_SIGNING_SECRET` (generate with `openssl rand -base64 48`), `CORS_ORIGIN` (`https://eauclairesangha.org`).

---

## File Structure

```
workers/sangha-worker/
├── package.json              # deps + test/dev/deploy scripts
├── wrangler.toml             # Worker config (D1 binding added in Plan 03)
├── vitest.config.js          # @cloudflare/vitest-pool-workers config + test bindings
├── .dev.vars.example         # documents local secret names (real .dev.vars is gitignored)
├── README.md                 # env vars + deploy/test instructions
├── src/
│   ├── index.js              # itty-router entry, fetch handler
│   ├── jwt.js                # site JWT: signJwt / verifyJwt (HMAC-SHA256)
│   ├── service-account.js    # Google service-account access token (RS256 JWT-bearer)
│   ├── groups.js             # Admin SDK group membership → role
│   ├── google-oauth.js       # user OAuth: buildAuthUrl / exchangeCode / decodeIdToken
│   ├── auth.js               # handleLogin / handleCallback (issue site JWT)
│   └── middleware.js         # cors, authenticate, requireRole, jsonResponse, errorHandler
└── test/
    ├── jwt.test.js
    ├── service-account.test.js
    ├── groups.test.js
    ├── google-oauth.test.js
    ├── auth.test.js
    ├── middleware.test.js
    └── index.test.js
```

**Responsibilities:** Each `src` file has one concern so it stays in-context and unit-testable. `jwt.js` and `service-account.js` are pure crypto with no I/O beyond an injectable `fetch`. `groups.js` and `google-oauth.js` are thin API clients with injectable `fetch`. `auth.js` orchestrates the flow. `middleware.js` is shared by all later plans. `index.js` is only wiring.

The old `workers/oauth-proxy/` is **left untouched** in this plan — it keeps Decap working until Plan 02 re-homes and archives it.

---

## Conventions used across all four plans (define once here)

- **Site JWT claims:** `{ sub: <email>, name: <string>, role: "admin"|"member", iat, exp }`. TTL 8h.
- **Roles:** OWNER/MANAGER → `"admin"`, MEMBER → `"member"`, not-a-member → `null` (login rejected).
- **Module style:** ES modules (`type: "module"`), `export function`. Handlers receive `(request, env, ctx)`.
- **Injectable I/O:** every function that calls `fetch` accepts `options.fetch` and (where relevant) `options.now` / `options.accessToken` so tests never hit the network or the clock.
- **JSON responses** always go through `jsonResponse(env, data, status)` so CORS headers are attached uniformly.

---

## Task 1: Scaffold the Worker package

**Files:**
- Create: `workers/sangha-worker/package.json`
- Create: `workers/sangha-worker/wrangler.toml`
- Create: `workers/sangha-worker/vitest.config.js`
- Create: `workers/sangha-worker/.dev.vars.example`
- Modify: `.gitignore` (repo root) — ignore Worker secrets/build artifacts

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "sangha-worker",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.js",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "itty-router": "^4.0.0"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.5.2",
    "vitest": "^2.1.1",
    "wrangler": "^3.78.0"
  }
}
```

- [ ] **Step 2: Create `wrangler.toml`**

```toml
name = "sangha-worker"
main = "src/index.js"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]
keep_vars = true

# Non-secret vars (may also be set in the dashboard). Secrets are set with
# `wrangler secret put <NAME>` and are NEVER committed.
[vars]
GOOGLE_GROUP_EMAIL = "sangha@eauclairesangha.org"
GOOGLE_ADMIN_EMAIL = "admin@eauclairesangha.org"
GOOGLE_REDIRECT_URI = "https://sangha-worker.eau-claire-buddhist-sangha.workers.dev/auth/callback"
CORS_ORIGIN = "https://eauclairesangha.org"

# Secrets (set via `wrangler secret put`):
#   GOOGLE_CLIENT_ID
#   GOOGLE_CLIENT_SECRET
#   GOOGLE_SERVICE_ACCOUNT_KEY   (entire service-account JSON, one line)
#   JWT_SIGNING_SECRET
#
# Added in later plans:
#   Plan 02: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
#   Plan 04: REMARK42_JWT_SECRET, REMARK42_URL
#   Plan 03 adds the [[d1_databases]] binding below.
```

- [ ] **Step 3: Create `vitest.config.js`**

```js
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          // Test-only bindings. Production values come from the real Worker env.
          bindings: {
            JWT_SIGNING_SECRET: "test-signing-secret-please-change",
            GOOGLE_CLIENT_ID: "test-client-id",
            GOOGLE_CLIENT_SECRET: "test-client-secret",
            GOOGLE_REDIRECT_URI: "https://worker.test/auth/callback",
            GOOGLE_GROUP_EMAIL: "sangha@eauclairesangha.org",
            GOOGLE_ADMIN_EMAIL: "admin@eauclairesangha.org",
            CORS_ORIGIN: "https://eauclairesangha.org"
          }
        }
      }
    }
  }
});
```

- [ ] **Step 4: Create `.dev.vars.example`**

```
# Copy to .dev.vars for `wrangler dev`. .dev.vars is gitignored — never commit real secrets.
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_SERVICE_ACCOUNT_KEY=
JWT_SIGNING_SECRET=
```

- [ ] **Step 5: Append to root `.gitignore`**

```
# Cloudflare Worker secrets & build artifacts
workers/*/.dev.vars
workers/*/node_modules/
workers/*/.wrangler/
```

- [ ] **Step 6: Install dependencies**

Run: `cd workers/sangha-worker && npm install`
Expected: `node_modules/` created, no errors.

- [ ] **Step 7: Commit**

```bash
git add workers/sangha-worker/package.json workers/sangha-worker/wrangler.toml workers/sangha-worker/vitest.config.js workers/sangha-worker/.dev.vars.example .gitignore
git commit -m "chore(worker): scaffold sangha-worker package"
```

---

## Task 2: Site JWT — `signJwt` / `verifyJwt`

**Files:**
- Create: `workers/sangha-worker/src/jwt.js`
- Test: `workers/sangha-worker/test/jwt.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from "vitest";
import { signJwt, verifyJwt } from "../src/jwt.js";

const SECRET = "unit-test-secret";

describe("jwt", () => {
  it("round-trips claims and adds iat/exp", async () => {
    const token = await signJwt({ sub: "a@b.com", role: "member" }, SECRET, { expiresInSeconds: 3600, now: 1000 });
    const claims = await verifyJwt(token, SECRET, { now: 1000 });
    expect(claims.sub).toBe("a@b.com");
    expect(claims.role).toBe("member");
    expect(claims.iat).toBe(1000);
    expect(claims.exp).toBe(4600);
  });

  it("rejects a tampered payload", async () => {
    const token = await signJwt({ sub: "a@b.com" }, SECRET, { now: 1000 });
    const [h, , s] = token.split(".");
    const forged = h + "." + btoa(JSON.stringify({ sub: "evil@b.com" })).replace(/=+$/, "") + "." + s;
    expect(await verifyJwt(forged, SECRET, { now: 1000 })).toBeNull();
  });

  it("rejects the wrong secret", async () => {
    const token = await signJwt({ sub: "a@b.com" }, SECRET, { now: 1000 });
    expect(await verifyJwt(token, "other-secret", { now: 1000 })).toBeNull();
  });

  it("rejects an expired token", async () => {
    const token = await signJwt({ sub: "a@b.com" }, SECRET, { expiresInSeconds: 60, now: 1000 });
    expect(await verifyJwt(token, SECRET, { now: 2000 })).toBeNull();
  });

  it("rejects malformed input", async () => {
    expect(await verifyJwt("not-a-jwt", SECRET)).toBeNull();
    expect(await verifyJwt(null, SECRET)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd workers/sangha-worker && npx vitest run test/jwt.test.js`
Expected: FAIL — `Cannot find module '../src/jwt.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// workers/sangha-worker/src/jwt.js
// Stateless HMAC-SHA256 (HS256) JWTs for site sessions (members + admins).
// Any Worker endpoint verifies with the same JWT_SIGNING_SECRET — no session store.

function base64UrlEncodeBytes(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlEncodeString(str) {
  return base64UrlEncodeBytes(new TextEncoder().encode(str));
}

function base64UrlDecodeToString(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function importHmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export async function signJwt(payload, secret, options = {}) {
  const nowSeconds = options.now != null ? options.now : Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const claims = { iat: nowSeconds, ...payload };
  if (options.expiresInSeconds != null && claims.exp == null) {
    claims.exp = nowSeconds + options.expiresInSeconds;
  }
  const signingInput =
    base64UrlEncodeString(JSON.stringify(header)) + "." +
    base64UrlEncodeString(JSON.stringify(claims));
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput));
  return signingInput + "." + base64UrlEncodeBytes(signature);
}

export async function verifyJwt(token, secret, options = {}) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const signingInput = parts[0] + "." + parts[1];
  const key = await importHmacKey(secret);
  let expected;
  try {
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput));
    expected = base64UrlEncodeBytes(sig);
  } catch (error) {
    return null;
  }
  if (!timingSafeEqual(expected, parts[2])) return null;
  let claims;
  try {
    claims = JSON.parse(base64UrlDecodeToString(parts[1]));
  } catch (error) {
    return null;
  }
  const nowSeconds = options.now != null ? options.now : Math.floor(Date.now() / 1000);
  if (claims.exp != null && nowSeconds >= claims.exp) return null;
  return claims;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd workers/sangha-worker && npx vitest run test/jwt.test.js`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add workers/sangha-worker/src/jwt.js workers/sangha-worker/test/jwt.test.js
git commit -m "feat(worker): site JWT sign/verify (HS256)"
```

---

## Task 3: Google service-account access token

**Files:**
- Create: `workers/sangha-worker/src/service-account.js`
- Test: `workers/sangha-worker/test/service-account.test.js`

This mints a short-lived Google API access token via the OAuth 2.0 JWT-bearer flow. The assertion is signed RS256 with the service-account private key and impersonates `GOOGLE_ADMIN_EMAIL` (domain-wide delegation).

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect, beforeEach } from "vitest";
import { buildAssertionInput, getAccessToken, __resetTokenCacheForTests } from "../src/service-account.js";

// Generate a throwaway RSA key and export it as a PKCS8 PEM so the test can
// drive the real RS256 signing path without a checked-in private key.
async function makeServiceAccount() {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  );
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(pkcs8)));
  const pem = "-----BEGIN PRIVATE KEY-----\n" + b64.match(/.{1,64}/g).join("\n") + "\n-----END PRIVATE KEY-----\n";
  return {
    client_email: "svc@project.iam.gserviceaccount.com",
    private_key: pem,
    token_uri: "https://oauth2.googleapis.com/token"
  };
}

beforeEach(() => __resetTokenCacheForTests());

describe("service-account", () => {
  it("builds an assertion with the delegated subject and directory scopes", async () => {
    const sa = await makeServiceAccount();
    const { claims } = buildAssertionInput(sa, "admin@eauclairesangha.org", 1000);
    expect(claims.iss).toBe(sa.client_email);
    expect(claims.sub).toBe("admin@eauclairesangha.org");
    expect(claims.aud).toBe("https://oauth2.googleapis.com/token");
    expect(claims.scope).toContain("admin.directory.group.member.readonly");
    expect(claims.exp).toBe(4600);
  });

  it("exchanges the assertion for an access token and caches it", async () => {
    const sa = await makeServiceAccount();
    const env = { GOOGLE_SERVICE_ACCOUNT_KEY: JSON.stringify(sa), GOOGLE_ADMIN_EMAIL: "admin@eauclairesangha.org" };
    let calls = 0;
    const fetchImpl = async (url, init) => {
      calls++;
      expect(url).toBe("https://oauth2.googleapis.com/token");
      const body = new URLSearchParams(init.body);
      expect(body.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
      expect(body.get("assertion").split(".").length).toBe(3);
      return new Response(JSON.stringify({ access_token: "ya29.test", expires_in: 3600 }), { status: 200 });
    };
    const t1 = await getAccessToken(env, { fetch: fetchImpl, now: 1000 });
    const t2 = await getAccessToken(env, { fetch: fetchImpl, now: 1100 });
    expect(t1).toBe("ya29.test");
    expect(t2).toBe("ya29.test");
    expect(calls).toBe(1); // cached on second call
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd workers/sangha-worker && npx vitest run test/service-account.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// workers/sangha-worker/src/service-account.js
// Mints short-lived Google API access tokens from a service-account key using
// the OAuth 2.0 JWT-bearer flow (RS256), impersonating GOOGLE_ADMIN_EMAIL via
// domain-wide delegation. Used by groups.js to call the Admin SDK.

const DIRECTORY_SCOPES = [
  "https://www.googleapis.com/auth/admin.directory.group.member.readonly",
  "https://www.googleapis.com/auth/admin.directory.group.readonly"
].join(" ");

const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";

// Cache survives across requests on a warm isolate to avoid re-minting per request.
let cachedToken = null; // { accessToken, expiresAt }

function base64UrlBytes(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlString(str) {
  return base64UrlBytes(new TextEncoder().encode(str));
}

function pemToArrayBuffer(pem) {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export function buildAssertionInput(serviceAccount, subject, nowSeconds) {
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: serviceAccount.client_email,
    sub: subject,
    scope: DIRECTORY_SCOPES,
    aud: serviceAccount.token_uri || DEFAULT_TOKEN_URI,
    iat: nowSeconds,
    exp: nowSeconds + 3600
  };
  const signingInput =
    base64UrlString(JSON.stringify(header)) + "." + base64UrlString(JSON.stringify(claims));
  return { signingInput, claims };
}

async function signRs256(serviceAccount, signingInput) {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(serviceAccount.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput)
  );
  return base64UrlBytes(signature);
}

export async function getAccessToken(env, options = {}) {
  const nowSeconds = options.now != null ? options.now : Math.floor(Date.now() / 1000);
  if (!options.forceRefresh && cachedToken && cachedToken.expiresAt - 60 > nowSeconds) {
    return cachedToken.accessToken;
  }
  const serviceAccount = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const { signingInput } = buildAssertionInput(serviceAccount, env.GOOGLE_ADMIN_EMAIL, nowSeconds);
  const assertion = signingInput + "." + await signRs256(serviceAccount, signingInput);
  const tokenUri = serviceAccount.token_uri || DEFAULT_TOKEN_URI;
  const fetchImpl = options.fetch || fetch;
  const response = await fetchImpl(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  if (!response.ok) throw new Error("Google token exchange failed: " + response.status);
  const data = await response.json();
  cachedToken = { accessToken: data.access_token, expiresAt: nowSeconds + (data.expires_in || 3600) };
  return cachedToken.accessToken;
}

export function __resetTokenCacheForTests() {
  cachedToken = null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd workers/sangha-worker && npx vitest run test/service-account.test.js`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add workers/sangha-worker/src/service-account.js workers/sangha-worker/test/service-account.test.js
git commit -m "feat(worker): Google service-account access token (RS256 JWT-bearer)"
```

---

## Task 4: Group membership → role (`groups.js`)

**Files:**
- Create: `workers/sangha-worker/src/groups.js`
- Test: `workers/sangha-worker/test/groups.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from "vitest";
import { roleFromGroupRole, getGroupRole } from "../src/groups.js";

const env = { GOOGLE_GROUP_EMAIL: "sangha@eauclairesangha.org" };

describe("roleFromGroupRole", () => {
  it("maps Google group roles to site roles", () => {
    expect(roleFromGroupRole("OWNER")).toBe("admin");
    expect(roleFromGroupRole("MANAGER")).toBe("admin");
    expect(roleFromGroupRole("MEMBER")).toBe("member");
    expect(roleFromGroupRole("UNKNOWN")).toBeNull();
  });
});

describe("getGroupRole", () => {
  it("returns admin for an OWNER member", async () => {
    const fetchImpl = async (url, init) => {
      expect(url).toContain("/groups/sangha%40eauclairesangha.org/members/owner%40eauclairesangha.org");
      expect(init.headers.Authorization).toBe("Bearer test-token");
      return new Response(JSON.stringify({ role: "OWNER", status: "ACTIVE" }), { status: 200 });
    };
    const role = await getGroupRole(env, "owner@eauclairesangha.org", { fetch: fetchImpl, accessToken: "test-token" });
    expect(role).toBe("admin");
  });

  it("returns null when the user is not a member (404)", async () => {
    const fetchImpl = async () => new Response("{}", { status: 404 });
    const role = await getGroupRole(env, "stranger@example.com", { fetch: fetchImpl, accessToken: "t" });
    expect(role).toBeNull();
  });

  it("treats a suspended membership as not-a-member", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ role: "MEMBER", status: "SUSPENDED" }), { status: 200 });
    const role = await getGroupRole(env, "x@eauclairesangha.org", { fetch: fetchImpl, accessToken: "t" });
    expect(role).toBeNull();
  });

  it("throws on an unexpected API error", async () => {
    const fetchImpl = async () => new Response("nope", { status: 500 });
    await expect(getGroupRole(env, "x@eauclairesangha.org", { fetch: fetchImpl, accessToken: "t" })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd workers/sangha-worker && npx vitest run test/groups.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// workers/sangha-worker/src/groups.js
// Resolves a user's role from their membership in the Sangha Google Group,
// via the Admin SDK Directory API members.get endpoint.
import { getAccessToken } from "./service-account.js";

export function roleFromGroupRole(groupRole) {
  if (groupRole === "OWNER" || groupRole === "MANAGER") return "admin";
  if (groupRole === "MEMBER") return "member";
  return null;
}

export async function getGroupRole(env, email, options = {}) {
  const fetchImpl = options.fetch || fetch;
  const accessToken = options.accessToken || await getAccessToken(env, options);
  const url =
    "https://admin.googleapis.com/admin/directory/v1/groups/" +
    encodeURIComponent(env.GOOGLE_GROUP_EMAIL) +
    "/members/" + encodeURIComponent(email);
  const response = await fetchImpl(url, { headers: { Authorization: "Bearer " + accessToken } });
  if (response.status === 404) return null; // not a member
  if (!response.ok) throw new Error("Admin SDK members.get failed: " + response.status);
  const member = await response.json();
  if (member.status && member.status !== "ACTIVE") return null;
  return roleFromGroupRole(member.role);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd workers/sangha-worker && npx vitest run test/groups.test.js`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add workers/sangha-worker/src/groups.js workers/sangha-worker/test/groups.test.js
git commit -m "feat(worker): resolve site role from Google Group membership"
```

---

## Task 5: User OAuth client (`google-oauth.js`)

**Files:**
- Create: `workers/sangha-worker/src/google-oauth.js`
- Test: `workers/sangha-worker/test/google-oauth.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from "vitest";
import { buildAuthUrl, exchangeCode, decodeIdToken } from "../src/google-oauth.js";

const env = {
  GOOGLE_CLIENT_ID: "client-123",
  GOOGLE_CLIENT_SECRET: "secret-abc",
  GOOGLE_REDIRECT_URI: "https://worker.test/auth/callback"
};

function fakeIdToken(payload) {
  const enc = (o) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return enc({ alg: "RS256" }) + "." + enc(payload) + ".sig";
}

describe("google-oauth", () => {
  it("builds a consent URL with the expected params", () => {
    const url = new URL(buildAuthUrl(env, { state: "state-xyz" }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("redirect_uri")).toBe("https://worker.test/auth/callback");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("state")).toBe("state-xyz");
  });

  it("exchanges a code for tokens", async () => {
    const fetchImpl = async (url, init) => {
      expect(url).toBe("https://oauth2.googleapis.com/token");
      const body = new URLSearchParams(init.body);
      expect(body.get("code")).toBe("auth-code");
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("client_secret")).toBe("secret-abc");
      return new Response(JSON.stringify({ id_token: "idt", access_token: "at" }), { status: 200 });
    };
    const tokens = await exchangeCode(env, "auth-code", { fetch: fetchImpl });
    expect(tokens.id_token).toBe("idt");
  });

  it("decodes id_token claims", () => {
    const claims = decodeIdToken(fakeIdToken({ email: "User@Example.com", name: "User" }));
    expect(claims.email).toBe("User@Example.com");
    expect(claims.name).toBe("User");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd workers/sangha-worker && npx vitest run test/google-oauth.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// workers/sangha-worker/src/google-oauth.js
// Google OAuth 2.0 user login: build the consent URL, exchange the code for
// tokens, and read the id_token claims.

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export function buildAuthUrl(env, options = {}) {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", env.GOOGLE_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("access_type", "online");
  url.searchParams.set("prompt", "select_account");
  if (options.state) url.searchParams.set("state", options.state);
  return url.toString();
}

export async function exchangeCode(env, code, options = {}) {
  const fetchImpl = options.fetch || fetch;
  const response = await fetchImpl(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_REDIRECT_URI,
      grant_type: "authorization_code"
    })
  });
  if (!response.ok) throw new Error("Google code exchange failed: " + response.status);
  return response.json();
}

// Decodes (does not signature-verify) the id_token payload. Safe here because
// the token was returned directly from Google's token endpoint over TLS in
// exchangeCode, authenticated with our client_secret.
export function decodeIdToken(idToken) {
  const parts = String(idToken || "").split(".");
  if (parts.length !== 3) throw new Error("Malformed id_token");
  const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(bytes));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd workers/sangha-worker && npx vitest run test/google-oauth.test.js`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add workers/sangha-worker/src/google-oauth.js workers/sangha-worker/test/google-oauth.test.js
git commit -m "feat(worker): Google OAuth user login client"
```

---

## Task 6: Login + callback orchestration (`auth.js`)

**Files:**
- Create: `workers/sangha-worker/src/auth.js`
- Test: `workers/sangha-worker/test/auth.test.js`

The `state` parameter is a signed JWT (reusing `jwt.js`) carrying the post-login `return_to` URL with a 10-minute expiry — this provides CSRF protection without any server-side session store.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { handleLogin, handleCallback } from "../src/auth.js";
import { verifyJwt } from "../src/jwt.js";

function fakeIdToken(payload) {
  const enc = (o) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return enc({ alg: "RS256" }) + "." + enc(payload) + ".sig";
}

describe("handleLogin", () => {
  it("redirects to Google with a verifiable signed state", async () => {
    const req = new Request("https://worker.test/auth/login?return_to=https://eauclairesangha.org/calendar/");
    const res = await handleLogin(req, env);
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("Location"));
    expect(location.origin).toBe("https://accounts.google.com");
    const state = await verifyJwt(location.searchParams.get("state"), env.JWT_SIGNING_SECRET);
    expect(state.kind).toBe("login-state");
    expect(state.return_to).toBe("https://eauclairesangha.org/calendar/");
  });
});

describe("handleCallback", () => {
  // A mock fetch that answers both the token endpoint and the Admin SDK call.
  function mockFetch(idClaims, groupRole) {
    return async (url) => {
      if (url === "https://oauth2.googleapis.com/token") {
        return new Response(JSON.stringify({ id_token: fakeIdToken(idClaims), access_token: "at" }), { status: 200 });
      }
      if (String(url).includes("/admin/directory/")) {
        if (groupRole === null) return new Response("{}", { status: 404 });
        return new Response(JSON.stringify({ role: groupRole, status: "ACTIVE" }), { status: 200 });
      }
      throw new Error("unexpected fetch: " + url);
    };
  }

  async function callbackWith(idClaims, groupRole) {
    const state = await (await import("../src/jwt.js")).signJwt(
      { kind: "login-state", return_to: "https://eauclairesangha.org/calendar/" },
      env.JWT_SIGNING_SECRET, { expiresInSeconds: 600 }
    );
    const req = new Request("https://worker.test/auth/callback?code=auth-code&state=" + encodeURIComponent(state));
    return handleCallback(req, env, { fetch: mockFetch(idClaims, groupRole), accessToken: "svc-token" });
  }

  it("issues a member JWT in the redirect fragment for a group member", async () => {
    const res = await callbackWith({ email: "member@eauclairesangha.org", name: "Mem" }, "MEMBER");
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("Location"));
    expect(loc.origin + loc.pathname).toBe("https://eauclairesangha.org/calendar/");
    const token = new URLSearchParams(loc.hash.slice(1)).get("token");
    const claims = await verifyJwt(token, env.JWT_SIGNING_SECRET);
    expect(claims.sub).toBe("member@eauclairesangha.org");
    expect(claims.role).toBe("member");
  });

  it("issues an admin JWT for an OWNER", async () => {
    const res = await callbackWith({ email: "boss@eauclairesangha.org", name: "Boss" }, "OWNER");
    const loc = new URL(res.headers.get("Location"));
    const token = new URLSearchParams(loc.hash.slice(1)).get("token");
    const claims = await verifyJwt(token, env.JWT_SIGNING_SECRET);
    expect(claims.role).toBe("admin");
  });

  it("redirects with an error when the user is not a group member", async () => {
    const res = await callbackWith({ email: "stranger@example.com", name: "X" }, null);
    const loc = new URL(res.headers.get("Location"));
    expect(loc.hash).toContain("auth_error=not_a_member");
    expect(loc.hash).not.toContain("token=");
  });

  it("rejects a tampered/absent state", async () => {
    const req = new Request("https://worker.test/auth/callback?code=c&state=garbage");
    const res = await handleCallback(req, env, { fetch: async () => { throw new Error("should not fetch"); } });
    expect(new URL(res.headers.get("Location")).hash).toContain("auth_error=bad_state");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd workers/sangha-worker && npx vitest run test/auth.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// workers/sangha-worker/src/auth.js
// Orchestrates Google login: redirect to consent, then on callback exchange the
// code, verify Group membership, and issue an 8-hour site JWT in the redirect
// fragment. State is a signed JWT (CSRF protection, no server-side session).
import { buildAuthUrl, exchangeCode, decodeIdToken } from "./google-oauth.js";
import { getGroupRole } from "./groups.js";
import { signJwt, verifyJwt } from "./jwt.js";

const SITE_JWT_TTL_SECONDS = 8 * 60 * 60;
const STATE_TTL_SECONDS = 10 * 60;

// Only honor a caller-supplied return_to if it is on our own origin; otherwise
// fall back to CORS_ORIGIN. Prevents an open redirect that would leak the site
// JWT (carried in the URL fragment) to an attacker-controlled page.
function safeReturnTo(requested, env) {
  if (!requested) return env.CORS_ORIGIN;
  try {
    if (new URL(requested).origin === new URL(env.CORS_ORIGIN).origin) return requested;
  } catch (error) {
    // fall through to the safe default
  }
  return env.CORS_ORIGIN;
}

export async function handleLogin(request, env) {
  const requestUrl = new URL(request.url);
  const returnTo = safeReturnTo(requestUrl.searchParams.get("return_to"), env);
  const state = await signJwt(
    { kind: "login-state", return_to: returnTo },
    env.JWT_SIGNING_SECRET,
    { expiresInSeconds: STATE_TTL_SECONDS }
  );
  return Response.redirect(buildAuthUrl(env, { state }), 302);
}

export async function handleCallback(request, env, options = {}) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const stateParam = requestUrl.searchParams.get("state");
  if (!code || !stateParam) return errorRedirect(env, "missing_code");

  const state = await verifyJwt(stateParam, env.JWT_SIGNING_SECRET);
  if (!state || state.kind !== "login-state") return errorRedirect(env, "bad_state");

  let email = "";
  let name = "";
  try {
    const tokens = await exchangeCode(env, code, options);
    const claims = decodeIdToken(tokens.id_token);
    email = (claims.email || "").toLowerCase();
    name = claims.name || email;
  } catch (error) {
    return errorRedirect(env, "google_error");
  }
  if (!email) return errorRedirect(env, "no_email");

  let role;
  try {
    role = await getGroupRole(env, email, options);
  } catch (error) {
    return errorRedirect(env, "group_check_failed");
  }
  if (!role) return errorRedirect(env, "not_a_member");

  const siteJwt = await signJwt(
    { sub: email, name, role },
    env.JWT_SIGNING_SECRET,
    { expiresInSeconds: SITE_JWT_TTL_SECONDS }
  );
  const target = new URL(safeReturnTo(state.return_to, env));
  target.hash = "token=" + encodeURIComponent(siteJwt);
  return Response.redirect(target.toString(), 302);
}

function errorRedirect(env, reason) {
  const target = new URL(env.CORS_ORIGIN);
  target.hash = "auth_error=" + encodeURIComponent(reason);
  return Response.redirect(target.toString(), 302);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd workers/sangha-worker && npx vitest run test/auth.test.js`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add workers/sangha-worker/src/auth.js workers/sangha-worker/test/auth.test.js
git commit -m "feat(worker): Google login + callback issuing site JWT"
```

---

## Task 7: Middleware — CORS, auth, role gating (`middleware.js`)

**Files:**
- Create: `workers/sangha-worker/src/middleware.js`
- Test: `workers/sangha-worker/test/middleware.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { corsHeaders, jsonResponse, authenticate, requireRole, handlePreflight } from "../src/middleware.js";
import { signJwt } from "../src/jwt.js";

async function bearer(role) {
  const token = await signJwt({ sub: "u@eauclairesangha.org", name: "U", role }, env.JWT_SIGNING_SECRET, { expiresInSeconds: 600 });
  return "Bearer " + token;
}

describe("middleware", () => {
  it("jsonResponse attaches CORS headers", async () => {
    const res = jsonResponse(env, { ok: true }, 201);
    expect(res.status).toBe(201);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://eauclairesangha.org");
    expect(await res.json()).toEqual({ ok: true });
  });

  it("handlePreflight returns 204 with CORS headers", () => {
    const res = handlePreflight(new Request("https://worker.test/api/x", { method: "OPTIONS" }), env);
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });

  it("authenticate returns claims for a valid Bearer token", async () => {
    const req = new Request("https://worker.test/api/x", { headers: { Authorization: await bearer("member") } });
    const user = await authenticate(req, env);
    expect(user.role).toBe("member");
  });

  it("authenticate returns null without a token", async () => {
    expect(await authenticate(new Request("https://worker.test/api/x"), env)).toBeNull();
  });

  it("requireRole returns 401 without a token", async () => {
    const handler = requireRole(["member", "admin"], async () => jsonResponse(env, { reached: true }));
    const res = await handler(new Request("https://worker.test/api/x"), env);
    expect(res.status).toBe(401);
  });

  it("requireRole returns 403 for an insufficient role", async () => {
    const handler = requireRole(["admin"], async () => jsonResponse(env, { reached: true }));
    const req = new Request("https://worker.test/api/x", { headers: { Authorization: await bearer("member") } });
    const res = await handler(req, env);
    expect(res.status).toBe(403);
  });

  it("requireRole calls the handler and attaches request.user when authorized", async () => {
    const handler = requireRole(["admin"], async (request) => jsonResponse(env, { who: request.user.sub }));
    const req = new Request("https://worker.test/api/x", { headers: { Authorization: await bearer("admin") } });
    const res = await handler(req, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ who: "u@eauclairesangha.org" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd workers/sangha-worker && npx vitest run test/middleware.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// workers/sangha-worker/src/middleware.js
// Shared HTTP concerns: CORS, JSON responses, JWT authentication, role gating.
import { verifyJwt } from "./jwt.js";

export function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.CORS_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

export function handlePreflight(request, env) {
  return new Response(null, { status: 204, headers: corsHeaders(env) });
}

export function jsonResponse(env, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(env) }
  });
}

// Returns verified JWT claims, or null. Reads the Authorization: Bearer header.
export async function authenticate(request, env) {
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  return verifyJwt(match[1], env.JWT_SIGNING_SECRET);
}

// Wraps a handler so it only runs for an authenticated user whose role is in `roles`.
export function requireRole(roles, handler) {
  return async (request, env, ctx) => {
    const user = await authenticate(request, env);
    if (!user) return jsonResponse(env, { error: "unauthorized" }, 401);
    if (!roles.includes(user.role)) return jsonResponse(env, { error: "forbidden" }, 403);
    request.user = user;
    return handler(request, env, ctx);
  };
}

export function errorHandler(error, env) {
  return jsonResponse(
    env,
    { error: "internal_error", message: String(error && error.message ? error.message : error) },
    500
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd workers/sangha-worker && npx vitest run test/middleware.test.js`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add workers/sangha-worker/src/middleware.js workers/sangha-worker/test/middleware.test.js
git commit -m "feat(worker): CORS, JWT auth, and role-gating middleware"
```

---

## Task 8: Router entry point (`index.js`)

**Files:**
- Create: `workers/sangha-worker/src/index.js`
- Test: `workers/sangha-worker/test/index.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "../src/index.js";

async function call(path, init) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request("https://worker.test" + path, init), env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe("router", () => {
  it("health check returns ok", async () => {
    const res = await call("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://eauclairesangha.org");
  });

  it("/auth/login redirects to Google", async () => {
    const res = await call("/auth/login");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("accounts.google.com");
  });

  it("OPTIONS preflight returns 204", async () => {
    const res = await call("/api/health", { method: "OPTIONS" });
    expect(res.status).toBe(204);
  });

  it("unknown route returns 404 JSON", async () => {
    const res = await call("/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd workers/sangha-worker && npx vitest run test/index.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// workers/sangha-worker/src/index.js
// Single entry point for the Sangha Worker. Later plans register more routes here.
import { Router } from "itty-router";
import { handleLogin, handleCallback } from "./auth.js";
import { handlePreflight, jsonResponse, errorHandler } from "./middleware.js";

const router = Router();

router.options("*", (request, env) => handlePreflight(request, env));
router.get("/api/health", (request, env) => jsonResponse(env, { status: "ok" }));
router.get("/auth/login", (request, env) => handleLogin(request, env));
router.get("/auth/callback", (request, env) => handleCallback(request, env));
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

- [ ] **Step 4: Run the full test suite**

Run: `cd workers/sangha-worker && npm test`
Expected: PASS — all suites (jwt, service-account, groups, google-oauth, auth, middleware, index) green.

- [ ] **Step 5: Commit**

```bash
git add workers/sangha-worker/src/index.js workers/sangha-worker/test/index.test.js
git commit -m "feat(worker): router entry with health + auth routes"
```

---

## Task 9: README + deploy verification

**Files:**
- Create: `workers/sangha-worker/README.md`

- [ ] **Step 1: Write `README.md`**

````markdown
# sangha-worker

Single Cloudflare Worker for Eau Claire Buddhist Sangha: Google SSO, site JWT
issuance, Google Group role checks. Decap OAuth (Plan 02), calendar D1 API
(Plan 03), and comment proxy (Plan 04) are added to this same Worker.

## Endpoints (this plan)

| Method + Path        | Auth | Description                          |
|----------------------|------|--------------------------------------|
| `GET /api/health`    | None | Health check                         |
| `GET /auth/login`    | None | Start Google login (`?return_to=`)   |
| `GET /auth/callback` | None | Token exchange + group check + JWT   |

## Environment

Non-secret vars live in `wrangler.toml [vars]`. Secrets are set with:

```bash
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put GOOGLE_SERVICE_ACCOUNT_KEY   # paste the full service-account JSON
wrangler secret put JWT_SIGNING_SECRET           # openssl rand -base64 48
```

## Develop & test

```bash
npm install
npm test                 # vitest (all I/O mocked; no Google account needed)
cp .dev.vars.example .dev.vars   # fill in for live local runs
npm run dev              # wrangler dev
```

## Deploy

```bash
npm run deploy
```

After deploy, set the OAuth client's authorized redirect URI to the deployed
`/auth/callback` URL, and verify:

```bash
curl https://sangha-worker.<subdomain>.workers.dev/api/health   # {"status":"ok"}
```
````

- [ ] **Step 2: Verify deploy readiness (dry run)**

Run: `cd workers/sangha-worker && npx wrangler deploy --dry-run`
Expected: bundles successfully, prints the would-be upload with no errors.

- [ ] **Step 3: Commit**

```bash
git add workers/sangha-worker/README.md
git commit -m "docs(worker): sangha-worker README"
```

---

## Self-Review

**1. Spec coverage (Worker auth foundation slice of the spec):**
- Member login flow (`/auth/login` → Google → `/auth/callback` → group check → site JWT in fragment) — Tasks 5, 6, 8. ✓
- JWT design (`sub`, `name`, `role`, `iat`, `exp`; HS256; `JWT_SIGNING_SECRET`; 8h; stateless) — Task 2, claims set in Task 6. ✓
- Admin SDK group-membership check via service account with domain-wide delegation — Tasks 3, 4. ✓
- Role matrix (OWNER/MANAGER→admin, MEMBER→member) — `roleFromGroupRole`, Task 4. ✓
- `requireAuth`/`requireRole` middleware — Task 7 (`authenticate` + `requireRole`). ✓
- Env vars table (the auth-related subset) — Task 1 `wrangler.toml`. ✓
- Error handling rows (not-a-member, group-check-failed, JWT expired/tampered, admin without admin JWT) — Tasks 6 (`errorRedirect` reasons) + 7 (401/403). ✓
- Security (no client secrets, secret never leaves Worker, HTTPS, CORS to eauclairesangha.org) — Tasks 1, 7. ✓
- **Deferred to later plans (intentionally):** `/auth/admin` Decap route → Plan 02; calendar routes → Plan 03; `/api/comments` → Plan 04. The route table rows for those are out of scope here.

**2. Placeholder scan:** No TBD/TODO/"add error handling"/"similar to" — every code step is complete and runnable. ✓

**3. Type consistency:** JWT claim shape `{ sub, name, role, iat, exp }` is identical in `signJwt` usage (Task 6) and consumed by `authenticate`/`requireRole` (Task 7) and tests. `options.fetch`/`options.accessToken`/`options.now` injection names are consistent across `service-account.js`, `groups.js`, `google-oauth.js`, `auth.js`. `getGroupRole(env, email, options)` signature matches its call in `auth.js`. `jsonResponse(env, data, status)` argument order is consistent everywhere. ✓

**Note for executor:** Tasks 2–8 are pure unit tests with all network/clock injected, so they pass without any Google setup. Only live `wrangler dev`/deploy testing requires Prerequisite Task 0.
