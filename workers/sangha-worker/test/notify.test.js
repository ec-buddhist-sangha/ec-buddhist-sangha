import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { buildRequestMime, notifyAdminsOfRequest } from "../src/notify.js";

const requester = { name: "Pat", email: "pat@x.org" };

describe("buildRequestMime", () => {
  it("includes the requester and the review link", () => {
    const raw = buildRequestMime(requester, env, "boss@eauclairesangha.org").asRaw();
    expect(raw).toContain("pat@x.org");
    expect(raw).toContain("/account/members");
    expect(raw).toContain("boss@eauclairesangha.org");
  });
});

describe("notifyAdminsOfRequest", () => {
  it("sends one message per bootstrap admin via the injected transport", async () => {
    const calls = [];
    const res = await notifyAdminsOfRequest(env, requester, {
      transport: async (e, from, to, raw) => { calls.push({ from, to }); }
    });
    expect(res.sent).toBe(1); // vitest.config BOOTSTRAP_ADMINS = one address
    expect(calls[0].to).toBe("boss@eauclairesangha.org");
    expect(calls[0].from).toBe("noreply@eauclairesangha.org");
  });

  it("sends nothing when there are no admins configured", async () => {
    const res = await notifyAdminsOfRequest({ ...env, BOOTSTRAP_ADMINS: "" }, requester, {
      transport: async () => { throw new Error("should not send"); }
    });
    expect(res).toEqual({ sent: 0 });
  });
});
