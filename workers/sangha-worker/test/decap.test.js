import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { handleDecapAuth, handleDecapCallback } from "../src/decap.js";

describe("decap github oauth", () => {
  it("redirects to GitHub authorize with the decap callback URI", async () => {
    const req = new Request("https://worker.test/decap/auth?provider=github");
    const res = await handleDecapAuth(req, env);
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("Location"));
    expect(loc.origin + loc.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(loc.searchParams.get("client_id")).toBe("gh-client-id");
    expect(loc.searchParams.get("redirect_uri")).toBe("https://worker.test/decap/callback");
    expect(loc.searchParams.get("scope")).toBe("repo,read:org");
    expect(loc.searchParams.get("state")).toBeTruthy();
  });

  it("returns 400 when no code is present on callback", async () => {
    const res = await handleDecapCallback(new Request("https://worker.test/decap/callback"), env);
    expect(res.status).toBe(400);
  });

  it("exchanges the code and returns the Decap postMessage HTML", async () => {
    const fetchImpl = async (url, init) => {
      expect(url).toBe("https://github.com/login/oauth/access_token");
      const body = JSON.parse(init.body);
      expect(body.code).toBe("gh-code");
      expect(body.client_secret).toBe("gh-client-secret");
      expect(body.redirect_uri).toBe("https://worker.test/decap/callback");
      return new Response(JSON.stringify({ access_token: "gho_token123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    };
    const req = new Request("https://worker.test/decap/callback?code=gh-code&state=s");
    const res = await handleDecapCallback(req, env, { fetch: fetchImpl });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("authorization:github:success:");
    expect(html).toContain("gho_token123");
  });

  it("surfaces a GitHub error response", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ error: "bad_verification_code", error_description: "expired" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    const req = new Request("https://worker.test/decap/callback?code=expired&state=s");
    const res = await handleDecapCallback(req, env, { fetch: fetchImpl });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("expired");
  });
});
