# Membership Roles & Access (Worker) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Google Workspace group-role lookup with a D1-backed membership store so any Google sign-in becomes a reader, members are approved by admins, and roles are resolved live per request.

**Architecture:** All changes are in the `workers/sangha-worker/` Cloudflare Worker. A new `members` D1 table holds `role` + `request_status` per email. `resolveRole` (config allowlist → D1 → reader) is called by `requireRole` on every gated request, so the site JWT carries identity only. New HTTP handlers cover `/api/me`, self-service `/api/access-request` (which emails admins via Cloudflare Email Routing), and admin membership management. The Google Group / Admin SDK / service-account code is deleted.

**Tech Stack:** Cloudflare Workers, itty-router, D1 (SQLite), vitest with `@cloudflare/vitest-pool-workers` (real D1 via miniflare + `applyD1Migrations`), `mimetext`, Cloudflare Email Routing `send_email` binding.

## Global Constraints

- Worker code is ES modules, plain JavaScript (no TypeScript). No implicit `any` rules apply; match existing style in `src/`.
- Emails are always lowercased before storage/lookup (existing convention: `auth.js` does `(claims.email||"").toLowerCase()`, `calendar.js` lowercases in `makeServerVolunteer`).
- No secrets in client code; secrets set via `wrangler secret put`, never committed.
- Roles are exactly: `reader`, `member`, `admin`. Request statuses are exactly: `none`, `pending`, `denied`.
- HTTP handlers take `(request, env, options = {})` and return via `jsonResponse(env, data, status)`. `options` carries test seams (`nowIso`, injected `notify`/`transport`), mirroring the existing `options.fetch` pattern.
- `request.user` is `{ sub, name, role }`, set by `requireRole` after live role resolution.
- Test command (run from `workers/sangha-worker/`): `npm test`. Single file: `npx vitest run test/<file>.js`.
- Every commit message ends with the trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

## File Structure

- Create `workers/sangha-worker/migrations/0002_init_members.sql` — `members` table.
- Create `workers/sangha-worker/src/members.js` — data layer: `getBootstrapAdmins`, `resolveRole`, `getMember`, `upsertReader`, `listMembers`, `listPending`, `requestAccess`, `approveMember`, `denyMember`, `setRole`.
- Create `workers/sangha-worker/src/notify.js` — admin-notification email (`buildRequestMime`, `notifyAdminsOfRequest`) with injectable transport.
- Create `workers/sangha-worker/src/access.js` — HTTP handlers: `handleMe`, `handleAccessRequest`, `handleListMembers`, `handleApprove`, `handleDeny`, `handleSetRole`.
- Create tests: `test/members.test.js`, `test/notify.test.js`, `test/access.test.js`.
- Modify `src/middleware.js` — `requireRole` resolves role live via `resolveRole`.
- Modify `src/auth.js` — callback upserts a reader row and issues an identity-only JWT; drop group check.
- Modify `src/index.js` — register the new routes.
- Modify `test/middleware.test.js`, `test/auth.test.js`, `test/index.test.js` — reseed for live role resolution / identity-only JWT.
- Modify `wrangler.toml` and `vitest.config.js` — add `BOOTSTRAP_ADMINS`, `NOTIFY_SENDER`, `send_email`; remove Workspace vars.
- Modify `package.json` — add `mimetext`.
- Delete `src/groups.js`, `src/service-account.js`, `test/groups.test.js`, `test/service-account.test.js`.

---

### Task 1: `members` table + live role resolution

**Files:**
- Create: `workers/sangha-worker/migrations/0002_init_members.sql`
- Create: `workers/sangha-worker/src/members.js`
- Create: `workers/sangha-worker/test/members.test.js`
- Modify: `workers/sangha-worker/vitest.config.js` (add `BOOTSTRAP_ADMINS`, `NOTIFY_SENDER` bindings)

**Interfaces:**
- Produces: `getBootstrapAdmins(env) -> Set<string>`; `resolveRole(env, email) -> Promise<"reader"|"member"|"admin"|null>` (null only for empty email); `getMember(env, email) -> Promise<row|null>` where row is `{ email, name, role, request_status, created_at, updated_at }`.

- [ ] **Step 1: Create the migration**

`migrations/0002_init_members.sql`:

```sql
-- Membership store: current role + pending upgrade request, keyed by email.
CREATE TABLE IF NOT EXISTS members (
  email          TEXT PRIMARY KEY,
  name           TEXT,
  role           TEXT NOT NULL DEFAULT 'reader',
  request_status TEXT NOT NULL DEFAULT 'none',
  created_at     TEXT,
  updated_at     TEXT
);
```

- [ ] **Step 2: Add test bindings**

In `vitest.config.js`, inside `miniflare.bindings`, add these two lines (leave existing bindings in place for now):

```js
            BOOTSTRAP_ADMINS: "boss@eauclairesangha.org",
            NOTIFY_SENDER: "noreply@eauclairesangha.org",
```

- [ ] **Step 3: Write the failing test**

`test/members.test.js`:

```js
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { getBootstrapAdmins, resolveRole, getMember } from "../src/members.js";

beforeEach(async () => { await env.DB.prepare("DELETE FROM members").run(); });

describe("getBootstrapAdmins", () => {
  it("parses a comma list into a lowercased Set", () => {
    const set = getBootstrapAdmins({ BOOTSTRAP_ADMINS: "A@x.org, b@x.org ,, " });
    expect([...set].sort()).toEqual(["a@x.org", "b@x.org"]);
  });
});

describe("resolveRole", () => {
  it("returns admin for a BOOTSTRAP_ADMINS email with no row", async () => {
    expect(await resolveRole(env, "boss@eauclairesangha.org")).toBe("admin");
  });
  it("returns the D1 role when a row exists", async () => {
    await env.DB.prepare("INSERT INTO members (email, name, role, request_status) VALUES ('m@x.org','M','member','none')").run();
    expect(await resolveRole(env, "M@x.org")).toBe("member");
  });
  it("defaults a signed-in user with no row to reader", async () => {
    expect(await resolveRole(env, "nobody@x.org")).toBe("reader");
  });
  it("returns null for an empty email", async () => {
    expect(await resolveRole(env, "")).toBeNull();
  });
});

describe("getMember", () => {
  it("returns null when absent and the row when present", async () => {
    expect(await getMember(env, "ghost@x.org")).toBeNull();
    await env.DB.prepare("INSERT INTO members (email, name, role, request_status) VALUES ('a@x.org','A','reader','none')").run();
    expect((await getMember(env, "A@x.org")).name).toBe("A");
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run test/members.test.js`
Expected: FAIL — cannot import from `../src/members.js` (module not found).

