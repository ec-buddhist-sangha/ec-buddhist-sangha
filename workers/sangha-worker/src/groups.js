// workers/sangha-worker/src/groups.js
// Resolves a user's role from their membership in the Sangha Google Group,
// via the Admin SDK Directory API members.get endpoint.
import { getAccessToken } from "./service-account.js";

export function roleFromGroupRole(groupRole) {
  if (groupRole === "OWNER" || groupRole === "MANAGER") return "admin";
  if (groupRole === "MEMBER") return "member";
  return null;
}

export async function getGroupRole(env, email, options = {}) {
  const fetchImpl = options.fetch || fetch;
  const accessToken = options.accessToken || await getAccessToken(env, options);
  const url =
    "https://admin.googleapis.com/admin/directory/v1/groups/" +
    encodeURIComponent(env.GOOGLE_GROUP_EMAIL) +
    "/members/" + encodeURIComponent(email);
  const response = await fetchImpl(url, { headers: { Authorization: "Bearer " + accessToken } });
  if (response.status === 404) return null; // not a member
  if (!response.ok) throw new Error("Admin SDK members.get failed: " + response.status);
  const member = await response.json();
  if (member.status && member.status !== "ACTIVE") return null;
  return roleFromGroupRole(member.role);
}
