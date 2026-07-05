import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { getBootstrapAdmins, resolveRole, getMember, upsertReader, listMembers, listPending, requestAccess, approveMember, denyMember, setRole } from "../src/members.js";

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
  it("preserves pending request_status on upsert", async () => {
    await env.DB.prepare("INSERT INTO members (email, name, role, request_status) VALUES ('pend@x.org','Old','reader','pending')").run();
    await upsertReader(env, "pend@x.org", "NewName", "2026-07-05T00:00:00.000Z");
    const row = await getMember(env, "pend@x.org");
    expect(row.request_status).toBe("pending");
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