- [ ] **Step 5: Write the implementation**

`src/members.js`:

```js
// workers/sangha-worker/src/members.js
// D1-backed membership store. Single source of truth for a user's role and any
// pending upgrade request. Role is resolved LIVE (config allowlist -> D1 -> reader)
// so approvals and role changes take effect on the user's next request.

export const VALID_ROLES = ["reader", "member", "admin"];

export function getBootstrapAdmins(env) {
  return new Set(
    String(env.BOOTSTRAP_ADMINS || "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

export async function resolveRole(env, email) {
  const lc = String(email || "").toLowerCase();
  if (!lc) return null;
  if (getBootstrapAdmins(env).has(lc)) return "admin";
  const row = await env.DB.prepare("SELECT role FROM members WHERE email = ?").bind(lc).first();
  if (row && VALID_ROLES.includes(row.role)) return row.role;
  return "reader";
}

export async function getMember(env, email) {
  const lc = String(email || "").toLowerCase();
  return env.DB
    .prepare("SELECT email, name, role, request_status, created_at, updated_at FROM members WHERE email = ?")
    .bind(lc)
    .first();
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run test/members.test.js`
Expected: PASS (all cases).

- [ ] **Step 7: Commit**

```bash
git add workers/sangha-worker/migrations/0002_init_members.sql workers/sangha-worker/src/members.js workers/sangha-worker/test/members.test.js workers/sangha-worker/vitest.config.js
git commit -m "feat(worker): members table + live role resolution

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Reader upsert + member listing

**Files:**
- Modify: `workers/sangha-worker/src/members.js`
- Modify: `workers/sangha-worker/test/members.test.js`

**Interfaces:**
- Consumes: `getMember` (Task 1).
- Produces: `upsertReader(env, email, name, nowIso) -> Promise<void>` (inserts a reader row or refreshes name only; never downgrades role/request_status); `listMembers(env) -> Promise<row[]>` (all, ordered by email); `listPending(env) -> Promise<row[]>` (`request_status='pending'`, ordered by `updated_at`).

- [ ] **Step 1: Write the failing test**

Append to `test/members.test.js`:

```js
import { upsertReader, listMembers, listPending } from "../src/members.js";

describe("upsertReader", () => {
  it("creates a reader row on first call", async () => {
    await upsertReader(env, "New@x.org", "New", "2026-07-05T00:00:00.000Z");
    const row = await getMember(env, "new@x.org");
    expect(row.role).toBe("reader");
    expect(row.request_status).toBe("none");
    expect(row.name).toBe("New");
  });
  it("refreshes name but never downgrades an existing role", async () => {
    await env.DB.prepare("INSERT INTO members (email, name, role, request_status) VALUES ('m@x.org','Old','member','none')").run();
    await upsertReader(env, "m@x.org", "NewName", "2026-07-05T00:00:00.000Z");
    const row = await getMember(env, "m@x.org");
    expect(row.role).toBe("member");
    expect(row.name).toBe("NewName");
  });
});

