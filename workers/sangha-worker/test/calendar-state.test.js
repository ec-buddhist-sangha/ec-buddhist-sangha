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
