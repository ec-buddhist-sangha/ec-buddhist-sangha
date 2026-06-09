// workers/sangha-worker/src/auth.js
// Orchestrates Google login: redirect to consent, then on callback exchange the
// code, verify Group membership, and issue an 8-hour site JWT in the redirect
// fragment. State is a signed JWT (CSRF protection, no server-side session).
import { buildAuthUrl, exchangeCode, decodeIdToken } from "./google-oauth.js";
import { getGroupRole } from "./groups.js";
import { signJwt, verifyJwt } from "./jwt.js";

const SITE_JWT_TTL_SECONDS = 8 * 60 * 60;
const STATE_TTL_SECONDS = 10 * 60;

export async function handleLogin(request, env) {
  const requestUrl = new URL(request.url);
  const returnTo = requestUrl.searchParams.get("return_to") || env.CORS_ORIGIN;
  const state = await signJwt(
    { kind: "login-state", return_to: returnTo },
    env.JWT_SIGNING_SECRET,
    { expiresInSeconds: STATE_TTL_SECONDS }
  );
  return Response.redirect(buildAuthUrl(env, { state }), 302);
}

export async function handleCallback(request, env, options = {}) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const stateParam = requestUrl.searchParams.get("state");
  if (!code || !stateParam) return errorRedirect(env, "missing_code");

  const state = await verifyJwt(stateParam, env.JWT_SIGNING_SECRET);
  if (!state || state.kind !== "login-state") return errorRedirect(env, "bad_state");

  let email = "";
  let name = "";
  try {
    const tokens = await exchangeCode(env, code, options);
    const claims = decodeIdToken(tokens.id_token);
    email = (claims.email || "").toLowerCase();
    name = claims.name || email;
  } catch (error) {
    return errorRedirect(env, "google_error");
  }
  if (!email) return errorRedirect(env, "no_email");

  let role;
  try {
    role = await getGroupRole(env, email, options);
  } catch (error) {
    return errorRedirect(env, "group_check_failed");
  }
  if (!role) return errorRedirect(env, "not_a_member");

  const siteJwt = await signJwt(
    { sub: email, name, role },
    env.JWT_SIGNING_SECRET,
    { expiresInSeconds: SITE_JWT_TTL_SECONDS }
  );
  const target = new URL(state.return_to || env.CORS_ORIGIN);
  target.hash = "token=" + encodeURIComponent(siteJwt);
  return Response.redirect(target.toString(), 302);
}

function errorRedirect(env, reason) {
  const target = new URL(env.CORS_ORIGIN);
  target.hash = "auth_error=" + encodeURIComponent(reason);
  return Response.redirect(target.toString(), 302);
}
