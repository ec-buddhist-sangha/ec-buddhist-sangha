// workers/sangha-worker/src/access.js
// HTTP handlers for identity (/api/me), self-service access requests, and admin
// membership management. Role gating is enforced by requireRole in the router;
// these handlers assume request.user = { sub, name, role } is set.
import { jsonResponse } from "./middleware.js";
import {
  getMember, requestAccess, listMembers, listPending,
  approveMember, denyMember, setRole
} from "./members.js";
import { notifyAdminsOfRequest } from "./notify.js";

async function readJson(request) {
  try { return await request.json(); } catch (error) { return null; }
}

export async function handleMe(request, env) {
  const email = request.user.sub;
  const row = await getMember(env, email);
  return jsonResponse(env, {
    sub: email,
    name: request.user.name,
    role: request.user.role,
    request_status: row ? row.request_status : "none"
  });
}

export async function handleAccessRequest(request, env, options = {}) {
  if (request.user.role === "member" || request.user.role === "admin") {
    return jsonResponse(env, { status: "already_member" });
  }
  const nowIso = options.nowIso || new Date().toISOString();
  const result = await requestAccess(env, request.user.sub, nowIso);
  if (result.created) {
    try {
      await notifyAdminsOfRequest(env, { name: request.user.name, email: request.user.sub }, options.notify || {});
    } catch (error) {
      console.error("access-request notify failed:", error && error.message);
    }
  }
  return jsonResponse(env, { status: result.status });
}

export async function handleListMembers(request, env) {
  const [members, pending] = await Promise.all([listMembers(env), listPending(env)]);
  return jsonResponse(env, { members, pending });
}

export async function handleApprove(request, env, options = {}) {
  const body = await readJson(request);
  if (!body || !body.email) return jsonResponse(env, { error: "bad_request" }, 400);
  const ok = await approveMember(env, body.email, options.nowIso || new Date().toISOString());
  if (!ok) return jsonResponse(env, { error: "not_found" }, 404);
  return jsonResponse(env, { ok: true });
}

export async function handleDeny(request, env, options = {}) {
  const body = await readJson(request);
  if (!body || !body.email) return jsonResponse(env, { error: "bad_request" }, 400);
  const ok = await denyMember(env, body.email, options.nowIso || new Date().toISOString());
  if (!ok) return jsonResponse(env, { error: "not_found" }, 404);
  return jsonResponse(env, { ok: true });
}

export async function handleSetRole(request, env, options = {}) {
  const body = await readJson(request);
  if (!body || !body.email || !body.role) return jsonResponse(env, { error: "bad_request" }, 400);
  const result = await setRole(env, body.email, body.role, options.nowIso || new Date().toISOString());
  if (result.error) return jsonResponse(env, { error: result.error }, 400);
  if (!result.ok) return jsonResponse(env, { error: "not_found" }, 404);
  return jsonResponse(env, { ok: true });
}
