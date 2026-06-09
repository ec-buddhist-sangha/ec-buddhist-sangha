# Google SSO — Plan 03: Calendar D1 Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Depends on Plan 01** (`sangha-worker` scaffold, `middleware.js`, `index.js`). Member signup write-through on the client also depends on `ECBS.Auth` from **Plan 04** — but degrades gracefully (localStorage-only) if `ECBS.Auth` is absent, so this plan can ship before or after Plan 04.

**Goal:** Give the calendar real cross-device persistence behind the Worker: a D1-backed authoritative store with optimistic locking for admin edits, plus a narrow, server-authoritative signup API so members can RSVP/volunteer/attend without being able to tamper with anyone else's data or admin config. The browser keeps `localStorage` as a fast cache and offline fallback.

**Architecture (and a documented deviation from the spec's table list):** The spec's §"D1 Tables" lists eight fully-normalized tables. The existing client (`site/static/js/calendar.js`, ~4150 lines) is a complete, tested engine that operates on a single normalized **store document** (`{ revision, slots[], recurrences[], settings, history[] }`) through one read seam (`loadStore`) and one write seam (`saveStore`). Fully normalizing that into eight relational tables would require a large bidirectional translation layer and a rewrite of the client engine — high risk, low payoff for a small sangha. **This plan instead persists the store as a single JSON document** in one D1 table (`calendar_state`) with an integer `revision` for optimistic locking, and adds **first-class server-authoritative signup endpoints** that mutate that document under the caller's verified identity. This reuses the entire client engine, gives correct multi-user behavior, and keeps the eight-table normalization available as a future enhancement (the document already contains `notifications`, `reminders`, and `history` arrays). Endpoint shape is likewise consolidated: the spec's granular `POST/PATCH/DELETE /api/calendar/items|settings|recurrences` admin routes collapse into a single optimistic-locked `PUT /api/calendar` (admins already compute the whole next store client-side via the existing engine); members use the narrow `/api/signups` routes.

**Tech Stack:** Cloudflare D1 (SQLite), Cloudflare Workers, `vitest@^2` + `@cloudflare/vitest-pool-workers` (real D1 in tests via `applyD1Migrations`), and the existing browser test harness (`node --test` + jsdom) for client changes.

---

## File Structure

```
workers/sangha-worker/
├── migrations/
│   └── 0001_init_calendar_state.sql   # NEW: the single state table
├── src/
│   ├── calendar.js                    # NEW: readState/writeState/mutateState, signup helpers, handlers
│   └── index.js                       # MODIFY: register /api/calendar + /api/signups
├── test/
│   ├── apply-migrations.js            # NEW: applies D1 migrations before each test file
│   ├── calendar-signups.test.js       # NEW: pure mutation helpers
│   └── calendar-state.test.js         # NEW: D1 read/write + handlers
├── wrangler.toml                      # MODIFY: add [[d1_databases]] binding
└── vitest.config.js                   # MODIFY: read migrations + d1Databases binding

site/
├── static/js/calendar-api.js          # NEW: ECBS.CalendarApi (fetch/put store, signup, cancel)
├── static/js/calendar.js              # MODIFY: hydrate on boot + saveStore write-through + diffMemberSignups
├── layouts/_default/calendar.html     # MODIFY: add data-calendar-api + load calendar-api.js
├── layouts/_default/calendar-admin.html
├── layouts/_default/calendar-item.html
├── hugo.yaml                          # MODIFY: params.calendarApiBase
└── tests/calendar-api.test.js         # NEW
```

---

## Task 1: Create the D1 database, binding, and migration

**Files:**
- Create: `workers/sangha-worker/migrations/0001_init_calendar_state.sql`
- Create: `workers/sangha-worker/test/apply-migrations.js`
- Modify: `workers/sangha-worker/wrangler.toml`
- Modify: `workers/sangha-worker/vitest.config.js`

- [ ] **Step 1: Create the migration**

`workers/sangha-worker/migrations/0001_init_calendar_state.sql`:

```sql
-- Single authoritative calendar store document with optimistic locking.
CREATE TABLE IF NOT EXISTS calendar_state (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  store_json TEXT    NOT NULL,
  revision   INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT    NOT NULL
);
```

- [ ] **Step 2: Create the D1 database (infra)**

Run: `cd workers/sangha-worker && npx wrangler d1 create sangha-calendar`
Expected: prints a `database_id`. Copy it for the next step.

- [ ] **Step 3: Add the binding to `wrangler.toml`**

Append to `workers/sangha-worker/wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "sangha-calendar"
database_id = "PASTE_DATABASE_ID_FROM_STEP_2"
```

- [ ] **Step 4: Apply the migration**

Run (local + remote):
```bash
cd workers/sangha-worker
npx wrangler d1 migrations apply sangha-calendar --local
npx wrangler d1 migrations apply sangha-calendar --remote
```
Expected: `0001_init_calendar_state.sql` reported as applied.

- [ ] **Step 5: Wire migrations into vitest**

Create `workers/sangha-worker/test/apply-migrations.js`:

```js
import { applyD1Migrations, env } from "cloudflare:test";

// Runs once per test file before tests; idempotent (tracks applied migrations).
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
```

Replace `workers/sangha-worker/vitest.config.js` with:

```js
import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";

const migrations = await readD1Migrations("./migrations");

export default defineWorkersConfig({
  test: {
    setupFiles: ["./test/apply-migrations.js"],
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          d1Databases: ["DB"],
          bindings: {
            TEST_MIGRATIONS: migrations,
            JWT_SIGNING_SECRET: "test-signing-secret-please-change",
            GOOGLE_CLIENT_ID: "test-client-id",
            GOOGLE_CLIENT_SECRET: "test-client-secret",
            GOOGLE_REDIRECT_URI: "https://worker.test/auth/callback",
            GOOGLE_GROUP_EMAIL: "sangha@eauclairesangha.org",
            GOOGLE_ADMIN_EMAIL: "admin@eauclairesangha.org",
            CORS_ORIGIN: "https://eauclairesangha.org",
            GITHUB_CLIENT_ID: "gh-client-id",
            GITHUB_CLIENT_SECRET: "gh-client-secret"
          }
        }
      }
    }
  }
});
```

- [ ] **Step 6: Verify the test harness boots with D1**

Run: `cd workers/sangha-worker && npm test`
Expected: existing suites still PASS (the new setup file applies migrations without error). No calendar tests yet.

- [ ] **Step 7: Commit**

```bash
git add workers/sangha-worker/migrations workers/sangha-worker/test/apply-migrations.js workers/sangha-worker/wrangler.toml workers/sangha-worker/vitest.config.js
git commit -m "chore(worker): add D1 calendar_state table + test migrations"
```

---

## Task 2: Signup mutation helpers (pure)

**Files:**
- Create: `workers/sangha-worker/src/calendar.js` (helpers section)
- Test: `workers/sangha-worker/test/calendar-signups.test.js`

These pure functions are the server's authority boundary: they only ever touch the caller's own entry (matched by email), so a member cannot sign up as someone else.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from "vitest";
import { makeServerVolunteer, addSignup, removeSignup, findSignup } from "../src/calendar.js";

function storeWith(slot) {
  return { revision: 1, slots: [slot], recurrences: [], settings: {}, history: [] };
}

describe("signup helpers", () => {
  it("makeServerVolunteer trusts only the caller identity + safe fields", () => {
    const v = makeServerVolunteer("Mara R", "Mara@Example.com", { link: "x", notes: "n", reminders: ["one-day", 5] }, "2026-06-01T00:00:00Z");
    expect(v).toEqual({ name: "Mara R", email: "mara@example.com", link: "x", notes: "n", reminders: ["one-day"], signedUpAt: "2026-06-01T00:00:00Z" });
  });

  it("addSignup as attendee appends the caller", () => {
    const store = storeWith({ id: "s1", itemType: "meeting", attendees: [], backups: [], speaker: null });
    const person = makeServerVolunteer("A", "a@x.com", {}, "t");
    addSignup(store, "s1", "attendee", person);
    expect(store.slots[0].attendees.map((p) => p.email)).toEqual(["a@x.com"]);
  });

  it("addSignup as speaker claims an open slot and removes prior duplicate attendance", () => {
    const store = storeWith({ id: "s1", attendees: [{ name: "A", email: "a@x.com" }], backups: [], speaker: null });
    addSignup(store, "s1", "speaker", makeServerVolunteer("A", "a@x.com", {}, "t"));
    expect(store.slots[0].speaker.email).toBe("a@x.com");
    expect(store.slots[0].attendees).toEqual([]);
  });

  it("addSignup as speaker rejects when another person holds the slot", () => {
    const store = storeWith({ id: "s1", attendees: [], backups: [], speaker: { name: "B", email: "b@x.com" } });
    expect(() => addSignup(store, "s1", "speaker", makeServerVolunteer("A", "a@x.com", {}, "t")))
      .toThrowError(expect.objectContaining({ status: 409, error: "speaker_taken" }));
  });

  it("addSignup throws 404 for an unknown item", () => {
    const store = storeWith({ id: "s1", attendees: [], backups: [], speaker: null });
    expect(() => addSignup(store, "missing", "attendee", makeServerVolunteer("A", "a@x.com", {}, "t")))
      .toThrowError(expect.objectContaining({ status: 404 }));
  });

  it("removeSignup removes the caller from every role", () => {
    const store = storeWith({ id: "s1", attendees: [], backups: [{ name: "A", email: "a@x.com" }], speaker: null });
    removeSignup(store, "s1", "a@x.com");
    expect(store.slots[0].backups).toEqual([]);
  });

  it("findSignup reports the caller's current role", () => {
    const store = storeWith({ id: "s1", attendees: [{ name: "A", email: "a@x.com" }], backups: [], speaker: null });
    expect(findSignup(store, "s1", "a@x.com")).toEqual({ role: "attendee", entry: { name: "A", email: "a@x.com" } });
    expect(findSignup(store, "s1", "nobody@x.com")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd workers/sangha-worker && npx vitest run test/calendar-signups.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/calendar.js` with the helpers**

```js
// workers/sangha-worker/src/calendar.js
// D1-backed calendar store (single JSON document, optimistic locking) plus
// server-authoritative member signup mutations. The helpers below are pure and
// only ever touch the caller's own entry (matched by email).
import { jsonResponse } from "./middleware.js";

export function makeServerVolunteer(name, email, body, nowIso) {
  const lcEmail = String(email || "").toLowerCase();
  return {
    name: name || lcEmail,
    email: lcEmail,
    link: typeof body.link === "string" ? body.link : "",
    notes: typeof body.notes === "string" ? body.notes : "",
    reminders: Array.isArray(body.reminders) ? body.reminders.filter((r) => typeof r === "string") : [],
    signedUpAt: nowIso
  };
}

function removeEmailFromSlot(slot, email) {
  const lc = String(email || "").toLowerCase();
  if (slot.speaker && String(slot.speaker.email || "").toLowerCase() === lc) slot.speaker = null;
  slot.backups = (slot.backups || []).filter((b) => String(b.email || "").toLowerCase() !== lc);
  slot.attendees = (slot.attendees || []).filter((a) => String(a.email || "").toLowerCase() !== lc);
}

function findSlot(store, itemId) {
  const slot = (store.slots || []).find((s) => s.id === itemId);
  if (!slot) throw { status: 404, error: "item_not_found" };
  return slot;
}

export function addSignup(store, itemId, role, person) {
  const slot = findSlot(store, itemId);
  removeEmailFromSlot(slot, person.email); // de-dupe the caller across all roles first
  if (role === "speaker") {
    if (slot.speaker && String(slot.speaker.email || "").toLowerCase() !== person.email) {
      throw { status: 409, error: "speaker_taken" };
    }
    slot.speaker = person;
  } else if (role === "backup") {
    slot.backups = slot.backups || [];
    slot.backups.push(person);
  } else if (role === "attendee") {
    slot.attendees = slot.attendees || [];
    slot.attendees.push(person);
  } else {
    throw { status: 400, error: "bad_role" };
  }
  return slot;
}

export function removeSignup(store, itemId, email) {
  const slot = findSlot(store, itemId);
  removeEmailFromSlot(slot, email);
  return slot;
}

export function findSignup(store, itemId, email) {
  const slot = (store.slots || []).find((s) => s.id === itemId);
  if (!slot) return null;
  const lc = String(email || "").toLowerCase();
  if (slot.speaker && String(slot.speaker.email || "").toLowerCase() === lc) return { role: "speaker", entry: slot.speaker };
  const backup = (slot.backups || []).find((b) => String(b.email || "").toLowerCase() === lc);
  if (backup) return { role: "backup", entry: backup };
  const attendee = (slot.attendees || []).find((a) => String(a.email || "").toLowerCase() === lc);
  if (attendee) return { role: "attendee", entry: attendee };
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd workers/sangha-worker && npx vitest run test/calendar-signups.test.js`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add workers/sangha-worker/src/calendar.js workers/sangha-worker/test/calendar-signups.test.js
git commit -m "feat(worker): server-authoritative calendar signup helpers"
```

---

## Task 3: D1 state read/write/mutate + endpoint handlers

**Files:**
- Modify: `workers/sangha-worker/src/calendar.js` (append state + handlers)
- Test: `workers/sangha-worker/test/calendar-state.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { readState, writeState, handleGetCalendar, handlePutCalendar, handlePostSignup, handleDeleteSignup, handleGetSignup } from "../src/calendar.js";

const NOW = "2026-06-01T00:00:00.000Z";

function seedStore() {
  return {
    revision: 0,
    settings: { defaultLocation: "Unity" },
    recurrences: [],
    slots: [{ id: "s1", itemType: "talk", date: "2026-06-09", title: "Talk", speaker: null, backups: [], attendees: [] }],
    history: []
  };
}

async function reset() {
  await env.DB.prepare("DELETE FROM calendar_state").run();
}

beforeEach(reset);

describe("calendar state (D1)", () => {
  it("readState returns a null store before any write", async () => {
    expect(await readState(env)).toEqual({ store: null, revision: 0 });
  });

  it("writeState inserts the first revision then bumps on update", async () => {
    const first = await writeState(env, seedStore(), 0, NOW);
    expect(first.revision).toBe(1);
    const read1 = await readState(env);
    expect(read1.revision).toBe(1);
    expect(read1.store.slots[0].id).toBe("s1");

    const second = await writeState(env, seedStore(), 1, NOW);
    expect(second.revision).toBe(2);
  });

  it("writeState reports a conflict on a stale revision", async () => {
    await writeState(env, seedStore(), 0, NOW); // -> revision 1
    const conflict = await writeState(env, seedStore(), 0, NOW); // stale
    expect(conflict.conflict).toBe(true);
    expect(conflict.current.revision).toBe(1);
  });

  it("GET /api/calendar returns store + revision", async () => {
    await writeState(env, seedStore(), 0, NOW);
    const res = await handleGetCalendar(new Request("https://worker.test/api/calendar"), env);
    const body = await res.json();
    expect(body.revision).toBe(1);
    expect(body.store.slots[0].title).toBe("Talk");
  });

  it("PUT /api/calendar seeds, then 409s on a stale revision", async () => {
    const reqOk = new Request("https://worker.test/api/calendar", { method: "PUT", body: JSON.stringify({ store: seedStore(), revision: 0 }) });
    const ok = await handlePutCalendar(reqOk, env);
    expect((await ok.json()).revision).toBe(1);

    const reqStale = new Request("https://worker.test/api/calendar", { method: "PUT", body: JSON.stringify({ store: seedStore(), revision: 0 }) });
    const stale = await handlePutCalendar(reqStale, env);
    expect(stale.status).toBe(409);
    expect((await stale.json()).revision).toBe(1);
  });

  it("POST /api/signups adds the caller as attendee", async () => {
    await writeState(env, seedStore(), 0, NOW);
    const req = new Request("https://worker.test/api/signups", { method: "POST", body: JSON.stringify({ itemId: "s1", role: "attendee" }) });
    req.user = { sub: "mem@eauclairesangha.org", name: "Mem", role: "member" };
    const res = await handlePostSignup(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.store.slots[0].attendees[0].email).toBe("mem@eauclairesangha.org");
  });

  it("GET then DELETE /api/signups round-trips the caller's signup", async () => {
    await writeState(env, seedStore(), 0, NOW);
    const post = new Request("https://worker.test/api/signups", { method: "POST", body: JSON.stringify({ itemId: "s1", role: "backup" }) });
    post.user = { sub: "mem@eauclairesangha.org", name: "Mem", role: "member" };
    await handlePostSignup(post, env);

    const get = new Request("https://worker.test/api/signups?itemId=s1");
    get.user = { sub: "mem@eauclairesangha.org", name: "Mem", role: "member" };
    expect((await (await handleGetSignup(get, env)).json()).signup.role).toBe("backup");

    const del = new Request("https://worker.test/api/signups", { method: "DELETE", body: JSON.stringify({ itemId: "s1" }) });
    del.user = { sub: "mem@eauclairesangha.org", name: "Mem", role: "member" };
    await handleDeleteSignup(del, env);

    const get2 = new Request("https://worker.test/api/signups?itemId=s1");
    get2.user = { sub: "mem@eauclairesangha.org", name: "Mem", role: "member" };
    expect((await (await handleGetSignup(get2, env)).json()).signup).toBeNull();
  });

  it("POST /api/signups 404s before the calendar is seeded", async () => {
    const req = new Request("https://worker.test/api/signups", { method: "POST", body: JSON.stringify({ itemId: "s1", role: "attendee" }) });
    req.user = { sub: "mem@eauclairesangha.org", name: "Mem", role: "member" };
    const res = await handlePostSignup(req, env);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd workers/sangha-worker && npx vitest run test/calendar-state.test.js`
Expected: FAIL — the state functions/handlers are not exported yet.

- [ ] **Step 3: Append state + handlers to `src/calendar.js`**

Add to the end of `workers/sangha-worker/src/calendar.js`:

```js
export async function readState(env) {
  const row = await env.DB.prepare("SELECT store_json, revision FROM calendar_state WHERE id = 1").first();
  if (!row) return { store: null, revision: 0 };
  return { store: JSON.parse(row.store_json), revision: Number(row.revision) };
}

export async function writeState(env, store, expectedRevision, nowIso) {
  const expected = Number(expectedRevision) || 0;
  const nextRevision = expected + 1;
  const json = JSON.stringify(store);
  if (expected === 0) {
    const result = await env.DB
      .prepare("INSERT INTO calendar_state (id, store_json, revision, updated_at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO NOTHING")
      .bind(json, nextRevision, nowIso).run();
    if (result.meta.changes === 1) return { revision: nextRevision };
    return { conflict: true, current: await readState(env) };
  }
  const result = await env.DB
    .prepare("UPDATE calendar_state SET store_json = ?, revision = ?, updated_at = ? WHERE id = 1 AND revision = ?")
    .bind(json, nextRevision, nowIso, expected).run();
  if (result.meta.changes === 0) return { conflict: true, current: await readState(env) };
  return { revision: nextRevision };
}

// Read-modify-write with bounded retry on optimistic-lock conflict.
async function mutateState(env, mutator, options = {}) {
  const maxAttempts = options.maxAttempts || 4;
  const nowIso = options.nowIso || new Date().toISOString();
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { store, revision } = await readState(env);
    if (!store) throw { status: 404, error: "calendar_not_initialized" };
    mutator(store);
    const write = await writeState(env, store, revision, nowIso);
    if (!write.conflict) return { revision: write.revision, store };
  }
  throw { status: 409, error: "write_conflict" };
}

async function readJsonBody(request) {
  try {
    return await request.json();
  } catch (error) {
    return null;
  }
}

export async function handleGetCalendar(request, env) {
  const { store, revision } = await readState(env);
  return jsonResponse(env, { store, revision });
}

export async function handlePutCalendar(request, env) {
  const body = await readJsonBody(request);
  if (!body || typeof body.store !== "object" || body.store === null) {
    return jsonResponse(env, { error: "missing_store" }, 400);
  }
  const write = await writeState(env, body.store, Number(body.revision || 0), new Date().toISOString());
  if (write.conflict) {
    return jsonResponse(env, { error: "revision_conflict", store: write.current.store, revision: write.current.revision }, 409);
  }
  return jsonResponse(env, { revision: write.revision });
}

export async function handlePostSignup(request, env) {
  const body = await readJsonBody(request);
  if (!body || !body.itemId || !["speaker", "backup", "attendee"].includes(body.role)) {
    return jsonResponse(env, { error: "bad_request" }, 400);
  }
  const nowIso = new Date().toISOString();
  const person = makeServerVolunteer(request.user.name, request.user.sub, body, nowIso);
  try {
    const { revision, store } = await mutateState(env, (store) => addSignup(store, body.itemId, body.role, person), { nowIso });
    return jsonResponse(env, { revision, store });
  } catch (error) {
    if (error && error.status) return jsonResponse(env, { error: error.error }, error.status);
    throw error;
  }
}

export async function handleDeleteSignup(request, env) {
  const body = await readJsonBody(request);
  if (!body || !body.itemId) return jsonResponse(env, { error: "bad_request" }, 400);
  const email = request.user.sub;
  try {
    const { revision, store } = await mutateState(env, (store) => removeSignup(store, body.itemId, email));
    return jsonResponse(env, { revision, store });
  } catch (error) {
    if (error && error.status) return jsonResponse(env, { error: error.error }, error.status);
    throw error;
  }
}

export async function handleGetSignup(request, env) {
  const itemId = new URL(request.url).searchParams.get("itemId");
  if (!itemId) return jsonResponse(env, { error: "bad_request" }, 400);
  const { store } = await readState(env);
  if (!store) return jsonResponse(env, { signup: null });
  return jsonResponse(env, { signup: findSignup(store, itemId, request.user.sub) });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd workers/sangha-worker && npx vitest run test/calendar-state.test.js`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add workers/sangha-worker/src/calendar.js workers/sangha-worker/test/calendar-state.test.js
git commit -m "feat(worker): D1 calendar state read/write + calendar/signups handlers"
```

---

## Task 4: Register calendar routes in `index.js`

**Files:**
- Modify: `workers/sangha-worker/src/index.js`
- Modify: `workers/sangha-worker/test/index.test.js`

- [ ] **Step 1: Add a failing end-to-end route test**

Add to `workers/sangha-worker/test/index.test.js` (it already imports `env`, `createExecutionContext`, `waitOnExecutionContext`, `worker`, and defines `call`). Add an import for `signJwt` at the top and these tests inside `describe("router", ...)`:

```js
// add to imports at top of file:
import { signJwt } from "../src/jwt.js";
```

```js
  it("GET /api/calendar is public and returns null store initially", async () => {
    await env.DB.prepare("DELETE FROM calendar_state").run();
    const res = await call("/api/calendar");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ store: null, revision: 0 });
  });

  it("PUT /api/calendar requires an admin token", async () => {
    const res = await call("/api/calendar", { method: "PUT", body: JSON.stringify({ store: {}, revision: 0 }) });
    expect(res.status).toBe(401);

    const memberToken = await signJwt({ sub: "m@eauclairesangha.org", name: "M", role: "member" }, env.JWT_SIGNING_SECRET, { expiresInSeconds: 600 });
    const res2 = await call("/api/calendar", { method: "PUT", headers: { Authorization: "Bearer " + memberToken }, body: JSON.stringify({ store: {}, revision: 0 }) });
    expect(res2.status).toBe(403);
  });

  it("POST /api/signups works for a member token", async () => {
    await env.DB.prepare("DELETE FROM calendar_state").run();
    const adminToken = await signJwt({ sub: "a@eauclairesangha.org", name: "A", role: "admin" }, env.JWT_SIGNING_SECRET, { expiresInSeconds: 600 });
    const seed = { revision: 0, settings: {}, recurrences: [], history: [], slots: [{ id: "s1", title: "T", speaker: null, backups: [], attendees: [] }] };
    await call("/api/calendar", { method: "PUT", headers: { Authorization: "Bearer " + adminToken }, body: JSON.stringify({ store: seed, revision: 0 }) });

    const memberToken = await signJwt({ sub: "m@eauclairesangha.org", name: "M", role: "member" }, env.JWT_SIGNING_SECRET, { expiresInSeconds: 600 });
    const res = await call("/api/signups", { method: "POST", headers: { Authorization: "Bearer " + memberToken }, body: JSON.stringify({ itemId: "s1", role: "attendee" }) });
    expect(res.status).toBe(200);
    expect((await res.json()).store.slots[0].attendees[0].email).toBe("m@eauclairesangha.org");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd workers/sangha-worker && npx vitest run test/index.test.js`
Expected: FAIL — `/api/calendar` and `/api/signups` hit the 404 handler.

- [ ] **Step 3: Register the routes**

In `workers/sangha-worker/src/index.js`, add imports and routes. The relevant additions:

```js
// add to imports:
import { requireRole } from "./middleware.js";
import {
  handleGetCalendar, handlePutCalendar,
  handlePostSignup, handleDeleteSignup, handleGetSignup
} from "./calendar.js";
```

```js
// add these routes BEFORE the `router.all("*", ...)` catch-all:
router.get("/api/calendar", (request, env) => handleGetCalendar(request, env));
router.put("/api/calendar", requireRole(["admin"], handlePutCalendar));
router.post("/api/signups", requireRole(["member", "admin"], handlePostSignup));
router.delete("/api/signups", requireRole(["member", "admin"], handleDeleteSignup));
router.get("/api/signups", requireRole(["member", "admin"], handleGetSignup));
```

- [ ] **Step 4: Run the full suite**

Run: `cd workers/sangha-worker && npm test`
Expected: PASS — all suites including the new calendar route tests.

- [ ] **Step 5: Commit**

```bash
git add workers/sangha-worker/src/index.js workers/sangha-worker/test/index.test.js
git commit -m "feat(worker): register calendar + signups routes with role gating"
```

---

## Task 5: Client API module (`calendar-api.js`)

**Files:**
- Create: `site/static/js/calendar-api.js`
- Test: `site/tests/calendar-api.test.js`
- Modify: `site/package.json` (add the new test file to the `test` script)

`ECBS.CalendarApi` reads the Worker base URL from `#calendar-app[data-calendar-api]` and the bearer token from `ECBS.Auth` (Plan 04). If either is absent it reports `enabled() === false`, and the client stays on localStorage only.

- [ ] **Step 1: Write the failing test**

`site/tests/calendar-api.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadApi(options = {}) {
  const element = { getAttribute: (name) => (name === "data-calendar-api" ? (options.base ?? "https://worker.test") : null) };
  const context = {
    URL, URLSearchParams, console,
    window: {
      fetch: options.fetch,
      ECBS: { Auth: { getToken: () => options.token || null } }
    },
    document: { getElementById: (id) => (id === "calendar-app" ? element : null) }
  };
  context.window.window = context.window;
  vm.createContext(context);
  const scriptPath = path.join(__dirname, "..", "static", "js", "calendar-api.js");
  vm.runInContext(fs.readFileSync(scriptPath, "utf8"), context, { filename: scriptPath });
  return context.window.ECBS.CalendarApi;
}

test("enabled reflects whether an API base is configured", () => {
  assert.equal(loadApi({ base: "https://worker.test" }).enabled(), true);
  assert.equal(loadApi({ base: "" }).enabled(), false);
});

test("fetchStore GETs /api/calendar and returns parsed JSON", async () => {
  let seenUrl;
  const fetchImpl = async (url) => { seenUrl = url; return new Response(JSON.stringify({ store: { slots: [] }, revision: 3 }), { status: 200 }); };
  const api = loadApi({ fetch: fetchImpl });
  const data = await api.fetchStore();
  assert.equal(seenUrl, "https://worker.test/api/calendar");
  assert.equal(data.revision, 3);
});

test("putStore sends the bearer token and the revision", async () => {
  let init;
  const fetchImpl = async (url, opts) => { init = opts; return new Response(JSON.stringify({ revision: 5 }), { status: 200 }); };
  const api = loadApi({ fetch: fetchImpl, token: "jwt-123" });
  const res = await api.putStore({ slots: [] }, 4);
  assert.equal(init.method, "PUT");
  assert.equal(init.headers.Authorization, "Bearer jwt-123");
  assert.equal(JSON.parse(init.body).revision, 4);
  assert.equal(res.revision, 5);
});

test("putStore surfaces a 409 conflict payload", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ error: "revision_conflict", revision: 9, store: { slots: [] } }), { status: 409 });
  const api = loadApi({ fetch: fetchImpl, token: "jwt" });
  await assert.rejects(() => api.putStore({}, 1), (err) => err.conflict && err.conflict.revision === 9);
});

test("postSignup POSTs the payload with auth", async () => {
  let init;
  const fetchImpl = async (url, opts) => { init = opts; return new Response(JSON.stringify({ revision: 6, store: {} }), { status: 200 }); };
  const api = loadApi({ fetch: fetchImpl, token: "jwt" });
  await api.postSignup({ itemId: "s1", role: "attendee" });
  assert.equal(init.method, "POST");
  assert.equal(JSON.parse(init.body).itemId, "s1");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd site && node --test tests/calendar-api.test.js`
Expected: FAIL — `calendar-api.js` not found.

- [ ] **Step 3: Create `calendar-api.js`**

```js
// site/static/js/calendar-api.js
// Thin client for the sangha-worker calendar API. Reads the Worker base from
// #calendar-app[data-calendar-api] and the bearer token from ECBS.Auth.
// If no base is configured, enabled() is false and the calendar stays local.
(function () {
  "use strict";
  var ECBS = (window.ECBS = window.ECBS || {});

  function apiBase() {
    var root = document.getElementById("calendar-app");
    var base = root ? root.getAttribute("data-calendar-api") : "";
    return (base || "").replace(/\/+$/, "");
  }

  function authToken() {
    return (ECBS.Auth && ECBS.Auth.getToken && ECBS.Auth.getToken()) || null;
  }

  function headers(withJson) {
    var h = {};
    if (withJson) h["Content-Type"] = "application/json";
    var token = authToken();
    if (token) h["Authorization"] = "Bearer " + token;
    return h;
  }

  function enabled() {
    return Boolean(apiBase());
  }

  function fetchImplFrom(options) {
    return (options && options.fetch) || window.fetch.bind(window);
  }

  async function fetchStore(options) {
    var res = await fetchImplFrom(options)(apiBase() + "/api/calendar", { headers: headers(false) });
    if (!res.ok) throw new Error("fetch calendar failed: " + res.status);
    return res.json();
  }

  async function putStore(store, revision, options) {
    var res = await fetchImplFrom(options)(apiBase() + "/api/calendar", {
      method: "PUT",
      headers: headers(true),
      body: JSON.stringify({ store: store, revision: revision })
    });
    if (res.status === 409) {
      var conflict = await res.json();
      var err = new Error("revision_conflict");
      err.conflict = conflict;
      throw err;
    }
    if (!res.ok) throw new Error("put calendar failed: " + res.status);
    return res.json();
  }

  async function postSignup(payload, options) {
    var res = await fetchImplFrom(options)(apiBase() + "/api/signups", {
      method: "POST",
      headers: headers(true),
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error("signup failed: " + res.status);
    return res.json();
  }

  async function deleteSignup(payload, options) {
    var res = await fetchImplFrom(options)(apiBase() + "/api/signups", {
      method: "DELETE",
      headers: headers(true),
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error("cancel signup failed: " + res.status);
    return res.json();
  }

  ECBS.CalendarApi = {
    apiBase: apiBase,
    enabled: enabled,
    fetchStore: fetchStore,
    putStore: putStore,
    postSignup: postSignup,
    deleteSignup: deleteSignup
  };
})();
```

- [ ] **Step 4: Add the test to the package test script**

In `site/package.json`, change the `test` script to run both files:

```json
    "test": "node --test tests/calendar.test.js tests/calendar-api.test.js",
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd site && node --test tests/calendar-api.test.js`
Expected: PASS — 5 tests.

- [ ] **Step 6: Commit**

```bash
git add site/static/js/calendar-api.js site/tests/calendar-api.test.js site/package.json
git commit -m "feat(calendar): ECBS.CalendarApi client for the Worker calendar API"
```

---

## Task 6: `diffMemberSignups` — derive the member's own signup deltas

**Files:**
- Modify: `site/static/js/calendar.js` (add helpers + export)
- Modify: `site/tests/calendar.test.js` (add tests)

This is the seam that lets member RSVPs reach `/api/signups` without rewriting the 29 `saveStore` call sites: given the store before and after a local write, it returns only the changes to *this member's own* participation.

- [ ] **Step 1: Write the failing test**

Add to `site/tests/calendar.test.js`:

```js
test("diffMemberSignups detects add, remove, role change, and detail edits", () => {
  const api = loadApi();
  const email = "mem@example.com";
  const prev = api.normalizeStore({
    slots: [
      { id: "add", date: "2026-06-09", speaker: null, backups: [], attendees: [] },
      { id: "remove", date: "2026-06-09", speaker: null, backups: [api.makeVolunteer("Mem", "", "", "t", email)], attendees: [] },
      { id: "change", date: "2026-06-09", speaker: null, backups: [api.makeVolunteer("Mem", "", "", "t", email)], attendees: [] },
      { id: "detail", date: "2026-06-09", speaker: api.makeVolunteer("Mem", "old-link", "", "t", email), backups: [], attendees: [] },
      { id: "other", date: "2026-06-09", speaker: api.makeVolunteer("Someone", "", "", "t", "other@example.com"), backups: [], attendees: [] }
    ]
  });
  const next = api.normalizeStore({
    slots: [
      { id: "add", date: "2026-06-09", speaker: null, backups: [], attendees: [api.makeVolunteer("Mem", "", "", "t", email)] },
      { id: "remove", date: "2026-06-09", speaker: null, backups: [], attendees: [] },
      { id: "change", date: "2026-06-09", speaker: api.makeVolunteer("Mem", "", "", "t", email), backups: [], attendees: [] },
      { id: "detail", date: "2026-06-09", speaker: api.makeVolunteer("Mem", "new-link", "", "t", email), backups: [], attendees: [] },
      { id: "other", date: "2026-06-09", speaker: api.makeVolunteer("Someone", "", "", "t", "other@example.com"), backups: [], attendees: [] }
    ]
  });

  const deltas = api.diffMemberSignups(prev, next, email);
  const byId = Object.fromEntries(deltas.map((d) => [d.itemId, d]));

  assert.equal(byId.add.action, "add");
  assert.equal(byId.add.role, "attendee");
  assert.equal(byId.remove.action, "remove");
  assert.equal(byId.change.action, "add");
  assert.equal(byId.change.role, "speaker");
  assert.equal(byId.detail.action, "add");
  assert.equal(byId.detail.link, "new-link");
  assert.equal(byId.other, undefined); // never reports another member's change
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd site && node --test tests/calendar.test.js`
Expected: FAIL — `api.diffMemberSignups is not a function`.

- [ ] **Step 3: Add the helpers to `calendar.js`**

Add these functions inside the IIFE in `site/static/js/calendar.js` (place them just above the `if (typeof window !== "undefined")` export block near line 4079):

```js
  function memberRoleOnSlot(slot, email) {
    if (!slot) return null;
    var lc = String(email || "").toLowerCase();
    if (slot.speaker && String(slot.speaker.email || "").toLowerCase() === lc) return "speaker";
    if ((slot.backups || []).some(function (b) { return String(b.email || "").toLowerCase() === lc; })) return "backup";
    if ((slot.attendees || []).some(function (a) { return String(a.email || "").toLowerCase() === lc; })) return "attendee";
    return null;
  }

  function memberEntryOnSlot(slot, email, role) {
    var lc = String(email || "").toLowerCase();
    if (role === "speaker") return slot.speaker;
    var list = role === "backup" ? slot.backups : slot.attendees;
    return (list || []).filter(function (p) { return String(p.email || "").toLowerCase() === lc; })[0] || null;
  }

  function entriesDiffer(a, b) {
    if (!a || !b) return Boolean(a) !== Boolean(b);
    if ((a.link || "") !== (b.link || "")) return true;
    if ((a.notes || "") !== (b.notes || "")) return true;
    return (a.reminders || []).join(",") !== (b.reminders || []).join(",");
  }

  // Returns the changes to THIS member's own participation between two stores.
  function diffMemberSignups(prevStore, nextStore, email) {
    var deltas = [];
    var prevById = {};
    (prevStore.slots || []).forEach(function (slot) { prevById[slot.id] = slot; });
    (nextStore.slots || []).forEach(function (slot) {
      var prevSlot = prevById[slot.id];
      var before = memberRoleOnSlot(prevSlot, email);
      var after = memberRoleOnSlot(slot, email);
      if (!before && !after) return;
      if (before && !after) {
        deltas.push({ itemId: slot.id, action: "remove" });
        return;
      }
      if (after && before === after && !entriesDiffer(memberEntryOnSlot(prevSlot, email, before), memberEntryOnSlot(slot, email, after))) {
        return; // unchanged
      }
      var entry = memberEntryOnSlot(slot, email, after) || {};
      deltas.push({
        itemId: slot.id,
        action: "add",
        role: after,
        link: entry.link || "",
        notes: entry.notes || "",
        reminders: entry.reminders || []
      });
    });
    return deltas;
  }
```

Then add these to the `window.ECBSCalendarTest = { ... }` object (so tests can reach them):

```js
      diffMemberSignups: diffMemberSignups,
      memberRoleOnSlot: memberRoleOnSlot,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd site && node --test tests/calendar.test.js`
Expected: PASS — including the new `diffMemberSignups` test, with the full existing suite still green.

- [ ] **Step 5: Commit**

```bash
git add site/static/js/calendar.js site/tests/calendar.test.js
git commit -m "feat(calendar): diffMemberSignups to derive a member's own signup deltas"
```

---

## Task 7: Wire boot hydration + `saveStore` write-through

**Files:**
- Modify: `site/static/js/calendar.js`

The client renders instantly from localStorage (unchanged), then hydrates from the server. Writes persist to localStorage (unchanged) and, best-effort, to the Worker: admins push the full store via `PUT`; members push only their own signup deltas via `/api/signups`. Server failures fall back silently to localStorage (existing offline behavior).

- [ ] **Step 1: Add a module-level server-revision tracker**

Near the top of the IIFE in `calendar.js` (after `var ADMIN_ACCESS_KEY = ...` around line 26), add:

```js
  var serverRevision = 0;
```

- [ ] **Step 2: Refactor the view dispatch out of `boot`**

In `calendar.js`, the `boot()` function (around line 4060) currently inlines the view dispatch. Replace the inline `if (view === ...)` block with a call to a new `renderForView`, and add the function. The `boot` body becomes:

```js
      applyUserFromQuery();
      var view = root.getAttribute("data-calendar-view");
      renderForView(root, view);
      hydrateFromServer(root, view);
```

And add these two functions (just below `boot`):

```js
  function renderForView(root, view) {
    if (view === "calendar") renderCalendar(root, {});
    if (view === "admin") {
      if (hasCalendarAdminAccess()) renderAdmin(root, {});
      else renderAdminAccessGate(root);
    }
    if (view === "schedule") renderSchedule(root);
  }

  function hydrateFromServer(root, view) {
    if (!window.ECBS || !window.ECBS.CalendarApi || !window.ECBS.CalendarApi.enabled()) return;
    window.ECBS.CalendarApi.fetchStore().then(function (data) {
      if (!data || !data.store) return; // server not seeded yet; keep local cache
      serverRevision = Number(data.revision || 0);
      if (window.localStorage) {
        var normalized = normalizeStore(data.store);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
      }
      renderForView(root, view);
    }).catch(function (error) {
      if (window.console && window.console.warn) {
        window.console.warn("Calendar server hydrate failed; using local cache.", error);
      }
    });
  }
```

- [ ] **Step 3: Add write-through to `saveStore`**

Replace the body of `saveStore` (line 201) with the version that records the previous store and syncs to the server. The function becomes:

```js
  function saveStore(store) {
    if (!window.localStorage) return;
    var previous = loadStore(); // pre-write snapshot, used for the member delta
    var normalized = normalizeStore(store);
    normalized.revision = Number(store.revision || 0) + 1;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    syncStoreToServer(previous, normalized);
  }

  function syncStoreToServer(previousStore, nextStore) {
    if (!window.ECBS || !window.ECBS.CalendarApi || !window.ECBS.CalendarApi.enabled()) return;
    var api = window.ECBS.CalendarApi;
    var auth = window.ECBS.Auth;
    var user = auth && auth.getUser ? auth.getUser() : null;
    if (!user) return; // anonymous: cannot persist server-side (read-only)

    if (user.role === "admin") {
      api.putStore(nextStore, serverRevision).then(function (res) {
        serverRevision = Number(res.revision || serverRevision);
      }).catch(function (error) {
        if (error && error.conflict) {
          // Someone else saved first — adopt server state and re-render.
          serverRevision = Number(error.conflict.revision || serverRevision);
          if (error.conflict.store && window.localStorage) {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeStore(error.conflict.store)));
          }
          var root = document.getElementById("calendar-app");
          if (root) renderForView(root, root.getAttribute("data-calendar-view"));
        } else if (window.console && window.console.warn) {
          window.console.warn("Admin calendar sync failed; kept local copy.", error);
        }
      });
      return;
    }

    // Member: push only this member's own signup deltas.
    var deltas = diffMemberSignups(previousStore, nextStore, user.email);
    deltas.forEach(function (delta) {
      var request = delta.action === "remove"
        ? api.deleteSignup({ itemId: delta.itemId })
        : api.postSignup({ itemId: delta.itemId, role: delta.role, link: delta.link, notes: delta.notes, reminders: delta.reminders });
      request.then(function (res) {
        if (res && res.revision) serverRevision = Number(res.revision);
      }).catch(function (error) {
        if (window.console && window.console.warn) {
          window.console.warn("Signup sync failed; kept local copy.", error);
        }
      });
    });
  }
```

- [ ] **Step 4: Add a regression test for the admin write-through path**

Add to `site/tests/calendar.test.js` (this uses the DOM harness and a stubbed `ECBS`):

```js
test("admin saveStore pushes the full store via CalendarApi.putStore", () => {
  const api = loadDomApi();
  const calls = [];
  api.__window.ECBS = {
    Auth: { getUser: () => ({ email: "a@example.com", role: "admin" }), getToken: () => "t" },
    CalendarApi: {
      enabled: () => true,
      putStore: (store, revision) => { calls.push({ store, revision }); return Promise.resolve({ revision: revision + 1 }); },
      postSignup: () => Promise.resolve({}),
      deleteSignup: () => Promise.resolve({})
    }
  };
  api.__setStore({ slots: [{ id: "s1", date: "2026-06-09", title: "T", speaker: null, backups: [], attendees: [] }] });

  api.renderAdmin(api.__root, { year: 2026, month: 5, selectedDate: "2026-06-09", selectedSlotId: "s1" });
  api.__root.querySelector("[data-cancel-meeting]").click();
  api.__root.querySelector("[data-confirm-admin-action]").click();

  assert.ok(calls.length >= 1, "expected putStore to be called on admin save");
});
```

> Note: `loadDomApi` already injects a `window`; the test sets `ECBS` on it before triggering an admin save. The cancel-meeting flow is a known admin write that calls `saveStore`.

- [ ] **Step 5: Run the client suite**

Run: `cd site && npm test`
Expected: PASS — existing tests, `diffMemberSignups`, and the admin write-through test.

- [ ] **Step 6: Commit**

```bash
git add site/static/js/calendar.js site/tests/calendar.test.js
git commit -m "feat(calendar): hydrate from server on boot and write through saveStore"
```

---

## Task 8: Hugo wiring — API base URL on the calendar pages

**Files:**
- Modify: `site/hugo.yaml`
- Modify: `site/layouts/_default/calendar.html`
- Modify: `site/layouts/_default/calendar-admin.html`
- Modify: `site/layouts/_default/calendar-item.html`

- [ ] **Step 1: Add the param**

In `site/hugo.yaml`, under `params:` (after `site_description`), add:

```yaml
  calendarApiBase: https://sangha-worker.eau-claire-buddhist-sangha.workers.dev
```

(Use the deployed Worker URL.)

- [ ] **Step 2: Add `data-calendar-api` + load `calendar-api.js` on all three calendar layouts**

In **each** of `calendar.html`, `calendar-admin.html`, `calendar-item.html`, update the `#calendar-app` div to include the API base, and load `calendar-api.js` **before** `calendar.js`.

For `site/layouts/_default/calendar.html`, change line 8 from:

```html
    <div id="calendar-app" data-calendar-view="calendar" data-calendar-base="{{ "" | relURL }}" data-calendar-local-dev="{{ hugo.IsServer }}"></div>
```

to:

```html
    <div id="calendar-app" data-calendar-view="calendar" data-calendar-base="{{ "" | relURL }}" data-calendar-api="{{ .Site.Params.calendarApiBase }}" data-calendar-local-dev="{{ hugo.IsServer }}"></div>
```

and change the script block at the bottom from:

```html
{{ $calendarVersion := readFile "static/js/calendar.js" | md5 }}
<script src="{{ "js/calendar.js" | relURL }}?v={{ $calendarVersion }}"></script>
```

to:

```html
{{ $calendarApiVersion := readFile "static/js/calendar-api.js" | md5 }}
{{ $calendarVersion := readFile "static/js/calendar.js" | md5 }}
<script src="{{ "js/calendar-api.js" | relURL }}?v={{ $calendarApiVersion }}"></script>
<script src="{{ "js/calendar.js" | relURL }}?v={{ $calendarVersion }}"></script>
```

Apply the identical two edits to `calendar-admin.html` (keep its `data-calendar-view="admin"`) and `calendar-item.html` (keep its `data-calendar-view="schedule"`).

- [ ] **Step 3: Build and verify the rendered markup**

Run:
```bash
cd site && hugo
grep -o 'data-calendar-api="[^"]*"' public/calendar/index.html
grep -c 'js/calendar-api.js' public/calendar/index.html public/calendar-item/index.html
```
Expected: the `data-calendar-api` attribute shows the Worker URL; `calendar-api.js` is referenced once on each page.

- [ ] **Step 4: Manual end-to-end check (after Plan 04 provides `ECBS.Auth`)**

With the Worker deployed and an admin signed in: open `/admin/calendar/`, create/edit an item → confirm a `PUT /api/calendar` 200 in the network tab. Sign in as a member, open a `/calendar-item/?slot=...` page, volunteer → confirm a `POST /api/signups` 200. Open the calendar on a second device/browser → the change is present (server is source of truth). Stop the Worker → calendar still renders from localStorage (graceful fallback).

> Until Plan 04 ships `ECBS.Auth`, `CalendarApi` reads no token: `GET /api/calendar` still hydrates (public), but writes that require auth are skipped client-side (anonymous → read-only), exactly as intended.

- [ ] **Step 5: Commit**

```bash
git add site/hugo.yaml site/layouts/_default/calendar.html site/layouts/_default/calendar-admin.html site/layouts/_default/calendar-item.html
git commit -m "feat(calendar): wire Worker API base into calendar pages"
```

---

## Self-Review

**1. Spec coverage (Calendar backend slice):**
- "Worker replaces localStorage with D1-backed API calls" — Tasks 1–4 (D1 + endpoints), Tasks 6–8 (client wiring). ✓
- "Hybrid Client/Server: render from localStorage, writes go to API first, fall back to localStorage if unreachable" — Task 7 (`hydrateFromServer` + `syncStoreToServer` with `.catch` fallback). ✓
- Optimistic locking / revision-mismatch → HTTP 409 "refreshed" — `writeState`/`handlePutCalendar` (Task 3) + admin conflict handler re-render (Task 7). ✓
- Signups (RSVP / volunteer / backup / attend) require member+ — `requireRole(["member","admin"])` on `/api/signups` (Task 4); server-authoritative identity (Task 2). ✓
- `GET /api/calendar` public; admin-only writes — Task 4 role gating. ✓
- "Admin API call without admin JWT → 403"; "Worker unreachable → localStorage fallback" (spec §Error Handling) — Task 4 (403) + Task 7 (fallback). ✓
- **Documented deviations (both in Architecture):** (a) eight normalized tables → one JSON document table; (b) granular admin item/settings/recurrence routes → one optimistic `PUT /api/calendar`. The spec's data still lives in the document (`slots`, `recurrences`, `settings`, `history`, `notifications`, `reminders`), so future normalization remains possible.

**2. Placeholder scan:** No TBD/TODO/vague steps. The only intentional placeholder is `PASTE_DATABASE_ID_FROM_STEP_2` in `wrangler.toml` (a value the engineer obtains from `wrangler d1 create`, clearly labeled) and the deployed Worker host in `hugo.yaml`. ✓

**3. Type consistency:**
- Volunteer/person shape `{ name, email, link, notes, reminders, signedUpAt }` matches the client's `normalizeVolunteer` (calendar.js:256) and the server's `makeServerVolunteer` (Task 2). ✓
- Store shape `{ revision, slots[], recurrences[], settings, history[] }` is identical client-side (calendar.js `normalizeStore`) and server-side (stored as `store_json`). ✓
- `diffMemberSignups(prev, next, email)` returns `{ itemId, action: "add"|"remove", role?, link?, notes?, reminders? }`; consumed by `syncStoreToServer` calling `api.postSignup({ itemId, role, link, notes, reminders })` / `api.deleteSignup({ itemId })` — payload keys match the worker's `handlePostSignup`/`handleDeleteSignup` body parsing (`body.itemId`, `body.role`, `body.link`, `body.notes`, `body.reminders`). ✓
- Worker returns `{ revision }` (PUT) and `{ revision, store }` (signups); client reads `res.revision` and `error.conflict.revision`/`error.conflict.store` — consistent with `handlePutCalendar`'s 409 body `{ error, store, revision }`. ✓
- `ECBS.Auth.getUser()` returns `{ name, email, role }` and `ECBS.Auth.getToken()` returns the JWT string — both defined in Plan 04; this plan only consumes them and degrades when absent. ✓
