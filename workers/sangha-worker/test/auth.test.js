import { describe, it, expect } from "vitest";
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
});

describe("handleCallback", () => {
  function mockFetch(idClaims, groupRole) {
    return async (url) => {
      if (url === "https://oauth2.googleapis.com/token") {
        return new Response(JSON.stringify({ id_token: fakeIdToken(idClaims), access_token: "at" }), { status: 200 });
      }
      if (String(url).includes("/admin/directory/")) {
        if (groupRole === null) return new Response("{}", { status: 404 });
        return new Response(JSON.stringify({ role: groupRole, status: "ACTIVE" }), { status: 200 });
      }
      throw new Error("unexpected fetch: " + url);
    };
  }

  async function callbackWith(idClaims, groupRole) {
    const state = await (await import("../src/jwt.js")).signJwt(
      { kind: "login-state", return_to: "https://eauclairesangha.org/calendar/" },
      env.JWT_SIGNING_SECRET, { expiresInSeconds: 600 }
    );
    const req = new Request("https://worker.test/auth/callback?code=auth-code&state=" + encodeURIComponent(state));
    return handleCallback(req, env, { fetch: mockFetch(idClaims, groupRole), accessToken: "svc-token" });
  }

  it("issues a member JWT in the redirect fragment for a group member", async () => {
    const res = await callbackWith({ email: "member@eauclairesangha.org", name: "Mem" }, "MEMBER");
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("Location"));
    expect(loc.origin + loc.pathname).toBe("https://eauclairesangha.org/calendar/");
    const token = new URLSearchParams(loc.hash.slice(1)).get("token");
    const claims = await verifyJwt(token, env.JWT_SIGNING_SECRET);
    expect(claims.sub).toBe("member@eauclairesangha.org");
    expect(claims.role).toBe("member");
  });

  it("issues an admin JWT for an OWNER", async () => {
    const res = await callbackWith({ email: "boss@eauclairesangha.org", name: "Boss" }, "OWNER");
    const loc = new URL(res.headers.get("Location"));
    const token = new URLSearchParams(loc.hash.slice(1)).get("token");
    const claims = await verifyJwt(token, env.JWT_SIGNING_SECRET);
    expect(claims.role).toBe("admin");
  });

  it("redirects with an error when the user is not a group member", async () => {
    const res = await callbackWith({ email: "stranger@example.com", name: "X" }, null);
    const loc = new URL(res.headers.get("Location"));
    expect(loc.hash).toContain("auth_error=not_a_member");
    expect(loc.hash).not.toContain("token=");
  });

  it("rejects a tampered/absent state", async () => {
    const req = new Request("https://worker.test/auth/callback?code=c&state=garbage");
    const res = await handleCallback(req, env, { fetch: async () => { throw new Error("should not fetch"); } });
    expect(new URL(res.headers.get("Location")).hash).toContain("auth_error=bad_state");
  });
});
