// workers/sangha-worker/src/jwt.js
// Stateless HMAC-SHA256 (HS256) JWTs for site sessions (members + admins).
// Any Worker endpoint verifies with the same JWT_SIGNING_SECRET — no session store.

function base64UrlEncodeBytes(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlEncodeString(str) {
  return base64UrlEncodeBytes(new TextEncoder().encode(str));
}

function base64UrlDecodeToString(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function importHmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export async function signJwt(payload, secret, options = {}) {
  const nowSeconds = options.now != null ? options.now : Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const claims = { iat: nowSeconds, ...payload };
  if (options.expiresInSeconds != null && claims.exp == null) {
    claims.exp = nowSeconds + options.expiresInSeconds;
  }
  const signingInput =
    base64UrlEncodeString(JSON.stringify(header)) + "." +
    base64UrlEncodeString(JSON.stringify(claims));
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput));
  return signingInput + "." + base64UrlEncodeBytes(signature);
}

export async function verifyJwt(token, secret, options = {}) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const signingInput = parts[0] + "." + parts[1];
  const key = await importHmacKey(secret);
  let expected;
  try {
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput));
    expected = base64UrlEncodeBytes(sig);
  } catch (error) {
    return null;
  }
  if (!timingSafeEqual(expected, parts[2])) return null;
  let claims;
  try {
    claims = JSON.parse(base64UrlDecodeToString(parts[1]));
  } catch (error) {
    return null;
  }
  const nowSeconds = options.now != null ? options.now : Math.floor(Date.now() / 1000);
  if (claims.exp != null && nowSeconds >= claims.exp) return null;
  return claims;
}
