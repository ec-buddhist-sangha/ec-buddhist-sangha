# Native D1 Comments — Implementation Plan (Plan 03)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the self-hosted Remark42/Isso comment stack with a native D1-backed `comments` table gated by the existing role system, plus a plain-text (XSS-safe) comments UI on Topics and Pages — eliminating the DigitalOcean server entirely.

**Architecture:** A new `comments` D1 table (single-level threading via `parent_id`). The worker's `comments.js` is rewritten from a Remark42 proxy into D1 CRUD: public `GET /api/comments?thread=…` (published only; soft-auth marks the caller's own rows), `POST` (member/admin), and `PATCH`/`DELETE` (author-or-admin). The site's `comments.html` partial drops the Remark42 embed for a small `ECBS.Comments` component that lists comments (rendered as escaped plain text) and offers a reply form to members. The Remark42/Isso config, secrets, and the `infra/isso/` stack are removed.

**Tech Stack:** Cloudflare Workers, itty-router, D1 (SQLite), vitest (`@cloudflare/vitest-pool-workers`) for the worker; Hugo + vanilla browser JS (IIFE, ES5 style) + Node's `node --test` for the site.

## Global Constraints

- Worker code: ES modules, plain JS (no TypeScript); handlers `(request, env, options = {})` returning via `jsonResponse(env, data, status)`; D1 via `env.DB.prepare(...).bind(...).first()/.run()/.all()` (`.run()` result exposes `meta.changes` and `meta.last_row_id`).
- Site JS: browser IIFE on `window.ECBS`, ES5-compatible (`var`/`function`; `async/await`/`fetch` OK), no bundler/TypeScript.
- Emails lowercased for comparison. `request.user` is `{sub, name, role}` (set by `requireRole`).
- Roles: reader/member/admin. Comment `status`: `published` | `hidden` | `deleted`. Only `published` is ever returned by `GET`.
- Comment bodies are **plain text**: max length **10000**; rendered by escaping (`esc()`), never as raw HTML (XSS guard). Newlines preserved with CSS `white-space: pre-wrap`.
- Threading is **single-level**: a reply's `parent_id` must reference a top-level comment in the same thread.
- Comment IDs are passed in the JSON body (`{id}`), matching this repo's existing body-based convention (e.g. `/api/signups` takes `itemId` in the body) — NOT as URL path params.
- Worker tests from `workers/sangha-worker/`: `npm test` / `npx vitest run test/<file>.js`. Site JS tests from `site/`: `node --test tests/<file>.js` (do NOT gate on `tests/calendar.test.js` — it has ~11 pre-existing date failures). Hugo build from `site/`: `hugo --gc --minify` exits 0.
- `site/` has a stray inner `.git`; the OUTER monorepo tracks `site/` files as normal blobs — commits must land in the outer repo, never in `site/.git`.
- Every commit message ends with the trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

## File Structure

- Create `workers/sangha-worker/migrations/0003_init_comments.sql` — `comments` table + indexes.
- Rewrite `workers/sangha-worker/src/comments.js` — D1 CRUD (`nestComments`, `handleGetComments`, `handlePostComment`, `handlePatchComment`, `handleDeleteComment`).
- Rewrite `workers/sangha-worker/test/comments.test.js` — D1 CRUD tests.
- Modify `workers/sangha-worker/src/index.js` — register GET (public) / POST / PATCH / DELETE `/api/comments`.
- Modify `workers/sangha-worker/test/index.test.js` — comments route tests.
- Modify `workers/sangha-worker/wrangler.toml` and `workers/sangha-worker/vitest.config.js` — remove `REMARK42_URL`, `REMARK42_SITE_ID`, `REMARK42_JWT_SECRET`.
- Create `site/static/js/comments.js` + `site/tests/comments.test.js` — the `ECBS.Comments` UI + unit tests.
- Rewrite `site/layouts/partials/comments.html` — mount the native component; drop the Remark42 embed.
- Modify `site/package.json` — include `tests/comments.test.js` in `test`.
- Delete `infra/isso/` — the retired Isso stack (history scrub of its committed secrets is out of scope; rotation is a deploy-time user action).

---

### Task 1: `comments` table + D1 CRUD in the worker

**Files:**
- Create: `workers/sangha-worker/migrations/0003_init_comments.sql`
- Rewrite: `workers/sangha-worker/src/comments.js`
- Rewrite: `workers/sangha-worker/test/comments.test.js`

