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
