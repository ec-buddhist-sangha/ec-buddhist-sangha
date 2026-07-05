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