**Interfaces:**
- Consumes: `jsonResponse`, `authenticate` (middleware); `env.DB`.
- Produces:
  - `nestComments(rows) -> rows[]` — pure; attaches `.replies[]` to top-level rows, single level.
  - `handleGetComments(request, env)` — public; `?thread=` required; returns `{comments}` (published only, nested), each row `{id, author_name, body, created_at, updated_at, own}` where `own` is true when a valid caller authored it (never exposes `author_email`).
  - `handlePostComment(request, env, options)` — `{thread, parent_id?, body}`; inserts published; returns `{id}` 201. Validates length ≤ 10000 and (if `parent_id`) that the parent is a top-level comment in the same thread.
  - `handlePatchComment(request, env, options)` — `{id, body}`; author-or-admin; edits body.
  - `handleDeleteComment(request, env, options)` — `{id}`; author-or-admin; author → `status='deleted'`, admin → `status='hidden'`.

- [ ] **Step 1: Create the migration**

`migrations/0003_init_comments.sql`:

```sql
-- Native comments: single-level threading, keyed to the page (thread) path.
CREATE TABLE IF NOT EXISTS comments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  thread       TEXT NOT NULL,
  parent_id    INTEGER REFERENCES comments(id),
  author_email TEXT NOT NULL,
  author_name  TEXT NOT NULL,
  body         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'published',
  created_at   TEXT NOT NULL,
  updated_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_comments_thread ON comments(thread, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id);
```

- [ ] **Step 2: Write the failing tests**

Rewrite `test/comments.test.js`:

```js
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { signJwt } from "../src/jwt.js";
import {
  nestComments, handleGetComments, handlePostComment, handlePatchComment, handleDeleteComment
} from "../src/comments.js";

const NOW = "2026-07-05T12:00:00.000Z";
beforeEach(async () => { await env.DB.prepare("DELETE FROM comments").run(); });

function post(user, body) {
  const r = new Request("https://worker.test/api/comments", { method: "POST", body: JSON.stringify(body) });
  r.user = user;
  return r;
}
async function getFor(thread, authHeader) {
  const init = authHeader ? { headers: { Authorization: authHeader } } : {};
  return handleGetComments(new Request("https://worker.test/api/comments?thread=" + encodeURIComponent(thread), init), env);
}
async function idToken(sub, name) {
  return "Bearer " + await signJwt({ sub, name }, env.JWT_SIGNING_SECRET, { expiresInSeconds: 600 });
}
const member = { sub: "m@x.org", name: "Mem", role: "member" };
const admin = { sub: "a@x.org", name: "Adm", role: "admin" };

describe("nestComments", () => {
  it("attaches replies to their top-level parent", () => {
    const roots = nestComments([
      { id: 1, parent_id: null }, { id: 2, parent_id: 1 }, { id: 3, parent_id: null }
    ]);
    expect(roots.map((r) => r.id)).toEqual([1, 3]);
    expect(roots[0].replies.map((r) => r.id)).toEqual([2]);
  });
});

describe("post + get", () => {
  it("member posts and anyone reads published comments (no email leak)", async () => {
    const created = await handlePostComment(post(member, { thread: "/topics/a/", body: "hello" }), env, { nowIso: NOW });
    expect(created.status).toBe(201);
    const res = await getFor("/topics/a/");
    const body = await res.json();
    expect(body.comments.length).toBe(1);
    expect(body.comments[0].body).toBe("hello");
    expect(body.comments[0].author_name).toBe("Mem");
    expect(body.comments[0].author_email).toBeUndefined();
    expect(body.comments[0].own).toBe(false); // anonymous reader
  });

  it("marks the caller's own comments when authenticated", async () => {
    await handlePostComment(post(member, { thread: "/t/", body: "mine" }), env, { nowIso: NOW });
    const res = await getFor("/t/", await idToken("m@x.org", "Mem"));
    expect((await res.json()).comments[0].own).toBe(true);
  });

  it("rejects an over-length body", async () => {
    const big = "x".repeat(10001);
    const res = await handlePostComment(post(member, { thread: "/t/", body: big }), env, { nowIso: NOW });
    expect(res.status).toBe(400);
  });

  it("rejects a reply to a non-existent or cross-thread parent", async () => {
    const c = await handlePostComment(post(member, { thread: "/t/", body: "root" }), env, { nowIso: NOW });
    const rootId = (await c.json()).id;
    const bad = await handlePostComment(post(member, { thread: "/other/", parent_id: rootId, body: "x" }), env, { nowIso: NOW });
    expect(bad.status).toBe(400);
    const missing = await handlePostComment(post(member, { thread: "/t/", parent_id: 9999, body: "x" }), env, { nowIso: NOW });
    expect(missing.status).toBe(400);
  });

  it("nests a valid reply under its parent", async () => {
    const c = await handlePostComment(post(member, { thread: "/t/", body: "root" }), env, { nowIso: NOW });
    const rootId = (await c.json()).id;
    await handlePostComment(post(admin, { thread: "/t/", parent_id: rootId, body: "reply" }), env, { nowIso: NOW });
    const body = await (await getFor("/t/")).json();
    expect(body.comments.length).toBe(1);
    expect(body.comments[0].replies.map((r) => r.body)).toEqual(["reply"]);
  });
});

describe("edit + delete", () => {
  async function seed(user, thread, text) {
    const res = await handlePostComment(post(user, { thread: thread, body: text }), env, { nowIso: NOW });
    return (await res.json()).id;
  }
  function withUser(user, body) { const r = new Request("https://worker.test/api/comments", { method: "PATCH", body: JSON.stringify(body) }); r.user = user; return r; }

  it("author edits own comment; a different member cannot", async () => {
    const id = await seed(member, "/t/", "orig");
    const ok = await handlePatchComment(withUser(member, { id: id, body: "edited" }), env, { nowIso: NOW });
    expect(ok.status).toBe(200);
    expect((await (await getFor("/t/")).json()).comments[0].body).toBe("edited");
    const other = await handlePatchComment(withUser({ sub: "z@x.org", name: "Z", role: "member" }, { id: id, body: "hax" }), env, { nowIso: NOW });
    expect(other.status).toBe(403);
  });

  it("admin can edit anyone's comment", async () => {
    const id = await seed(member, "/t/", "orig");
    const res = await handlePatchComment(withUser(admin, { id: id, body: "modded" }), env, { nowIso: NOW });
    expect(res.status).toBe(200);
  });

  it("author delete hides the comment from GET", async () => {
    const id = await seed(member, "/t/", "bye");
    const del = new Request("https://worker.test/api/comments", { method: "DELETE", body: JSON.stringify({ id: id }) });
    del.user = member;
    expect((await handleDeleteComment(del, env, { nowIso: NOW })).status).toBe(200);
    expect((await (await getFor("/t/")).json()).comments.length).toBe(0);
  });

  it("delete of unknown id is 404; missing id is 400", async () => {
    const del = new Request("https://worker.test/api/comments", { method: "DELETE", body: JSON.stringify({ id: 4242 }) });
    del.user = admin;
    expect((await handleDeleteComment(del, env, { nowIso: NOW })).status).toBe(404);
    const bad = new Request("https://worker.test/api/comments", { method: "DELETE", body: JSON.stringify({}) });
    bad.user = admin;
    expect((await handleDeleteComment(bad, env, { nowIso: NOW })).status).toBe(400);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run test/comments.test.js`
