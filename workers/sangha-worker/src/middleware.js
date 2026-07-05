// workers/sangha-worker/src/middleware.js
// Shared HTTP concerns: CORS, JSON responses, JWT authentication, role gating.
import { verifyJwt } from "./jwt.js";
import { resolveRole } from "./members.js";

export function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.CORS_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

export function handlePreflight(request, env) {
  return new Response(null, { status: 204, headers: corsHeaders(env) });
}

export function jsonResponse(env, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(env) }
  });
}

// Returns verified JWT claims, or null. Reads the Authorization: Bearer header.
export async function authenticate(request, env) {
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  return verifyJwt(match[1], env.JWT_SIGNING_SECRET);
}

// Wraps a handler so it only runs for a user whose LIVE role (config -> D1 ->
// reader) is in `roles`. The JWT carries identity only; role is never trusted
// from the token.
export function requireRole(roles, handler) {
  return async (request, env, ctx) => {
    const user = await authenticate(request, env);
    if (!user) return jsonResponse(env, { error: "unauthorized" }, 401);
    const role = await resolveRole(env, user.sub);
    if (!roles.includes(role)) return jsonResponse(env, { error: "forbidden" }, 403);
    request.user = { sub: user.sub, name: user.name, role };
    return handler(request, env, ctx);
  };
}

export function errorHandler(error, env) {
  return jsonResponse(
    env,
    { error: "internal_error", message: String(error && error.message ? error.message : error) },
    500
  );
}
