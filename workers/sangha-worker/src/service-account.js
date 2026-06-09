// workers/sangha-worker/src/service-account.js
// Mints short-lived Google API access tokens from a service-account key using
// the OAuth 2.0 JWT-bearer flow (RS256), impersonating GOOGLE_ADMIN_EMAIL via
// domain-wide delegation. Used by groups.js to call the Admin SDK.

const DIRECTORY_SCOPES = [
  "https://www.googleapis.com/auth/admin.directory.group.member.readonly",
  "https://www.googleapis.com/auth/admin.directory.group.readonly"
].join(" ");

const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";

// Cache survives across requests on a warm isolate to avoid re-minting per request.
let cachedToken = null; // { accessToken, expiresAt }

function base64UrlBytes(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlString(str) {
  return base64UrlBytes(new TextEncoder().encode(str));
}

function pemToArrayBuffer(pem) {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export function buildAssertionInput(serviceAccount, subject, nowSeconds) {
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: serviceAccount.client_email,
    sub: subject,
    scope: DIRECTORY_SCOPES,
    aud: serviceAccount.token_uri || DEFAULT_TOKEN_URI,
    iat: nowSeconds,
    exp: nowSeconds + 3600
  };
  const signingInput =
    base64UrlString(JSON.stringify(header)) + "." + base64UrlString(JSON.stringify(claims));
  return { signingInput, claims };
}

async function signRs256(serviceAccount, signingInput) {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(serviceAccount.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput)
  );
  return base64UrlBytes(signature);
}

export async function getAccessToken(env, options = {}) {
  const nowSeconds = options.now != null ? options.now : Math.floor(Date.now() / 1000);
  if (!options.forceRefresh && cachedToken && cachedToken.expiresAt - 60 > nowSeconds) {
    return cachedToken.accessToken;
  }
  const serviceAccount = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const { signingInput } = buildAssertionInput(serviceAccount, env.GOOGLE_ADMIN_EMAIL, nowSeconds);
  const assertion = signingInput + "." + await signRs256(serviceAccount, signingInput);
  const tokenUri = serviceAccount.token_uri || DEFAULT_TOKEN_URI;
  const fetchImpl = options.fetch || fetch;
  const response = await fetchImpl(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  if (!response.ok) throw new Error("Google token exchange failed: " + response.status);
  const data = await response.json();
  cachedToken = { accessToken: data.access_token, expiresAt: nowSeconds + (data.expires_in || 3600) };
  return cachedToken.accessToken;
}

export function __resetTokenCacheForTests() {
  cachedToken = null;
}
