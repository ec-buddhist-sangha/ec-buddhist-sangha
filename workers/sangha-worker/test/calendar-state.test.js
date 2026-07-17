import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import {
  readState, writeState, handleGetCalendar, handlePutCalendar,
  handlePostSignup, handleDeleteSignup, handleGetSignup,
  deterministicOccurrenceId, materializeOccurrence, projectStore
} from "../src/calendar.js";

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
    const res = await handlePostSignup(req, env, { nowIso: NOW });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.store.slots[0].attendees[0].email).toBe("mem@eauclairesangha.org");
  });

  it("GET then DELETE /api/signups round-trips the caller's signup", async () => {
    await writeState(env, seedStore(), 0, NOW);
    const post = new Request("https://worker.test/api/signups", { method: "POST", body: JSON.stringify({ itemId: "s1", role: "backup" }) });
    post.user = { sub: "mem@eauclairesangha.org", name: "Mem", role: "member" };
    await handlePostSignup(post, env, { nowIso: NOW });

    const get = new Request("https://worker.test/api/signups?itemId=s1");
    get.user = { sub: "mem@eauclairesangha.org", name: "Mem", role: "member" };
    expect((await (await handleGetSignup(get, env)).json()).signup.role).toBe("backup");

    const del = new Request("https://worker.test/api/signups", { method: "DELETE", body: JSON.stringify({ itemId: "s1" }) });
    del.user = { sub: "mem@eauclairesangha.org", name: "Mem", role: "member" };
    await handleDeleteSignup(del, env, { nowIso: NOW });

    const get2 = new Request("https://worker.test/api/signups?itemId=s1");
    get2.user = { sub: "mem@eauclairesangha.org", name: "Mem", role: "member" };
    expect((await (await handleGetSignup(get2, env)).json()).signup).toBeNull();
  });

  it("POST /api/signups 404s before the calendar is seeded", async () => {
    const req = new Request("https://worker.test/api/signups", { method: "POST", body: JSON.stringify({ itemId: "s1", role: "attendee" }) });
    req.user = { sub: "mem@eauclairesangha.org", name: "Mem", role: "member" };
    const res = await handlePostSignup(req, env, { nowIso: NOW });
    expect(res.status).toBe(404);
  });

  it("projects private calendar fields by viewer role", () => {
    const store = seedStore();
    store.slots[0].speaker = { name: "Virginia Example", email: "virginia@example.com", link: "https://talk.example", notes: "Bring questions", reminders: ["one-day"], signedUpAt: NOW };
    store.slots[0].backups = [{ name: "Bob Member", email: "bob@example.com", link: "https://backup.example", notes: "Backup notes", reminders: ["one-week"], signedUpAt: NOW }];
    store.slots[0].attendees = [{ name: "Hidden Attendee", email: "hidden@example.com", reminders: ["morning-of"] }];
    store.slots[0].notifications = [{ toEmail: "private@example.com" }];
    store.history = [{ summary: "Private admin history" }];

    const publicStore = projectStore(store, null, 7);
    expect(publicStore.slots[0].speaker.name).toBe("Virginia E.");
    expect(publicStore.slots[0].speaker.email).toBe("");
    expect(publicStore.slots[0].speaker.link).toBe("https://talk.example");
    expect(publicStore.slots[0].attendees).toEqual([]);
    expect(publicStore.slots[0].attendanceCount).toBe(3);
    expect(publicStore.slots[0].notifications).toEqual([]);
    expect(publicStore.history).toEqual([]);

    const memberStore = projectStore(store, { sub: "bob@example.com", role: "member" }, 7);
    expect(memberStore.slots[0].backups[0].email).toBe("bob@example.com");
    expect(memberStore.slots[0].backups[0].reminders).toEqual(["one-week"]);

    const pendingStore = projectStore(store, { sub: "bob@example.com", role: "reader" }, 7);
    expect(pendingStore.slots[0].backups[0].email).toBe("");
    expect(pendingStore.slots[0].backups[0].reminders).toEqual([]);

    const adminStore = projectStore(store, { sub: "admin@example.com", role: "admin" }, 7);
    expect(adminStore.slots[0].attendees[0].email).toBe("hidden@example.com");
    expect(adminStore.slots[0].backups[0].fairnessRank).toBe(1);
    expect(adminStore.history).toHaveLength(1);
  });

  it("materializes deterministic recurring occurrences", () => {
    const store = seedStore();
    store.slots = [];
    store.recurrences = [{
      id: "weekly", active: true, itemType: "talk", frequency: "weekly", interval: 1,
      startDate: "2026-06-02", startTime: "19:00", endTime: "20:30", skippedDates: []
    }];
    const id = deterministicOccurrenceId("weekly", "2026-06-09");
    const slot = materializeOccurrence(store, id);
    expect(slot.id).toBe("occ-weekly-2026-06-09");
    expect(store.slots).toHaveLength(1);
    expect(materializeOccurrence(store, id)).toBe(slot);
  });

  it("rejects closed, early, and invalid-role signups", async () => {
    const store = seedStore();
    store.slots[0].date = "2026-05-26";
    await writeState(env, store, 0, NOW);
    const closed = new Request("https://worker.test/api/signups", { method: "POST", body: JSON.stringify({ itemId: "s1", role: "attendee" }) });
    closed.user = { sub: "mem@example.com", name: "Mem", role: "member" };
    expect((await handlePostSignup(closed, env, { nowIso: NOW })).status).toBe(409);

    await env.DB.prepare("DELETE FROM calendar_state").run();
    store.slots[0].date = "2026-09-01";
    await writeState(env, store, 0, NOW);
    const early = new Request("https://worker.test/api/signups", { method: "POST", body: JSON.stringify({ itemId: "s1", role: "attendee" }) });
    early.user = { sub: "mem@example.com", name: "Mem", role: "member" };
    expect(await (await handlePostSignup(early, env, { nowIso: NOW })).json()).toEqual({ error: "signup_not_open" });

    await env.DB.prepare("DELETE FROM calendar_state").run();
    store.slots[0].date = "2026-06-09";
    store.slots[0].itemType = "meeting";
    await writeState(env, store, 0, NOW);
    const badRole = new Request("https://worker.test/api/signups", { method: "POST", body: JSON.stringify({ itemId: "s1", role: "speaker" }) });
    badRole.user = { sub: "mem@example.com", name: "Mem", role: "member" };
    expect(await (await handlePostSignup(badRole, env, { nowIso: NOW })).json()).toEqual({ error: "role_not_allowed" });
  });

  it("rejects unsafe signup details and invalid calendar item types", async () => {
    const store = seedStore();
    await writeState(env, store, 0, NOW);
    const requestFor = (body) => {
      const request = new Request("https://worker.test/api/signups", { method: "POST", body: JSON.stringify({ itemId: "s1", role: "backup", ...body }) });
      request.user = { sub: "mem@example.com", name: "Mem", role: "member" };
      return request;
    };
    expect(await (await handlePostSignup(requestFor({ link: "javascript:alert(1)" }), env, { nowIso: NOW })).json()).toEqual({ error: "invalid_link" });
    expect(await (await handlePostSignup(requestFor({ reminders: ["three-days"] }), env, { nowIso: NOW })).json()).toEqual({ error: "invalid_reminders" });
    expect(await (await handlePostSignup(requestFor({ notes: "x".repeat(2001) }), env, { nowIso: NOW })).json()).toEqual({ error: "invalid_notes" });

    await env.DB.prepare("DELETE FROM calendar_state").run();
    store.slots[0].itemType = "other";
    await writeState(env, store, 0, NOW);
    expect(await (await handlePostSignup(requestFor({}), env, { nowIso: NOW })).json()).toEqual({ error: "invalid_item_type" });
  });
});
