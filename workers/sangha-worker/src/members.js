// workers/sangha-worker/src/members.js
// D1-backed membership store. Single source of truth for a user's role and any
// pending upgrade request. Role is resolved LIVE (config allowlist -> D1 -> reader)
// so approvals and role changes take effect on the user's next request.

export const VALID_ROLES = ["reader", "member", "admin"];

export function getBootstrapAdmins(env) {
  return new Set(
    String(env.BOOTSTRAP_ADMINS || "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

export async function resolveRole(env, email) {
  const lc = String(email || "").toLowerCase();
  if (!lc) return null;
  if (getBootstrapAdmins(env).has(lc)) return "admin";
  const row = await env.DB.prepare("SELECT role FROM members WHERE email = ?").bind(lc).first();
  if (row && VALID_ROLES.includes(row.role)) return row.role;
  return "reader";
}

export async function getMember(env, email) {
  const lc = String(email || "").toLowerCase();
  return env.DB
    .prepare("SELECT email, name, role, request_status, created_at, updated_at FROM members WHERE email = ?")
    .bind(lc)
    .first();
}
