import { describe, it, expect } from "vitest";
import { buildAuthUrl, exchangeCode, decodeIdToken } from "../src/google-oauth.js";

const env = {
  GOOGLE_CLIENT_ID: "client-123",
  GOOGLE_CLIENT_SECRET: "secret-abc",
  GOOGLE_REDIRECT_URI: "https://worker.test/auth/callback"
};

function fakeIdToken(payload) {
  const enc = (o) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return enc({ alg: "RS256" }) + "." + enc(payload) + ".sig";
}

describe("google-oauth", () => {
  it("builds a consent URL with the expected params", () => {
    const url = new URL(buildAuthUrl(env, { state: "state-xyz" }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("redirect_uri")).toBe("https://worker.test/auth/callback");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("state")).toBe("state-xyz");
  });

  it("exchanges a code for tokens", async () => {
    const fetchImpl = async (url, init) => {
      expect(url).toBe("https://oauth2.googleapis.com/token");
      const body = new URLSearchParams(init.body);
      expect(body.get("code")).toBe("auth-code");
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("client_secret")).toBe("secret-abc");
      return new Response(JSON.stringify({ id_token: "idt", access_token: "at" }), { status: 200 });
    };
    const tokens = await exchangeCode(env, "auth-code", { fetch: fetchImpl });
    expect(tokens.id_token).toBe("idt");
  });

  it("decodes id_token claims", () => {
    const claims = decodeIdToken(fakeIdToken({ email: "User@Example.com", name: "User" }));
    expect(claims.email).toBe("User@Example.com");
    expect(claims.name).toBe("User");
  });
});
