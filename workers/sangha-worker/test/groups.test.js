import { describe, it, expect } from "vitest";
import { roleFromGroupRole, getGroupRole } from "../src/groups.js";

const env = { GOOGLE_GROUP_EMAIL: "sangha@eauclairesangha.org" };

describe("roleFromGroupRole", () => {
  it("maps Google group roles to site roles", () => {
    expect(roleFromGroupRole("OWNER")).toBe("admin");
    expect(roleFromGroupRole("MANAGER")).toBe("admin");
    expect(roleFromGroupRole("MEMBER")).toBe("member");
    expect(roleFromGroupRole("UNKNOWN")).toBeNull();
  });
});

describe("getGroupRole", () => {
  it("returns admin for an OWNER member", async () => {
    const fetchImpl = async (url, init) => {
      expect(url).toContain("/groups/sangha%40eauclairesangha.org/members/owner%40eauclairesangha.org");
      expect(init.headers.Authorization).toBe("Bearer test-token");
      return new Response(JSON.stringify({ role: "OWNER", status: "ACTIVE" }), { status: 200 });
    };
    const role = await getGroupRole(env, "owner@eauclairesangha.org", { fetch: fetchImpl, accessToken: "test-token" });
    expect(role).toBe("admin");
  });

  it("returns null when the user is not a member (404)", async () => {
    const fetchImpl = async () => new Response("{}", { status: 404 });
    const role = await getGroupRole(env, "stranger@example.com", { fetch: fetchImpl, accessToken: "t" });
    expect(role).toBeNull();
  });

  it("treats a suspended membership as not-a-member", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ role: "MEMBER", status: "SUSPENDED" }), { status: 200 });
    const role = await getGroupRole(env, "x@eauclairesangha.org", { fetch: fetchImpl, accessToken: "t" });
    expect(role).toBeNull();
  });

  it("throws on an unexpected API error", async () => {
    const fetchImpl = async () => new Response("nope", { status: 500 });
    await expect(getGroupRole(env, "x@eauclairesangha.org", { fetch: fetchImpl, accessToken: "t" })).rejects.toThrow();
  });
});
