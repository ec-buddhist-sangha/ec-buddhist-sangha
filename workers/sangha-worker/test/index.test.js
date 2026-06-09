import { describe, it, expect } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "../src/index.js";

async function call(path, init) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request("https://worker.test" + path, init), env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
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
});
