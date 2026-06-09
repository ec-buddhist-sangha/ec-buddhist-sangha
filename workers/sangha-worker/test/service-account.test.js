import { describe, it, expect, beforeEach } from "vitest";
import { buildAssertionInput, getAccessToken, __resetTokenCacheForTests } from "../src/service-account.js";

// Generate a throwaway RSA key and export it as a PKCS8 PEM so the test can
// drive the real RS256 signing path without a checked-in private key.
async function makeServiceAccount() {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  );
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(pkcs8)));
  const pem = "-----BEGIN PRIVATE KEY-----\n" + b64.match(/.{1,64}/g).join("\n") + "\n-----END PRIVATE KEY-----\n";
  return {
    client_email: "svc@project.iam.gserviceaccount.com",
    private_key: pem,
    token_uri: "https://oauth2.googleapis.com/token"
  };
}

beforeEach(() => __resetTokenCacheForTests());

describe("service-account", () => {
  it("builds an assertion with the delegated subject and directory scopes", async () => {
    const sa = await makeServiceAccount();
    const { claims } = buildAssertionInput(sa, "admin@eauclairesangha.org", 1000);
    expect(claims.iss).toBe(sa.client_email);
    expect(claims.sub).toBe("admin@eauclairesangha.org");
    expect(claims.aud).toBe("https://oauth2.googleapis.com/token");
    expect(claims.scope).toContain("admin.directory.group.member.readonly");
    expect(claims.exp).toBe(4600);
  });

  it("exchanges the assertion for an access token and caches it", async () => {
    const sa = await makeServiceAccount();
    const env = { GOOGLE_SERVICE_ACCOUNT_KEY: JSON.stringify(sa), GOOGLE_ADMIN_EMAIL: "admin@eauclairesangha.org" };
    let calls = 0;
    const fetchImpl = async (url, init) => {
      calls++;
      expect(url).toBe("https://oauth2.googleapis.com/token");
      const body = new URLSearchParams(init.body);
      expect(body.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
      expect(body.get("assertion").split(".").length).toBe(3);
      return new Response(JSON.stringify({ access_token: "ya29.test", expires_in: 3600 }), { status: 200 });
    };
    const t1 = await getAccessToken(env, { fetch: fetchImpl, now: 1000 });
    const t2 = await getAccessToken(env, { fetch: fetchImpl, now: 1100 });
    expect(t1).toBe("ya29.test");
    expect(t2).toBe("ya29.test");
    expect(calls).toBe(1); // cached on second call
  });
});
