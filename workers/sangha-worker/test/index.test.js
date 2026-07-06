import { describe, it, expect } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "../src/index.js";
import { signJwt } from "../src/jwt.js";

async function call(path, init) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request("https://worker.test" + path, init), env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function seedRole(email, role) {
  await env.DB
    .prepare("INSERT INTO members (email, name, role, request_status) VALUES (?, 'U', ?, 'none') ON CONFLICT(email) DO UPDATE SET role = excluded.role")
    .bind(email.toLowerCase(), role)
    .run();
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

  it("/decap/auth redirects to GitHub", async () => {
    const res = await call("/decap/auth?provider=github");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("github.com/login/oauth/authorize");
  });

  it("GET /api/calendar is public and returns null store initially", async () => {
    await env.DB.prepare("DELETE FROM calendar_state").run();
    const res = await call("/api/calendar");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ store: null, revision: 0 });
  });

  it("PUT /api/calendar requires an admin token", async () => {
    const res = await call("/api/calendar", { method: "PUT", body: JSON.stringify({ store: {}, revision: 0 }) });
    expect(res.status).toBe(401);

    await seedRole("m@eauclairesangha.org", "member");
    const memberToken = await signJwt({ sub: "m@eauclairesangha.org", name: "M", role: "member" }, env.JWT_SIGNING_SECRET, { expiresInSeconds: 600 });
    const res2 = await call("/api/calendar", { method: "PUT", headers: { Authorization: "Bearer " + memberToken }, body: JSON.stringify({ store: {}, revision: 0 }) });
    expect(res2.status).toBe(403);
  });

  it("POST /api/signups works for a member token", async () => {
    await env.DB.prepare("DELETE FROM calendar_state").run();
    await seedRole("a@eauclairesangha.org", "admin");
    await seedRole("m@eauclairesangha.org", "member");
    const adminToken = await signJwt({ sub: "a@eauclairesangha.org", name: "A", role: "admin" }, env.JWT_SIGNING_SECRET, { expiresInSeconds: 600 });
    const seed = { revision: 0, settings: {}, recurrences: [], history: [], slots: [{ id: "s1", title: "T", speaker: null, backups: [], attendees: [] }] };
    await call("/api/calendar", { method: "PUT", headers: { Authorization: "Bearer " + adminToken }, body: JSON.stringify({ store: seed, revision: 0 }) });

    const memberToken = await signJwt({ sub: "m@eauclairesangha.org", name: "M", role: "member" }, env.JWT_SIGNING_SECRET, { expiresInSeconds: 600 });
    const res = await call("/api/signups", { method: "POST", headers: { Authorization: "Bearer " + memberToken }, body: JSON.stringify({ itemId: "s1", role: "attendee" }) });
    expect(res.status).toBe(200);
    expect((await res.json()).store.slots[0].attendees[0].email).toBe("m@eauclairesangha.org");
  });

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
});