Expected: FAIL — `comments.js` still exports the Remark42 proxy (`buildRemarkClaims`), not the new functions.

- [ ] **Step 4: Rewrite `src/comments.js`**

```js
// workers/sangha-worker/src/comments.js
// Native D1-backed comments (replaces the Remark42 proxy). Single-level
// threading via parent_id; only 'published' rows are ever returned. Bodies are
// plain text — the client escapes them on render (no HTML is stored or trusted).
import { jsonResponse, authenticate } from "./middleware.js";

const MAX_BODY = 10000;

async function readJson(request) {
  try { return await request.json(); } catch (error) { return null; }
}

export function nestComments(rows) {
  var byId = {};
  var roots = [];
  (rows || []).forEach(function (r) { r.replies = []; byId[r.id] = r; });
  (rows || []).forEach(function (r) {
    if (r.parent_id != null && byId[r.parent_id]) byId[r.parent_id].replies.push(r);
    else roots.push(r);
  });
  return roots;
}

export async function handleGetComments(request, env) {
  const thread = new URL(request.url).searchParams.get("thread");
  if (!thread) return jsonResponse(env, { error: "bad_request" }, 400);
  const viewer = await authenticate(request, env); // soft auth: may be null
  const viewerEmail = viewer ? String(viewer.sub || "").toLowerCase() : null;
  const { results } = await env.DB
    .prepare("SELECT id, parent_id, author_email, author_name, body, created_at, updated_at FROM comments WHERE thread = ? AND status = 'published' ORDER BY created_at")
    .bind(thread).all();
  const rows = (results || []).map(function (r) {
    return {
      id: r.id, parent_id: r.parent_id, author_name: r.author_name, body: r.body,
      created_at: r.created_at, updated_at: r.updated_at,
      own: viewerEmail != null && String(r.author_email || "").toLowerCase() === viewerEmail
    };
  });
  return jsonResponse(env, { comments: nestComments(rows) });
}

export async function handlePostComment(request, env, options = {}) {
  const body = await readJson(request);
  if (!body || !body.thread || typeof body.body !== "string" || !body.body.trim()) {
    return jsonResponse(env, { error: "bad_request" }, 400);
  }
  if (body.body.length > MAX_BODY) return jsonResponse(env, { error: "text_too_long" }, 400);
  let parentId = null;
  if (body.parent_id != null && body.parent_id !== "") {
    parentId = Number(body.parent_id);
    const parent = await env.DB.prepare("SELECT thread, parent_id FROM comments WHERE id = ? AND status = 'published'").bind(parentId).first();
    if (!parent || parent.parent_id != null || parent.thread !== body.thread) {
      return jsonResponse(env, { error: "bad_parent" }, 400);
    }
  }
  const nowIso = options.nowIso || new Date().toISOString();
  const res = await env.DB
    .prepare("INSERT INTO comments (thread, parent_id, author_email, author_name, body, status, created_at) VALUES (?, ?, ?, ?, ?, 'published', ?)")
    .bind(body.thread, parentId, String(request.user.sub).toLowerCase(), request.user.name, body.body, nowIso)
    .run();
  return jsonResponse(env, { id: res.meta.last_row_id }, 201);
}

async function ownerOrAdmin(request, env, id) {
  const row = await env.DB.prepare("SELECT author_email FROM comments WHERE id = ? AND status != 'deleted'").bind(id).first();
  if (!row) return { notFound: true };
  const isAdmin = request.user.role === "admin";
  const isOwner = String(row.author_email || "").toLowerCase() === String(request.user.sub).toLowerCase();
  return { ok: isAdmin || isOwner, isAdmin: isAdmin };
}

export async function handlePatchComment(request, env, options = {}) {
  const body = await readJson(request);
  const id = body && body.id != null ? Number(body.id) : 0;
  if (!id || !body || typeof body.body !== "string" || !body.body.trim()) return jsonResponse(env, { error: "bad_request" }, 400);
  if (body.body.length > MAX_BODY) return jsonResponse(env, { error: "text_too_long" }, 400);
  const perm = await ownerOrAdmin(request, env, id);
  if (perm.notFound) return jsonResponse(env, { error: "not_found" }, 404);
  if (!perm.ok) return jsonResponse(env, { error: "forbidden" }, 403);
  const nowIso = options.nowIso || new Date().toISOString();
  await env.DB.prepare("UPDATE comments SET body = ?, updated_at = ? WHERE id = ?").bind(body.body, nowIso, id).run();
  return jsonResponse(env, { ok: true });
}

export async function handleDeleteComment(request, env, options = {}) {
  const body = await readJson(request);
  const id = body && body.id != null ? Number(body.id) : 0;
  if (!id) return jsonResponse(env, { error: "bad_request" }, 400);
  const perm = await ownerOrAdmin(request, env, id);
  if (perm.notFound) return jsonResponse(env, { error: "not_found" }, 404);
  if (!perm.ok) return jsonResponse(env, { error: "forbidden" }, 403);
  const nowIso = options.nowIso || new Date().toISOString();
  const status = perm.isAdmin ? "hidden" : "deleted";
  await env.DB.prepare("UPDATE comments SET status = ?, updated_at = ? WHERE id = ?").bind(status, nowIso, id).run();
  return jsonResponse(env, { ok: true });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/comments.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add workers/sangha-worker/migrations/0003_init_comments.sql workers/sangha-worker/src/comments.js workers/sangha-worker/test/comments.test.js
git commit -m "feat(worker): native D1 comments CRUD (replaces Remark42 proxy)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Wire comment routes; drop Remark42 config

**Files:**
- Modify: `workers/sangha-worker/src/index.js`
- Modify: `workers/sangha-worker/test/index.test.js`
- Modify: `workers/sangha-worker/wrangler.toml`, `workers/sangha-worker/vitest.config.js`

**Interfaces:**
- Consumes: `handleGetComments/handlePostComment/handlePatchComment/handleDeleteComment` (Task 1); `requireRole` (existing).

- [ ] **Step 1: Write failing route tests**

Add to the `describe("router", ...)` block in `test/index.test.js` (the `call`, `seedRole`, and `signJwt` helpers already exist):

```js
  it("GET /api/comments is public and returns an empty list for a fresh thread", async () => {
    await env.DB.prepare("DELETE FROM comments").run();
    const res = await call("/api/comments?thread=/topics/x/");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ comments: [] });
  });

  it("POST /api/comments requires member+, then persists", async () => {
    await env.DB.prepare("DELETE FROM comments").run();
    const anon = await call("/api/comments", { method: "POST", body: JSON.stringify({ thread: "/t/", body: "hi" }) });
    expect(anon.status).toBe(401);

    await seedRole("cm@eauclairesangha.org", "member");
    const token = await signJwt({ sub: "cm@eauclairesangha.org", name: "CM" }, env.JWT_SIGNING_SECRET, { expiresInSeconds: 600 });
    const ok = await call("/api/comments", { method: "POST", headers: { Authorization: "Bearer " + token }, body: JSON.stringify({ thread: "/t/", body: "hi" }) });
    expect(ok.status).toBe(201);
    const list = await call("/api/comments?thread=/t/");
    expect((await list.json()).comments.length).toBe(1);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/index.test.js`
Expected: FAIL — `/api/comments` GET returns 404 (only the old POST route exists) / POST behavior differs.

- [ ] **Step 3: Update `src/index.js`**

Replace the comments import:

```js
import { handlePostComment } from "./comments.js";
```

with:

```js
import {
  handleGetComments, handlePostComment, handlePatchComment, handleDeleteComment
} from "./comments.js";
```

Replace the single comments route:

```js
router.post("/api/comments", requireRole(["member", "admin"], handlePostComment));
```

with:

```js
router.get("/api/comments", (request, env) => handleGetComments(request, env));
router.post("/api/comments", requireRole(["member", "admin"], handlePostComment));
router.patch("/api/comments", requireRole(["member", "admin"], handlePatchComment));
router.delete("/api/comments", requireRole(["member", "admin"], handleDeleteComment));
```

- [ ] **Step 4: Run the route tests**

Run: `npx vitest run test/index.test.js`
Expected: PASS.

- [ ] **Step 5: Remove Remark42 config**

In `vitest.config.js`, delete these three binding lines:

```js
            REMARK42_URL: "https://comments.test",
            REMARK42_SITE_ID: "ec-buddhist-sangha",
            REMARK42_JWT_SECRET: "remark-shared-secret"
```

(Take care to leave the preceding line's trailing comma / brace valid — the last remaining binding line must not end with a dangling comma issue; `GITHUB_CLIENT_SECRET`/others remain.)

In `wrangler.toml`, remove `REMARK42_URL` and `REMARK42_SITE_ID` from `[vars]`, and remove the `REMARK42_JWT_SECRET` / `REMARK42_URL` lines from the secrets comment block.

- [ ] **Step 6: Full worker suite green**

Run: `npm test`
Expected: PASS across all worker test files. Then confirm no Remark42 references remain in code:
`grep -rn "REMARK42\|remark42\|buildRemarkClaims" src test` → no matches.

- [ ] **Step 7: Commit**

```bash
git add workers/sangha-worker/src/index.js workers/sangha-worker/test/index.test.js workers/sangha-worker/vitest.config.js workers/sangha-worker/wrangler.toml
git commit -m "feat(worker): register comment CRUD routes; drop Remark42 config

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `ECBS.Comments` site component

**Files:**
- Create: `site/static/js/comments.js`
- Create: `site/tests/comments.test.js`

**Interfaces:**
- Consumes: `ECBS.Auth.ready()/.getSession()/.getUser()/.isAdmin()/.fetch()`; worker `GET/POST/PATCH/DELETE /api/comments`; worker base from `<meta name="ecbs:worker-base">`.
- Produces on `window.ECBS.Comments`: `renderCommentsHtml(comments, ctx) -> string` (pure; `ctx = {canComment, isAdmin}`; escapes all user data; renders nested replies, and edit/delete controls for `own`/admin rows and a reply affordance under top-level comments when `canComment`); `init(root, deps)` (loads + wires; `deps` defaults to `ECBS.Auth`).

- [ ] **Step 1: Write failing tests**

`site/tests/comments.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function load() {
  const context = { window: {}, document: { getElementById: () => null, querySelector: () => null }, console, JSON, Object, Array, String };
  context.window.window = context.window;
  vm.createContext(context);
  const p = path.join(__dirname, "..", "static", "js", "comments.js");
  vm.runInContext(fs.readFileSync(p, "utf8"), context, { filename: p });
  return context.window.ECBS.Comments;
}

const sample = [
  { id: 1, author_name: "Mem", body: "hello", created_at: "2026-07-05", own: false, replies: [
    { id: 2, author_name: "Adm", body: "hi back", created_at: "2026-07-05", own: true, replies: [] }
  ] }
];

test("renders comment bodies and author names, escaped", () => {
  const html = load().renderCommentsHtml(
    [{ id: 9, author_name: "<b>x</b>", body: "<img src=x onerror=1>", created_at: "2026-07-05", own: false, replies: [] }],
    { canComment: false, isAdmin: false }
  );
  assert.ok(!html.includes("<img src=x"));
  assert.ok(!html.includes("<b>x</b>"));
  assert.ok(html.includes("&lt;img") && html.includes("&lt;b&gt;"));
});

test("renders a nested reply", () => {
  const html = load().renderCommentsHtml(sample, { canComment: false, isAdmin: false });
  assert.ok(html.includes("hello") && html.includes("hi back"));
});

test("shows reply controls only when canComment", () => {
  const off = load().renderCommentsHtml(sample, { canComment: false, isAdmin: false });
  assert.ok(!off.includes('data-reply="1"'));
  const on = load().renderCommentsHtml(sample, { canComment: true, isAdmin: false });
  assert.ok(on.includes('data-reply="1"'));
});

test("shows edit/delete for own comments and, for admin, all", () => {
  const asOwner = load().renderCommentsHtml(sample, { canComment: true, isAdmin: false });
  // id 2 is own -> has controls; id 1 not own, not admin -> no controls
  assert.ok(asOwner.includes('data-delete="2"'));
  assert.ok(!asOwner.includes('data-delete="1"'));
  const asAdmin = load().renderCommentsHtml(sample, { canComment: true, isAdmin: true });
  assert.ok(asAdmin.includes('data-delete="1"') && asAdmin.includes('data-delete="2"'));
});

test("empty state", () => {
  assert.ok(/no comments/i.test(load().renderCommentsHtml([], { canComment: false, isAdmin: false })));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `site/`): `node --test tests/comments.test.js`
Expected: FAIL — `comments.js` (the new one) does not exist yet.

- [ ] **Step 3: Write `site/static/js/comments.js`**

```js
// site/static/js/comments.js
// window.ECBS.Comments — native comment thread for Topics/Pages, backed by the
// worker's /api/comments. Bodies are rendered as escaped plain text (no HTML is
// trusted). Members/admins can post/reply/edit/delete; readers are prompted to
// request access.
(function () {
  "use strict";
  var ECBS = (window.ECBS = window.ECBS || {});

  function workerBase() {
    var meta = typeof document !== "undefined" ? document.querySelector('meta[name="ecbs:worker-base"]') : null;
    return meta ? (meta.getAttribute("content") || "").replace(/\/+$/, "") : "";
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function controls(c, ctx) {
    if (!(c.own || ctx.isAdmin)) return "";
    return '<span class="ml-3 text-xs">' +
      '<button type="button" data-edit="' + c.id + '" class="text-sangha-navy underline">edit</button> ' +
      '<button type="button" data-delete="' + c.id + '" class="text-red-600 underline">delete</button></span>';
  }
  function commentHtml(c, ctx, isReply) {
    var reply = (!isReply && ctx.canComment) ? '<button type="button" data-reply="' + c.id + '" class="mt-1 text-xs text-sangha-navy underline">reply</button>' : "";
    var kids = (c.replies || []).map(function (r) { return commentHtml(r, ctx, true); }).join("");
    return '<li class="' + (isReply ? "ml-6 mt-3" : "border-b border-gray-100 py-4") + '">' +
      '<div class="text-sm"><span class="font-bold text-sangha-navy">' + esc(c.author_name) + '</span> ' +
      '<span class="text-gray-400 text-xs">' + esc(c.created_at) + (c.updated_at ? " (edited)" : "") + '</span>' + controls(c, ctx) + '</div>' +
      '<div class="text-sm text-gray-700 mt-1" style="white-space:pre-wrap">' + esc(c.body) + '</div>' +
      reply +
      (kids ? '<ul>' + kids + '</ul>' : "") +
      '</li>';
  }

  function renderCommentsHtml(comments, ctx) {
    ctx = ctx || {};
    if (!comments || !comments.length) return '<p class="text-sm text-gray-500">No comments yet.</p>';
    return '<ul>' + comments.map(function (c) { return commentHtml(c, ctx, false); }).join("") + '</ul>';
  }

  function threadOf(root) {
    return root.getAttribute("data-thread") || (typeof window !== "undefined" ? window.location.pathname : "");
  }

  async function init(root, deps) {
    var auth = deps || ECBS.Auth;
    if (!root || !auth) return;
    await auth.ready();
    var base = workerBase();
    var thread = threadOf(root);
    var sess = auth.getSession && auth.getSession();
    var canComment = Boolean(sess && (sess.role === "member" || sess.role === "admin"));
    var ctx = { canComment: canComment, isAdmin: Boolean(auth.isAdmin && auth.isAdmin()) };

    function composer(parentId, currentText, editId) {
      return '<form data-composer class="mt-3" data-parent="' + (parentId || "") + '" data-edit-id="' + (editId || "") + '">' +
        '<textarea name="body" rows="3" maxlength="10000" class="w-full border border-gray-300 rounded p-2 text-sm" placeholder="Add a comment…">' + esc(currentText || "") + '</textarea>' +
        '<button type="submit" class="mt-2 rounded bg-sangha-navy text-white text-xs px-4 py-2">Post</button></form>';
    }

    async function load() {
      var res = await auth.fetch(base + "/api/comments?thread=" + encodeURIComponent(thread));
      if (!res.ok) { root.innerHTML = '<p class="text-sm text-red-600">Comments are unavailable right now.</p>'; return; }
      var data = await res.json();
      var html = renderCommentsHtml(data.comments, ctx);
      if (canComment) html += composer(null, "", null);
      else if (auth.isSignedIn && auth.isSignedIn()) html += '<p class="mt-3 text-sm text-gray-500">Your access request is pending, or you have read-only access.</p>';
      else html += '<p class="mt-3 text-sm text-gray-500">Sign in and request access to join the discussion.</p>';
      root.innerHTML = html;
      wire();
    }
    async function send(method, payload) {
      var res = await auth.fetch(base + "/api/comments", { method: method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      await load();
      return res.ok;
    }
    function wire() {
      var composerForm = root.querySelector("[data-composer]");
      root.querySelectorAll("[data-composer]").forEach(function (form) {
        form.addEventListener("submit", function (e) {
          e.preventDefault();
          var text = form.querySelector('[name="body"]').value;
          if (!text || !text.trim()) return;
          var editId = form.getAttribute("data-edit-id");
          var parent = form.getAttribute("data-parent");
          if (editId) send("PATCH", { id: Number(editId), body: text });
          else send("POST", { thread: thread, parent_id: parent ? Number(parent) : null, body: text });
        });
      });
      root.querySelectorAll("[data-reply]").forEach(function (b) {
        b.addEventListener("click", function () {
          if (b.nextElementSibling && b.nextElementSibling.getAttribute && b.nextElementSibling.getAttribute("data-composer") !== null) return;
          b.insertAdjacentHTML("afterend", composer(b.getAttribute("data-reply"), "", null));
          wire();
        });
      });
      root.querySelectorAll("[data-delete]").forEach(function (b) {
        b.addEventListener("click", function () { if (window.confirm("Delete this comment?")) send("DELETE", { id: Number(b.getAttribute("data-delete")) }); });
      });
      // edit handled inline: replace body with an edit composer
      root.querySelectorAll("[data-edit]").forEach(function (b) {
        b.addEventListener("click", function () {
          b.insertAdjacentHTML("afterend", composer(null, "", b.getAttribute("data-edit")));
          wire();
        });
      });
      if (composerForm) { /* top composer already wired above */ }
    }
    await load();
  }

  ECBS.Comments = { renderCommentsHtml: renderCommentsHtml, init: init };

  if (typeof document !== "undefined") {
    var start = function () { var root = document.getElementById("ecbs-comments"); if (root) init(root); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
  }
})();
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `site/`): `node --test tests/comments.test.js` (PASS) and `node --check static/js/comments.js` (valid JS).

- [ ] **Step 5: Commit**

```bash
git add site/static/js/comments.js site/tests/comments.test.js
git commit -m "feat(site): native comments component (ECBS.Comments)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Mount the component; drop the Remark42 embed

**Files:**
- Rewrite: `site/layouts/partials/comments.html`
- Modify: `site/package.json`

- [ ] **Step 1: Replace the partial**

Replace `site/layouts/partials/comments.html` with:

```html
{{ if or (eq .Section "topics") (eq .Section "pages") }}
<section id="comments" class="bg-sangha-light py-12">
  <div class="container mx-auto px-4 max-w-3xl">
    <h3 class="font-serif text-2xl font-bold text-sangha-navy mb-6">Discussion</h3>
    <div id="ecbs-comments" data-thread="{{ .RelPermalink }}"><p class="text-sm text-gray-500">Loading…</p></div>
    <noscript>
      <div class="bg-white rounded-xl border border-gray-200 p-6 text-center">
        <p class="text-gray-500 text-sm">Please enable JavaScript to view the discussion.</p>
      </div>
    </noscript>
  </div>
</section>
{{ $v := readFile "static/js/comments.js" | md5 }}
<script src="{{ "js/comments.js" | relURL }}?v={{ $v }}"></script>
{{ end }}
```

- [ ] **Step 2: Include the new test in `package.json`**

In `site/package.json`, change the `test` script to also run `tests/comments.test.js`:

```json
    "test": "node --test tests/calendar.test.js tests/calendar-api.test.js tests/auth.test.js tests/members-admin.test.js tests/comments.test.js"
```

- [ ] **Step 3: Build + verify**

Run (from `site/`): `hugo --gc --minify` → exits 0. Confirm a topic page embeds the component and NOT Remark42:
`grep -rl "remark42\|remark_config" public/ | head` → no matches; and a built topic page (e.g. `public/topics/*/index.html`) contains `id="ecbs-comments"`.

- [ ] **Step 4: Commit**

```bash
git add site/layouts/partials/comments.html site/package.json
git commit -m "feat(site): mount native comments; remove Remark42 embed

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Remove the Isso stack; final verification

**Files:**
- Delete: `infra/isso/`

- [ ] **Step 1: Remove the retired Isso stack**

```bash
git rm -r infra/isso
```
(If `infra/isso` holds files that are not tracked, remove them too so the directory is gone. History scrub of previously-committed secrets is OUT OF SCOPE — note it for the user to rotate; this step only removes them from HEAD.)

- [ ] **Step 2: Worker suite + site suites green**

Run (from `workers/sangha-worker/`): `npm test` → all pass; `grep -rn "REMARK42\|buildRemarkClaims" src test` → empty.
Run (from `site/`): `node --test tests/auth.test.js tests/members-admin.test.js tests/comments.test.js` → all pass. `hugo --gc --minify` → exits 0.

- [ ] **Step 3: Confirm Remark42/Isso fully gone**

Run (repo root): `grep -rn "remark42\|Remark42\|REMARK42\|isso\|Isso" workers/sangha-worker/src workers/sangha-worker/wrangler.toml site/layouts site/static/js` → no matches (docs/plans may still mention them historically — that's fine).

- [ ] **Step 4: Commit**

```bash
git add -A infra
git commit -m "chore: remove retired Isso stack (native D1 comments supersede it)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Deferred to User (deploy-time)

- Apply the new migration remotely: `npx wrangler d1 migrations apply sangha-calendar --remote`.
- Redeploy the worker (`npx wrangler deploy`); remove the `REMARK42_JWT_SECRET` secret from the Worker environment (`wrangler secret delete REMARK42_JWT_SECRET`).
- Decommission the Isso/DigitalOcean droplet if still present; **rotate the secrets that were committed under `infra/isso/`** (removed from HEAD here, but they remain in git history — rotation is the real mitigation).
- Signed-in end-to-end comment flow (post/reply/edit/delete/moderate) is a live-worker check.

## Self-Review

**Spec coverage** (design doc, comments items):
- `comments` D1 table (single-level threading) → Task 1. ✓
- Public GET (published only, no email leak), member POST, author/admin PATCH+DELETE (soft-delete/hide) → Task 1. ✓
- Length cap 10000; plain-text/escaped rendering (XSS) → Tasks 1 (cap) + 3 (escape). ✓
- Routes: GET public, POST/PATCH/DELETE gated member+ (with in-handler author-or-admin) → Task 2. ✓
- Remove Remark42 proxy + secrets/vars; rewrite comments.js → Tasks 1, 2. ✓
- Site component on Topics/Pages replacing the embed → Tasks 3, 4. ✓
- Remove `infra/isso/`; note secret rotation → Task 5 + Deferred. ✓

**Placeholder scan:** No TBD/TODO; every step has complete code/commands.

**Type/interface consistency:** `nestComments`/`handleGetComments`/`handlePostComment`/`handlePatchComment`/`handleDeleteComment` are defined in Task 1 and consumed by Task 2's routes and Task 1's tests. `renderCommentsHtml(comments, ctx)`/`init` on `ECBS.Comments` are defined+tested in Task 3 and mounted in Task 4. Body-based `{id}` for PATCH/DELETE is consistent across worker handlers, worker tests, and the site component. The `own` flag produced by `handleGetComments` is consumed by `renderCommentsHtml`'s edit/delete gating.
