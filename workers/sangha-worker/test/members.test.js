import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { getBootstrapAdmins, resolveRole, getMember } from "../src/members.js";

beforeEach(async () => { await env.DB.prepare("DELETE FROM members").run(); });

describe("getBootstrapAdmins", () => {
  it("parses a comma list into a lowercased Set", () => {
    const set = getBootstrapAdmins({ BOOTSTRAP_ADMINS: "A@x.org, b@x.org ,, " });
    expect([...set].sort()).toEqual(["a@x.org", "b@x.org"]);
  });
});

describe("resolveRole", () => {
  it("returns admin for a BOOTSTRAP_ADMINS email with no row", async () => {
    expect(await resolveRole(env, "boss@eauclairesangha.org")).toBe("admin");
  });
  it("returns the D1 role when a row exists", async () => {
    await env.DB.prepare("INSERT INTO members (email, name, role, request_status) VALUES ('m@x.org','M','member','none')").run();
    expect(await resolveRole(env, "M@x.org")).toBe("member");
  });
  it("defaults a signed-in user with no row to reader", async () => {
    expect(await resolveRole(env, "nobody@x.org")).toBe("reader");
  });
  it("returns null for an empty email", async () => {
    expect(await resolveRole(env, "")).toBeNull();
  });
});

describe("getMember", () => {
  it("returns null when absent and the row when present", async () => {
    expect(await getMember(env, "ghost@x.org")).toBeNull();
    await env.DB.prepare("INSERT INTO members (email, name, role, request_status) VALUES ('a@x.org','A','reader','none')").run();
    expect((await getMember(env, "A@x.org")).name).toBe("A");
  });
});
