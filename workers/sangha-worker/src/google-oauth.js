// workers/sangha-worker/src/google-oauth.js
// Google OAuth 2.0 user login: build the consent URL, exchange the code for
// tokens, and read the id_token claims.

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export function buildAuthUrl(env, options = {}) {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", env.GOOGLE_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("access_type", "online");
  url.searchParams.set("prompt", "select_account");
  if (options.state) url.searchParams.set("state", options.state);
  return url.toString();
}

export async function exchangeCode(env, code, options = {}) {
  const fetchImpl = options.fetch || fetch;
  const response = await fetchImpl(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_REDIRECT_URI,
      grant_type: "authorization_code"
    })
  });
  if (!response.ok) throw new Error("Google code exchange failed: " + response.status);
  return response.json();
}

// Decodes (does not signature-verify) the id_token payload. Safe ONLY for tokens
// obtained via exchangeCode (returned directly from Google's token endpoint over
// TLS, authenticated with our client_secret). NEVER call this on a client-supplied
// token — doing so would be an auth bypass.
export function decodeIdToken(idToken) {
  const parts = String(idToken || "").split(".");
  if (parts.length !== 3) throw new Error("Malformed id_token");
  const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(bytes));
}