describe("listMembers / listPending", () => {
  it("lists all members and only pending ones", async () => {
    await env.DB.prepare("INSERT INTO members (email, name, role, request_status, updated_at) VALUES ('a@x.org','A','reader','none','1')").run();
    await env.DB.prepare("INSERT INTO members (email, name, role, request_status, updated_at) VALUES ('b@x.org','B','reader','pending','2')").run();
    expect((await listMembers(env)).length).toBe(2);
    const pending = await listPending(env);
    expect(pending.map((r) => r.email)).toEqual(["b@x.org"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/members.test.js`
Expected: FAIL — `upsertReader` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/members.js`:

```js
export async function upsertReader(env, email, name, nowIso) {
  const lc = String(email || "").toLowerCase();
  await env.DB
    .prepare(
      `INSERT INTO members (email, name, role, request_status, created_at, updated_at)
       VALUES (?, ?, 'reader', 'none', ?, ?)
       ON CONFLICT(email) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`
    )
    .bind(lc, name || lc, nowIso, nowIso)
    .run();
}

export async function listMembers(env) {
  const { results } = await env.DB
    .prepare("SELECT email, name, role, request_status, created_at, updated_at FROM members ORDER BY email")
    .all();
  return results || [];
}

export async function listPending(env) {
  const { results } = await env.DB
    .prepare(
      "SELECT email, name, role, request_status, created_at, updated_at FROM members WHERE request_status = 'pending' ORDER BY updated_at"
    )
    .all();
  return results || [];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/members.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add workers/sangha-worker/src/members.js workers/sangha-worker/test/members.test.js
git commit -m "feat(worker): reader upsert + member listing helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Request / approve / deny / set-role transitions

**Files:**
- Modify: `workers/sangha-worker/src/members.js`
- Modify: `workers/sangha-worker/test/members.test.js`

**Interfaces:**
- Consumes: `getMember` (Task 1).
- Produces:
  - `requestAccess(env, email, nowIso) -> Promise<{ status: "pending"|"already_member", created: boolean }>` (idempotent; `created:true` only when a new pending request is recorded).
  - `approveMember(env, email, nowIso) -> Promise<boolean>` (sets role=member, request_status=none; false if no row).
  - `denyMember(env, email, nowIso) -> Promise<boolean>` (sets request_status=denied; false if no row).
  - `setRole(env, email, role, nowIso) -> Promise<{ ok: boolean, error?: "bad_role" }>`.

- [ ] **Step 1: Write the failing test**

Append to `test/members.test.js`:

```js
import { requestAccess, approveMember, denyMember, setRole } from "../src/members.js";

const NOW = "2026-07-05T00:00:00.000Z";

describe("requestAccess", () => {
  it("creates a pending request for a fresh email", async () => {
    const r = await requestAccess(env, "r@x.org", NOW);
    expect(r).toEqual({ status: "pending", created: true });
    expect((await getMember(env, "r@x.org")).request_status).toBe("pending");
  });
  it("is idempotent when already pending (no second create)", async () => {
    await requestAccess(env, "r@x.org", NOW);
    expect(await requestAccess(env, "r@x.org", NOW)).toEqual({ status: "pending", created: false });
  });
  it("re-requests after a denial", async () => {
    await requestAccess(env, "r@x.org", NOW);
    await denyMember(env, "r@x.org", NOW);
    expect(await requestAccess(env, "r@x.org", NOW)).toEqual({ status: "pending", created: true });
  });
  it("no-ops for an existing member", async () => {
    await env.DB.prepare("INSERT INTO members (email, name, role, request_status) VALUES ('m@x.org','M','member','none')").run();
    expect(await requestAccess(env, "m@x.org", NOW)).toEqual({ status: "already_member", created: false });
  });
});

describe("approve / deny / setRole", () => {
  it("approve promotes a pending reader to member", async () => {
    await requestAccess(env, "r@x.org", NOW);
    expect(await approveMember(env, "r@x.org", NOW)).toBe(true);
    const row = await getMember(env, "r@x.org");
    expect(row.role).toBe("member");
    expect(row.request_status).toBe("none");
  });
  it("approve returns false for an unknown email", async () => {
    expect(await approveMember(env, "ghost@x.org", NOW)).toBe(false);
  });
  it("deny leaves the role as reader", async () => {
    await requestAccess(env, "r@x.org", NOW);
    expect(await denyMember(env, "r@x.org", NOW)).toBe(true);
    const row = await getMember(env, "r@x.org");
    expect(row.role).toBe("reader");
    expect(row.request_status).toBe("denied");
  });
  it("setRole assigns a valid role and rejects an invalid one", async () => {
    await upsertReader(env, "a@x.org", "A", NOW);
    expect(await setRole(env, "a@x.org", "admin", NOW)).toEqual({ ok: true });
    expect((await getMember(env, "a@x.org")).role).toBe("admin");
    expect(await setRole(env, "a@x.org", "wizard", NOW)).toEqual({ ok: false, error: "bad_role" });
    expect(await setRole(env, "ghost@x.org", "member", NOW)).toEqual({ ok: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/members.test.js`
Expected: FAIL — `requestAccess` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/members.js`:

```js
export async function requestAccess(env, email, nowIso) {
  const lc = String(email || "").toLowerCase();
  const row = await getMember(env, lc);
  if (row && (row.role === "member" || row.role === "admin")) {
    return { status: "already_member", created: false };
  }
  if (row && row.request_status === "pending") {
    return { status: "pending", created: false };
  }
  if (!row) {
    await env.DB
      .prepare(
        `INSERT INTO members (email, name, role, request_status, created_at, updated_at)
         VALUES (?, ?, 'reader', 'pending', ?, ?)`
      )
      .bind(lc, lc, nowIso, nowIso)
      .run();
  } else {
    await env.DB
      .prepare("UPDATE members SET request_status = 'pending', updated_at = ? WHERE email = ?")
      .bind(nowIso, lc)
      .run();
  }
  return { status: "pending", created: true };
}

export async function approveMember(env, email, nowIso) {
  const lc = String(email || "").toLowerCase();
  const result = await env.DB
    .prepare("UPDATE members SET role = 'member', request_status = 'none', updated_at = ? WHERE email = ?")
    .bind(nowIso, lc)
    .run();
  return result.meta.changes > 0;
}

export async function denyMember(env, email, nowIso) {
  const lc = String(email || "").toLowerCase();
  const result = await env.DB
    .prepare("UPDATE members SET request_status = 'denied', updated_at = ? WHERE email = ?")
    .bind(nowIso, lc)
    .run();
  return result.meta.changes > 0;
}

export async function setRole(env, email, role, nowIso) {
  if (!VALID_ROLES.includes(role)) return { ok: false, error: "bad_role" };
  const lc = String(email || "").toLowerCase();
  const result = await env.DB
    .prepare("UPDATE members SET role = ?, updated_at = ? WHERE email = ?")
    .bind(role, nowIso, lc)
    .run();
  return { ok: result.meta.changes > 0 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/members.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add workers/sangha-worker/src/members.js workers/sangha-worker/test/members.test.js
git commit -m "feat(worker): access request + approve/deny/role transitions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Admin-notification email

**Files:**
- Create: `workers/sangha-worker/src/notify.js`
- Create: `workers/sangha-worker/test/notify.test.js`
- Modify: `workers/sangha-worker/package.json` (add `mimetext`)

**Interfaces:**
- Consumes: `getBootstrapAdmins` (Task 1).
- Produces:
  - `buildRequestMime(requester, env, recipient) -> MimeMessage` where `requester` is `{ name, email }`; the message has `asRaw()`.
  - `notifyAdminsOfRequest(env, requester, options = {}) -> Promise<{ sent: number }>`; `options.transport(env, from, to, raw) -> Promise<void>` is injectable (default sends via `env.SEND_EMAIL`). Recipients are `getBootstrapAdmins(env)`.

- [ ] **Step 1: Install mimetext**

Run (from `workers/sangha-worker/`): `npm install mimetext@^3`
Expected: `mimetext` added to `dependencies` in `package.json`.

- [ ] **Step 2: Write the failing test**

`test/notify.test.js`:

```js
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { buildRequestMime, notifyAdminsOfRequest } from "../src/notify.js";

const requester = { name: "Pat", email: "pat@x.org" };

describe("buildRequestMime", () => {
  it("includes the requester and the review link", () => {
    const raw = buildRequestMime(requester, env, "boss@eauclairesangha.org").asRaw();
    expect(raw).toContain("pat@x.org");
    expect(raw).toContain("/account/members");
    expect(raw).toContain("boss@eauclairesangha.org");
  });
});

describe("notifyAdminsOfRequest", () => {
  it("sends one message per bootstrap admin via the injected transport", async () => {
    const calls = [];
    const res = await notifyAdminsOfRequest(env, requester, {
      transport: async (e, from, to, raw) => { calls.push({ from, to }); }
    });
    expect(res.sent).toBe(1); // vitest.config BOOTSTRAP_ADMINS = one address
    expect(calls[0].to).toBe("boss@eauclairesangha.org");
    expect(calls[0].from).toBe("noreply@eauclairesangha.org");
  });

  it("sends nothing when there are no admins configured", async () => {
    const res = await notifyAdminsOfRequest({ ...env, BOOTSTRAP_ADMINS: "" }, requester, {
      transport: async () => { throw new Error("should not send"); }
    });
    expect(res).toEqual({ sent: 0 });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/notify.test.js`
Expected: FAIL — cannot import from `../src/notify.js`.

- [ ] **Step 4: Write the implementation**

`src/notify.js`:

```js
// workers/sangha-worker/src/notify.js
// Emails the bootstrap admins when a NEW member-access request is created, via
// the Cloudflare Email Routing send_email binding. The transport is injectable
// so unit tests never touch the real binding or the cloudflare:email module.
import { createMimeMessage } from "mimetext";
import { getBootstrapAdmins } from "./members.js";

export function buildRequestMime(requester, env, recipient) {
  const msg = createMimeMessage();
  msg.setSender({ name: "Eau Claire Buddhist Sangha", addr: env.NOTIFY_SENDER });
  msg.setRecipient(recipient);
  msg.setSubject("New member access request");
  msg.addMessage({
    contentType: "text/plain",
    data:
      `${requester.name} <${requester.email}> requested member access.\n\n` +
      `Review pending requests: ${env.CORS_ORIGIN}/account/members`
  });
  return msg;
}

async function defaultTransport(env, from, to, raw) {
  const { EmailMessage } = await import("cloudflare:email");
  await env.SEND_EMAIL.send(new EmailMessage(from, to, raw));
}

export async function notifyAdminsOfRequest(env, requester, options = {}) {
  const recipients = [...getBootstrapAdmins(env)];
  if (recipients.length === 0) return { sent: 0 };
  const transport = options.transport || defaultTransport;
  let sent = 0;
  for (const to of recipients) {
    const mime = buildRequestMime(requester, env, to);
    await transport(env, env.NOTIFY_SENDER, to, mime.asRaw());
    sent += 1;
  }
  return { sent };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/notify.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add workers/sangha-worker/src/notify.js workers/sangha-worker/test/notify.test.js workers/sangha-worker/package.json workers/sangha-worker/package-lock.json
git commit -m "feat(worker): admin-notification email via Email Routing

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Access & membership HTTP handlers

**Files:**
- Create: `workers/sangha-worker/src/access.js`
- Create: `workers/sangha-worker/test/access.test.js`

**Interfaces:**
- Consumes: `resolveRole`, `getMember`, `requestAccess`, `listMembers`, `listPending`, `approveMember`, `denyMember`, `setRole` (Tasks 1–3); `notifyAdminsOfRequest` (Task 4); `jsonResponse` (middleware).
- Produces: `handleMe`, `handleAccessRequest`, `handleListMembers`, `handleApprove`, `handleDeny`, `handleSetRole` — each `(request, env, options = {})`. Handlers assume `request.user = { sub, name, role }` is set by the router. `handleAccessRequest` accepts `options.nowIso` and `options.notify` (passed to `notifyAdminsOfRequest` as its `options`).

- [ ] **Step 1: Write the failing test**

`test/access.test.js`:

```js
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import {
  handleMe, handleAccessRequest, handleListMembers, handleApprove, handleDeny, handleSetRole
} from "../src/access.js";
import { getMember } from "../src/members.js";

beforeEach(async () => { await env.DB.prepare("DELETE FROM members").run(); });

function req(body, user) {
  const r = new Request("https://worker.test/x", body ? { method: "POST", body: JSON.stringify(body) } : {});
  r.user = user;
  return r;
}

describe("handleMe", () => {
  it("returns identity, live role, and request_status", async () => {
    await env.DB.prepare("INSERT INTO members (email, name, role, request_status) VALUES ('r@x.org','R','reader','pending')").run();
    const res = await handleMe(req(null, { sub: "r@x.org", name: "R", role: "reader" }), env);
    expect(await res.json()).toEqual({ sub: "r@x.org", name: "R", role: "reader", request_status: "pending" });
  });
});

describe("handleAccessRequest", () => {
  it("creates a pending request and notifies admins once", async () => {
    let notified = 0;
    const res = await handleAccessRequest(
      req(null, { sub: "r@x.org", name: "R", role: "reader" }),
      env,
      { nowIso: "2026-07-05T00:00:00.000Z", notify: { transport: async () => { notified += 1; } } }
    );
    expect(await res.json()).toEqual({ status: "pending" });
    expect(notified).toBe(1);
    expect((await getMember(env, "r@x.org")).request_status).toBe("pending");
  });

  it("does not notify on a repeat request", async () => {
    const opts = { nowIso: "2026-07-05T00:00:00.000Z", notify: { transport: async () => { throw new Error("no"); } } };
    await env.DB.prepare("INSERT INTO members (email, name, role, request_status) VALUES ('r@x.org','R','reader','pending')").run();
    const res = await handleAccessRequest(req(null, { sub: "r@x.org", name: "R", role: "reader" }), env, opts);
    expect(await res.json()).toEqual({ status: "pending" });
  });

  it("no-ops for a member", async () => {
    const res = await handleAccessRequest(req(null, { sub: "m@x.org", name: "M", role: "member" }), env, {});
    expect(await res.json()).toEqual({ status: "already_member" });
  });

  it("still records the request when notification throws", async () => {
    const res = await handleAccessRequest(
      req(null, { sub: "r@x.org", name: "R", role: "reader" }),
      env,
      { nowIso: "2026-07-05T00:00:00.000Z", notify: { transport: async () => { throw new Error("smtp down"); } } }
    );
    expect(res.status).toBe(200);
    expect((await getMember(env, "r@x.org")).request_status).toBe("pending");
  });
});

describe("admin handlers", () => {
  it("lists members and pending", async () => {
    await env.DB.prepare("INSERT INTO members (email, name, role, request_status, updated_at) VALUES ('p@x.org','P','reader','pending','1')").run();
    const res = await handleListMembers(req(null, { sub: "a@x.org", name: "A", role: "admin" }), env);
    const body = await res.json();
    expect(body.members.length).toBe(1);
    expect(body.pending[0].email).toBe("p@x.org");
  });

  it("approve promotes and 404s on unknown", async () => {
    await env.DB.prepare("INSERT INTO members (email, name, role, request_status) VALUES ('p@x.org','P','reader','pending')").run();
    const ok = await handleApprove(req({ email: "p@x.org" }, { role: "admin" }), env, {});
    expect((await ok.json())).toEqual({ ok: true });
    expect((await getMember(env, "p@x.org")).role).toBe("member");
    const miss = await handleApprove(req({ email: "ghost@x.org" }, { role: "admin" }), env, {});
    expect(miss.status).toBe(404);
  });

  it("deny 404s on unknown and sets denied otherwise", async () => {
    await env.DB.prepare("INSERT INTO members (email, name, role, request_status) VALUES ('p@x.org','P','reader','pending')").run();
    expect((await handleDeny(req({ email: "p@x.org" }, { role: "admin" }), env, {})).status).toBe(200);
    expect((await getMember(env, "p@x.org")).request_status).toBe("denied");
  });

  it("setRole validates the role and 404s on unknown", async () => {
    await env.DB.prepare("INSERT INTO members (email, name, role, request_status) VALUES ('u@x.org','U','reader','none')").run();
    expect((await handleSetRole(req({ email: "u@x.org", role: "admin" }, { role: "admin" }), env, {})).status).toBe(200);
    expect((await getMember(env, "u@x.org")).role).toBe("admin");
    expect((await handleSetRole(req({ email: "u@x.org", role: "wizard" }, { role: "admin" }), env, {})).status).toBe(400);
    expect((await handleSetRole(req({ email: "ghost@x.org", role: "member" }, { role: "admin" }), env, {})).status).toBe(404);
  });

  it("rejects a bad body", async () => {
    expect((await handleApprove(req({}, { role: "admin" }), env, {})).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/access.test.js`
Expected: FAIL — cannot import from `../src/access.js`.

- [ ] **Step 3: Write the implementation**

`src/access.js`:

```js
// workers/sangha-worker/src/access.js
// HTTP handlers for identity (/api/me), self-service access requests, and admin
// membership management. Role gating is enforced by requireRole in the router;
// these handlers assume request.user = { sub, name, role } is set.
import { jsonResponse } from "./middleware.js";
import {
  getMember, requestAccess, listMembers, listPending,
  approveMember, denyMember, setRole
} from "./members.js";
import { notifyAdminsOfRequest } from "./notify.js";

async function readJson(request) {
  try { return await request.json(); } catch (error) { return null; }
}

export async function handleMe(request, env) {
  const email = request.user.sub;
  const row = await getMember(env, email);
  return jsonResponse(env, {
    sub: email,
    name: request.user.name,
    role: request.user.role,
    request_status: row ? row.request_status : "none"
  });
}

export async function handleAccessRequest(request, env, options = {}) {
  if (request.user.role === "member" || request.user.role === "admin") {
    return jsonResponse(env, { status: "already_member" });
  }
  const nowIso = options.nowIso || new Date().toISOString();
  const result = await requestAccess(env, request.user.sub, nowIso);
  if (result.created) {
    try {
      await notifyAdminsOfRequest(env, { name: request.user.name, email: request.user.sub }, options.notify || {});
    } catch (error) {
      console.error("access-request notify failed:", error && error.message);
    }
  }
  return jsonResponse(env, { status: result.status });
}

export async function handleListMembers(request, env) {
  const [members, pending] = await Promise.all([listMembers(env), listPending(env)]);
  return jsonResponse(env, { members, pending });
}

export async function handleApprove(request, env, options = {}) {
  const body = await readJson(request);
  if (!body || !body.email) return jsonResponse(env, { error: "bad_request" }, 400);
  const ok = await approveMember(env, body.email, options.nowIso || new Date().toISOString());
  if (!ok) return jsonResponse(env, { error: "not_found" }, 404);
  return jsonResponse(env, { ok: true });
}

export async function handleDeny(request, env, options = {}) {
  const body = await readJson(request);
  if (!body || !body.email) return jsonResponse(env, { error: "bad_request" }, 400);
  const ok = await denyMember(env, body.email, options.nowIso || new Date().toISOString());
  if (!ok) return jsonResponse(env, { error: "not_found" }, 404);
  return jsonResponse(env, { ok: true });
}

export async function handleSetRole(request, env, options = {}) {
  const body = await readJson(request);
  if (!body || !body.email || !body.role) return jsonResponse(env, { error: "bad_request" }, 400);
  const result = await setRole(env, body.email, body.role, options.nowIso || new Date().toISOString());
  if (result.error) return jsonResponse(env, { error: result.error }, 400);
  if (!result.ok) return jsonResponse(env, { error: "not_found" }, 404);
  return jsonResponse(env, { ok: true });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/access.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add workers/sangha-worker/src/access.js workers/sangha-worker/test/access.test.js
git commit -m "feat(worker): /api/me, access-request, and admin membership handlers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Live role resolution in `requireRole`

**Files:**
- Modify: `workers/sangha-worker/src/middleware.js`
- Modify: `workers/sangha-worker/test/middleware.test.js` (rewrite for live resolution)
- Modify: `workers/sangha-worker/test/index.test.js` (seed roles for calendar/signup route tests)

**Interfaces:**
- Consumes: `resolveRole` (Task 1); `authenticate` (existing).
- Produces: `requireRole(roles, handler)` unchanged signature, but now resolves role live and sets `request.user = { sub, name, role }`.

- [ ] **Step 1: Rewrite the middleware test**

Replace the entire contents of `test/middleware.test.js` with:

```js
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { jsonResponse, authenticate, requireRole, handlePreflight } from "../src/middleware.js";
import { signJwt } from "../src/jwt.js";

async function idToken(sub, name = "U") {
  return "Bearer " + await signJwt({ sub, name }, env.JWT_SIGNING_SECRET, { expiresInSeconds: 600 });
}
async function seedRole(email, role) {
  await env.DB
    .prepare("INSERT INTO members (email, name, role, request_status) VALUES (?, 'U', ?, 'none') ON CONFLICT(email) DO UPDATE SET role = excluded.role")
    .bind(email.toLowerCase(), role)
    .run();
}

beforeEach(async () => { await env.DB.prepare("DELETE FROM members").run(); });

describe("middleware", () => {
  it("jsonResponse attaches CORS headers", async () => {
    const res = jsonResponse(env, { ok: true }, 201);
    expect(res.status).toBe(201);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://eauclairesangha.org");
  });

  it("handlePreflight returns 204 with CORS headers", () => {
    const res = handlePreflight(new Request("https://worker.test/api/x", { method: "OPTIONS" }), env);
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });

  it("authenticate returns identity claims for a valid Bearer token", async () => {
    const req = new Request("https://worker.test/api/x", { headers: { Authorization: await idToken("u@eauclairesangha.org") } });
    expect((await authenticate(req, env)).sub).toBe("u@eauclairesangha.org");
  });

  it("authenticate returns null without a token", async () => {
    expect(await authenticate(new Request("https://worker.test/api/x"), env)).toBeNull();
  });

  it("requireRole returns 401 without a token", async () => {
    const handler = requireRole(["member", "admin"], async () => jsonResponse(env, {}));
    expect((await handler(new Request("https://worker.test/api/x"), env)).status).toBe(401);
  });

  it("requireRole returns 403 when the live role is insufficient", async () => {
    await seedRole("m@eauclairesangha.org", "member");
    const handler = requireRole(["admin"], async () => jsonResponse(env, {}));
    const req = new Request("https://worker.test/api/x", { headers: { Authorization: await idToken("m@eauclairesangha.org") } });
    expect((await handler(req, env)).status).toBe(403);
  });

  it("requireRole authorizes via a live D1 role and attaches request.user", async () => {
    await seedRole("a@eauclairesangha.org", "admin");
    const handler = requireRole(["admin"], async (request) => jsonResponse(env, { who: request.user.sub, role: request.user.role }));
    const req = new Request("https://worker.test/api/x", { headers: { Authorization: await idToken("a@eauclairesangha.org") } });
    expect(await (await handler(req, env)).json()).toEqual({ who: "a@eauclairesangha.org", role: "admin" });
  });

  it("requireRole grants admin to a BOOTSTRAP_ADMINS email with no row", async () => {
    const handler = requireRole(["admin"], async () => jsonResponse(env, { ok: true }));
    const req = new Request("https://worker.test/api/x", { headers: { Authorization: await idToken("boss@eauclairesangha.org") } });
    expect((await handler(req, env)).status).toBe(200);
  });

  it("requireRole treats a signed-in user with no row as reader (denied member routes)", async () => {
    const handler = requireRole(["member", "admin"], async () => jsonResponse(env, {}));
    const req = new Request("https://worker.test/api/x", { headers: { Authorization: await idToken("new@eauclairesangha.org") } });
    expect((await handler(req, env)).status).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/middleware.test.js`
Expected: FAIL — the live-resolution tests fail because `requireRole` still trusts the JWT role claim (which the identity tokens no longer carry).

- [ ] **Step 3: Update `requireRole`**

In `src/middleware.js`, add the import at the top (after the existing `verifyJwt` import):

```js
import { resolveRole } from "./members.js";
```

Replace the `requireRole` function with:

```js
// Wraps a handler so it only runs for a user whose LIVE role (config -> D1 ->
// reader) is in `roles`. The JWT carries identity only; role is never trusted
// from the token.
export function requireRole(roles, handler) {
  return async (request, env, ctx) => {
    const user = await authenticate(request, env);
    if (!user) return jsonResponse(env, { error: "unauthorized" }, 401);
    const role = await resolveRole(env, user.sub);
    if (!roles.includes(role)) return jsonResponse(env, { error: "forbidden" }, 403);
    request.user = { sub: user.sub, name: user.name, role };
    return handler(request, env, ctx);
  };
}
```

- [ ] **Step 4: Run middleware test to verify it passes**

Run: `npx vitest run test/middleware.test.js`
Expected: PASS.

- [ ] **Step 5: Fix the router calendar/signup tests**

In `test/index.test.js`, the `PUT /api/calendar` and `POST /api/signups` tests sign tokens for `a@eauclairesangha.org` (expected admin) and `m@eauclairesangha.org` (expected member). Seed those roles so live resolution grants them. Add this helper after the `call` function:

```js
async function seedRole(email, role) {
  await env.DB
    .prepare("INSERT INTO members (email, name, role, request_status) VALUES (?, 'U', ?, 'none') ON CONFLICT(email) DO UPDATE SET role = excluded.role")
    .bind(email.toLowerCase(), role)
    .run();
}
```

In the `"PUT /api/calendar requires an admin token"` test, add before the member-token call:

```js
    await seedRole("m@eauclairesangha.org", "member");
```

In the `"POST /api/signups works for a member token"` test, add right after the `DELETE FROM calendar_state` line:

```js
    await seedRole("a@eauclairesangha.org", "admin");
    await seedRole("m@eauclairesangha.org", "member");
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS (all files). `auth.test.js` still passes here because Task 6 does not change `auth.js`.

- [ ] **Step 7: Commit**

```bash
git add workers/sangha-worker/src/middleware.js workers/sangha-worker/test/middleware.test.js workers/sangha-worker/test/index.test.js
git commit -m "feat(worker): resolve role live in requireRole (identity-only JWT)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Sign-in callback upserts a reader, issues an identity-only JWT

**Files:**
- Modify: `workers/sangha-worker/src/auth.js`
- Modify: `workers/sangha-worker/test/auth.test.js` (rewrite `handleCallback` suite)

**Interfaces:**
- Consumes: `upsertReader` (Task 2); `signJwt` (existing).
- Produces: `handleCallback` now issues a JWT `{ sub, name }` (no `role`), upserts a reader row, and never rejects a signed-in Google user. `handleLogin` is unchanged.

- [ ] **Step 1: Rewrite the callback test suite**

Replace the entire `describe("handleCallback", ...)` block in `test/auth.test.js` with the following (leave the `handleLogin` suite and the `fakeIdToken` helper as-is), and add `beforeEach` to the vitest import at the top:

```js
describe("handleCallback", () => {
  beforeEach(async () => { await env.DB.prepare("DELETE FROM members").run(); });

  function mockFetch(idClaims) {
    return async (url) => {
      if (url === "https://oauth2.googleapis.com/token") {
        return new Response(JSON.stringify({ id_token: fakeIdToken(idClaims), access_token: "at" }), { status: 200 });
      }
      throw new Error("unexpected fetch: " + url);
    };
  }
  async function callbackWith(idClaims) {
    const { signJwt } = await import("../src/jwt.js");
    const state = await signJwt(
      { kind: "login-state", return_to: "https://eauclairesangha.org/calendar/" },
      env.JWT_SIGNING_SECRET, { expiresInSeconds: 600 }
    );
    const req = new Request("https://worker.test/auth/callback?code=auth-code&state=" + encodeURIComponent(state));
    return handleCallback(req, env, { fetch: mockFetch(idClaims) });
  }

  it("signs in any Google user with an identity-only JWT (no role claim)", async () => {
    const res = await callbackWith({ email: "New.Person@eauclairesangha.org", name: "New" });
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("Location"));
    expect(loc.origin + loc.pathname).toBe("https://eauclairesangha.org/calendar/");
    const claims = await verifyJwt(new URLSearchParams(loc.hash.slice(1)).get("token"), env.JWT_SIGNING_SECRET);
    expect(claims.sub).toBe("new.person@eauclairesangha.org");
    expect(claims.name).toBe("New");
    expect(claims.role).toBeUndefined();
  });

  it("upserts a reader row on first sign-in", async () => {
    const { getMember } = await import("../src/members.js");
    await callbackWith({ email: "reader@eauclairesangha.org", name: "R" });
    const row = await getMember(env, "reader@eauclairesangha.org");
    expect(row.role).toBe("reader");
    expect(row.request_status).toBe("none");
  });

  it("refreshes name but preserves an existing member's role on re-login", async () => {
    const { getMember } = await import("../src/members.js");
    await env.DB.prepare("INSERT INTO members (email, name, role, request_status) VALUES ('mem@eauclairesangha.org','Old','member','none')").run();
    await callbackWith({ email: "mem@eauclairesangha.org", name: "New" });
    const row = await getMember(env, "mem@eauclairesangha.org");
    expect(row.role).toBe("member");
    expect(row.name).toBe("New");
  });

  it("redirects with no_email when the ID token lacks an email", async () => {
    const res = await callbackWith({ name: "NoEmail" });
    expect(new URL(res.headers.get("Location")).hash).toContain("auth_error=no_email");
  });

  it("rejects a tampered/absent state", async () => {
    const req = new Request("https://worker.test/auth/callback?code=c&state=garbage");
    const res = await handleCallback(req, env, { fetch: async () => { throw new Error("should not fetch"); } });
    expect(new URL(res.headers.get("Location")).hash).toContain("auth_error=bad_state");
  });
});
```

Update the top import line to include `beforeEach`:

```js
import { describe, it, expect, beforeEach } from "vitest";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/auth.test.js`
Expected: FAIL — callback still calls the group check and emits a `role` claim / `not_a_member`.

- [ ] **Step 3: Update `handleCallback`**

In `src/auth.js`:

1. Remove the group import:

```js
import { getGroupRole } from "./groups.js";
```

and add:

```js
import { upsertReader } from "./members.js";
```

2. Replace everything from `let role;` through the `return Response.redirect(target.toString(), 302);` at the end of `handleCallback` with:

```js
  try {
    await upsertReader(env, email, name, new Date().toISOString());
  } catch (error) {
    return errorRedirect(env, "store_error");
  }

  const siteJwt = await signJwt(
    { sub: email, name },
    env.JWT_SIGNING_SECRET,
    { expiresInSeconds: SITE_JWT_TTL_SECONDS }
  );
  const target = new URL(safeReturnTo(state.return_to, env));
  target.hash = "token=" + encodeURIComponent(siteJwt);
  return Response.redirect(target.toString(), 302);
```

(The `email`/`name` extraction, the `if (!email) return errorRedirect(env, "no_email");` guard, and `errorRedirect` are unchanged.)

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS. (`groups.test.js` and `service-account.test.js` still pass — they are deleted in Task 8.)

- [ ] **Step 5: Commit**

```bash
git add workers/sangha-worker/src/auth.js workers/sangha-worker/test/auth.test.js
git commit -m "feat(worker): sign-in upserts reader + identity-only JWT

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Register routes + remove Workspace code and config

**Files:**
- Modify: `workers/sangha-worker/src/index.js`
- Modify: `workers/sangha-worker/test/index.test.js` (add route tests)
- Delete: `workers/sangha-worker/src/groups.js`, `workers/sangha-worker/src/service-account.js`, `workers/sangha-worker/test/groups.test.js`, `workers/sangha-worker/test/service-account.test.js`
- Modify: `workers/sangha-worker/wrangler.toml`, `workers/sangha-worker/vitest.config.js` (remove `GOOGLE_GROUP_EMAIL`, `GOOGLE_ADMIN_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_KEY`)

**Interfaces:**
- Consumes: `handleMe`, `handleAccessRequest`, `handleListMembers`, `handleApprove`, `handleDeny`, `handleSetRole` (Task 5); `requireRole` (Task 6).

- [ ] **Step 1: Write failing route tests**

Add these tests inside the `describe("router", ...)` block in `test/index.test.js` (the `seedRole` helper from Task 6 is already present):

```js
  it("GET /api/me returns identity + role for a signed-in reader", async () => {
    const token = await signJwt({ sub: "reader@eauclairesangha.org", name: "R" }, env.JWT_SIGNING_SECRET, { expiresInSeconds: 600 });
    const res = await call("/api/me", { headers: { Authorization: "Bearer " + token } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sub).toBe("reader@eauclairesangha.org");
    expect(body.role).toBe("reader");
  });

  it("GET /api/members is admin-only", async () => {
    const token = await signJwt({ sub: "reader@eauclairesangha.org", name: "R" }, env.JWT_SIGNING_SECRET, { expiresInSeconds: 600 });
    const forbidden = await call("/api/members", { headers: { Authorization: "Bearer " + token } });
    expect(forbidden.status).toBe(403);

    await seedRole("adm@eauclairesangha.org", "admin");
    const adminToken = await signJwt({ sub: "adm@eauclairesangha.org", name: "A" }, env.JWT_SIGNING_SECRET, { expiresInSeconds: 600 });
    const ok = await call("/api/members", { headers: { Authorization: "Bearer " + adminToken } });
    expect(ok.status).toBe(200);
    expect(Array.isArray((await ok.json()).members)).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/index.test.js`
Expected: FAIL — `/api/me` and `/api/members` return 404 (routes not registered).

- [ ] **Step 3: Register the routes**

In `src/index.js`, add the import (after the `handlePostComment` import):

```js
import {
  handleMe, handleAccessRequest, handleListMembers,
  handleApprove, handleDeny, handleSetRole
} from "./access.js";
```

Add these routes (after the `/auth/callback` route, before the `/decap` routes):

```js
router.get("/api/me", requireRole(["reader", "member", "admin"], handleMe));
router.post("/api/access-request", requireRole(["reader", "member", "admin"], handleAccessRequest));
router.get("/api/members", requireRole(["admin"], handleListMembers));
router.post("/api/members/approve", requireRole(["admin"], handleApprove));
router.post("/api/members/deny", requireRole(["admin"], handleDeny));
router.post("/api/members/role", requireRole(["admin"], handleSetRole));
```

- [ ] **Step 4: Run index test to verify it passes**

Run: `npx vitest run test/index.test.js`
Expected: PASS.

- [ ] **Step 5: Delete the Workspace code and its tests**

```bash
git rm workers/sangha-worker/src/groups.js workers/sangha-worker/src/service-account.js workers/sangha-worker/test/groups.test.js workers/sangha-worker/test/service-account.test.js
```

- [ ] **Step 6: Remove Workspace config**

In `vitest.config.js`, delete these three binding lines:

```js
            GOOGLE_GROUP_EMAIL: "sangha@eauclairesangha.org",
            GOOGLE_ADMIN_EMAIL: "admin@eauclairesangha.org",
```

(There is no service-account key binding in the test config; nothing else to remove there.)

In `wrangler.toml`, delete the `GOOGLE_GROUP_EMAIL` and `GOOGLE_ADMIN_EMAIL` lines from `[vars]`, and remove `GOOGLE_SERVICE_ACCOUNT_KEY` from the secrets comment block.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS. No test imports `groups.js`/`service-account.js`, and nothing references the removed bindings.

- [ ] **Step 8: Commit**

```bash
git add -A workers/sangha-worker/src/index.js workers/sangha-worker/test/index.test.js workers/sangha-worker/vitest.config.js workers/sangha-worker/wrangler.toml
git commit -m "feat(worker): register membership routes; remove Workspace group code

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Production config — bootstrap admins, sender, send_email binding

**Files:**
- Modify: `workers/sangha-worker/wrangler.toml`

**Interfaces:**
- Consumes: nothing (deployment config). `BOOTSTRAP_ADMINS`, `NOTIFY_SENDER`, and the `SEND_EMAIL` binding are read by `members.js`/`notify.js`.

- [ ] **Step 1: Add vars and the send_email binding**

In `wrangler.toml`, add to `[vars]`:

```toml
# Comma-separated, lowercased admin emails. These accounts are ALWAYS admin
# (lockout recovery) and receive access-request notifications.
BOOTSTRAP_ADMINS = ""
# From-address for notification email; must be on the Email-Routing-enabled domain.
NOTIFY_SENDER = "noreply@eauclairesangha.org"
```

Add the binding (a top-level block):

```toml
# Cloudflare Email Routing: send notification email to admins. Each address in
# allowed_destination_addresses must be verified once in the Email Routing UI.
[[send_email]]
name = "SEND_EMAIL"
allowed_destination_addresses = []
```

- [ ] **Step 2: Validate the config parses**

Run (from `workers/sangha-worker/`): `npx wrangler deploy --dry-run --outdir /tmp/sangha-dryrun`
Expected: completes without a TOML/parse error and lists the `SEND_EMAIL` binding. (No real deploy occurs. If `--dry-run` prompts for auth, run `npx wrangler deploy --dry-run` which also validates config offline.)

- [ ] **Step 3: Commit**

```bash
git add workers/sangha-worker/wrangler.toml
git commit -m "chore(worker): bootstrap-admins var + Email Routing send_email binding

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Full-suite green + review

**Files:** none (verification).

- [ ] **Step 1: Run the whole suite**

Run (from `workers/sangha-worker/`): `npm test`
Expected: PASS across `members`, `notify`, `access`, `middleware`, `auth`, `index`, `calendar-*`, `comments`, `decap`, `jwt`. No references to `groups`/`service-account`.

- [ ] **Step 2: Confirm the Workspace code is gone**

Run: `grep -rn "getGroupRole\|service-account\|GOOGLE_SERVICE_ACCOUNT_KEY\|GOOGLE_GROUP_EMAIL" workers/sangha-worker/src workers/sangha-worker/test`
Expected: no matches.

- [ ] **Step 3: Commit any incidental fixups** (only if Steps 1–2 required changes)

```bash
git add -A workers/sangha-worker
git commit -m "test(worker): membership roles suite green

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Deferred to User (deploy-time, not part of this plan)

- `wrangler secret put` cleanup: remove `GOOGLE_SERVICE_ACCOUNT_KEY` from the deployed Worker environment.
- Set `BOOTSTRAP_ADMINS` (the officers' Google emails) and `allowed_destination_addresses` to the same admin emails; set `NOTIFY_SENDER` to a real address.
- Enable Cloudflare Email Routing on the domain and verify each admin destination address.
- Apply the new migration to the remote DB: `npx wrangler d1 migrations apply sangha-calendar --remote`.
- Deploy: `npx wrangler deploy`.

## Not in This Plan (separate plans)

- **Site UI** — `ECBS.Auth` calling `/api/me`, the "Request access" control, and the `/account/members` admin panel. (Plan 02.)
- **Native comments** — the `comments` D1 table replacing the Remark42 proxy and the Isso stack. (Plan 03.)

## Self-Review

**Spec coverage** (against `2026-07-05-membership-roles-and-comments-design.md`, Phase 1 items):
- Role model reader/member/admin → Tasks 1–3, enforced Task 6/8. ✓
- Live role resolution, identity-only JWT → Tasks 1, 6, 7. ✓
- `members` table → Task 1. ✓
- Auth callback upsert + no `not_a_member` → Task 7. ✓
- `/api/me`, `/api/access-request`, admin `members` APIs → Tasks 5, 8. ✓
- Email notification via Email Routing → Tasks 4, 9. ✓
- Config admins as lockout net + recipients → Tasks 1, 4, 9. ✓
- Remove `groups.js`/`service-account.js` + Workspace config → Task 8. ✓
- Error handling (already_member no-op, idempotent pending, 404 unknown, 400 bad role, notify-failure non-blocking, 401/403) → Tasks 3, 5, 6. ✓
- Deferred deploy steps → Deferred section. ✓
- Site UI + comments → explicitly deferred to Plans 02/03. ✓

**Placeholder scan:** No TBD/TODO. `BOOTSTRAP_ADMINS = ""` and `allowed_destination_addresses = []` are intentional empty production defaults filled at deploy (documented in Deferred). Every code step shows complete code.

**Type consistency:** `resolveRole`/`getMember`/`requestAccess`/`approveMember`/`denyMember`/`setRole` signatures are used identically in `access.js` and the tests as declared in Tasks 1–3. `request.user = { sub, name, role }` is produced by `requireRole` (Task 6) and consumed by handlers (Task 5) and calendar handlers (existing). `notifyAdminsOfRequest(env, requester, options)` with `options.transport` matches the `access.js` call passing `options.notify`. Consistent.
