import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { buildRemarkClaims, handlePostComment } from "../src/comments.js";

const user = { sub: "mem@eauclairesangha.org", name: "Mem", role: "member" };

describe("comment proxy", () => {
  it("builds Remark42 claims from the site user", () => {
    const claims = buildRemarkClaims(user, env, 1000);
    expect(claims.user.name).toBe("Mem");
    expect(claims.user.id).toContain("mem@eauclairesangha.org");
    expect(claims.user.admin).toBe(false);
    expect(claims.aud).toBe("ec-buddhist-sangha");
    expect(claims.exp).toBe(1000 + 3600);
  });

  it("forwards the comment to Remark42 with an X-JWT header", async () => {
    let seen;
    const fetchImpl = async (url, init) => {
      seen = { url, init };
      return new Response(JSON.stringify({ id: "c1" }), { status: 201 });
    };
    const req = new Request("https://worker.test/api/comments", {
      method: "POST",
      body: JSON.stringify({ text: "hello", url: "https://eauclairesangha.org/topics/x/" })
    });
    req.user = user;
    const res = await handlePostComment(req, env, { fetch: fetchImpl, now: 1000 });
    expect(res.status).toBe(201);
    expect(seen.url).toBe("https://comments.test/api/v1/comment");
    expect(seen.init.headers["X-JWT"].split(".").length).toBe(3);
    const body = JSON.parse(seen.init.body);
    expect(body.text).toBe("hello");
    expect(body.locator.url).toBe("https://eauclairesangha.org/topics/x/");
  });

  it("400s on a missing text/url", async () => {
    const req = new Request("https://worker.test/api/comments", { method: "POST", body: JSON.stringify({ text: "" }) });
    req.user = user;
    const res = await handlePostComment(req, env, { fetch: async () => new Response("", { status: 201 }) });
    expect(res.status).toBe(400);
  });

  it("502s when Remark42 rejects the comment", async () => {
    const fetchImpl = async () => new Response("nope", { status: 401 });
    const req = new Request("https://worker.test/api/comments", { method: "POST", body: JSON.stringify({ text: "hi", url: "https://eauclairesangha.org/topics/x/" }) });
    req.user = user;
    const res = await handlePostComment(req, env, { fetch: fetchImpl, now: 1000 });
    expect(res.status).toBe(502);
  });

  it("rejects a cross-origin locator url", async () => {
    const req = new Request("https://worker.test/api/comments", { method: "POST", body: JSON.stringify({ text: "hi", url: "https://evil.example/x/" }) });
    req.user = user;
    const res = await handlePostComment(req, env, { fetch: async () => new Response("{}", { status: 201 }), now: 1000 });
    expect(res.status).toBe(400);
  });

  it("rejects an over-long comment", async () => {
    const req = new Request("https://worker.test/api/comments", { method: "POST", body: JSON.stringify({ text: "x".repeat(10001), url: "https://eauclairesangha.org/topics/x/" }) });
    req.user = user;
    const res = await handlePostComment(req, env, { fetch: async () => new Response("{}", { status: 201 }), now: 1000 });
    expect(res.status).toBe(400);
  });
});
