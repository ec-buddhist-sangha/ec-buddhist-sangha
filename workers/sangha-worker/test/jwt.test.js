import { describe, it, expect } from "vitest";
import { signJwt, verifyJwt } from "../src/jwt.js";

const SECRET = "unit-test-secret";

describe("jwt", () => {
  it("round-trips claims and adds iat/exp", async () => {
    const token = await signJwt({ sub: "a@b.com", role: "member" }, SECRET, { expiresInSeconds: 3600, now: 1000 });
    const claims = await verifyJwt(token, SECRET, { now: 1000 });
    expect(claims.sub).toBe("a@b.com");
    expect(claims.role).toBe("member");
    expect(claims.iat).toBe(1000);
    expect(claims.exp).toBe(4600);
  });

  it("rejects a tampered payload", async () => {
    const token = await signJwt({ sub: "a@b.com" }, SECRET, { now: 1000 });
    const [h, , s] = token.split(".");
    const forged = h + "." + btoa(JSON.stringify({ sub: "evil@b.com" })).replace(/=+$/, "") + "." + s;
    expect(await verifyJwt(forged, SECRET, { now: 1000 })).toBeNull();
  });

  it("rejects the wrong secret", async () => {
    const token = await signJwt({ sub: "a@b.com" }, SECRET, { now: 1000 });
    expect(await verifyJwt(token, "other-secret", { now: 1000 })).toBeNull();
  });

  it("rejects an expired token", async () => {
    const token = await signJwt({ sub: "a@b.com" }, SECRET, { expiresInSeconds: 60, now: 1000 });
    expect(await verifyJwt(token, SECRET, { now: 2000 })).toBeNull();
  });

  it("rejects malformed input", async () => {
    expect(await verifyJwt("not-a-jwt", SECRET)).toBeNull();
    expect(await verifyJwt(null, SECRET)).toBeNull();
  });
});
