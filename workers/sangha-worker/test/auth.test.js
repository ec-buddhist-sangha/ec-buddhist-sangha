import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { handleLogin, handleCallback } from "../src/auth.js";
import { verifyJwt } from "../src/jwt.js";

function fakeIdToken(payload) {
  const enc = (o) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return enc({ alg: "RS256" }) + "." + enc(payload) + ".sig";
}

describe("handleLogin", () => {
  it("redirects to Google with a verifiable signed state", async () => {
    const req = new Request("https://worker.test/auth/login?return_to=https://eauclairesangha.org/calendar/");
    const res = await handleLogin(req, env);
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("Location"));
    expect(location.origin).toBe("https://accounts.google.com");
    const state = await verifyJwt(location.searchParams.get("state"), env.JWT_SIGNING_SECRET);
    expect(state.kind).toBe("login-state");
    expect(state.return_to).toBe("https://eauclairesangha.org/calendar/");
  });

  it("ignores a cross-origin return_to and falls back to CORS_ORIGIN", async () => {
    const req = new Request("https://worker.test/auth/login?return_to=https://evil.example/grab");
    const res = await handleLogin(req, env);
    const state = await verifyJwt(new URL(res.headers.get("Location")).searchParams.get("state"), env.JWT_SIGNING_SECRET);
    expect(state.return_to).toBe(env.CORS_ORIGIN);
  });

  it("preserves a same-origin return_to", async () => {
    const req = new Request("https://worker.test/auth/login?return_to=https://eauclairesangha.org/calendar/");
    const res = await handleLogin(req, env);
    const state = await verifyJwt(new URL(res.headers.get("Location")).searchParams.get("state"), env.JWT_SIGNING_SECRET);
    expect(state.return_to).toBe("https://eauclairesangha.org/calendar/");
  });
});

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
