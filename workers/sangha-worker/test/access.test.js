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
