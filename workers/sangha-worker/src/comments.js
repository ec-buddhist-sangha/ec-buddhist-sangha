// workers/sangha-worker/src/comments.js
// Lets a Google-signed-in member comment without a second login: mint a
// Remark42-compatible JWT (signed with the shared Remark42 SECRET) and forward
// the comment to Remark42's REST API. REMARK42_JWT_SECRET must equal Remark42's SECRET.
// NOTE: the exact claim shape is verified by the Remark42 spike (Plan 04 Task 5)
// before this is wired into the UI; adjust here to match what the live server accepts.
import { signJwt } from "./jwt.js";
import { jsonResponse } from "./middleware.js";

export function buildRemarkClaims(user, env, nowSeconds) {
  const siteId = env.REMARK42_SITE_ID || "ec-buddhist-sangha";
  const id = "google_" + user.sub;
  return {
    user: { name: user.name, id: id, picture: "", admin: user.role === "admin", site_id: siteId },
    iss: "remark42",
    aud: siteId,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
    jti: id + "-" + nowSeconds
  };
}

export async function handlePostComment(request, env, options = {}) {
  const fetchImpl = options.fetch || fetch;
  let body;
  try { body = await request.json(); } catch (error) { return jsonResponse(env, { error: "bad_json" }, 400); }
  if (!body || !body.text || !body.url) return jsonResponse(env, { error: "bad_request" }, 400);

  const now = options.now != null ? options.now : Math.floor(Date.now() / 1000);
  const remarkToken = await signJwt(buildRemarkClaims(request.user, env, now), env.REMARK42_JWT_SECRET, { now });

  const url = (env.REMARK42_URL || "").replace(/\/+$/, "") + "/api/v1/comment";
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-JWT": remarkToken },
    body: JSON.stringify({
      text: body.text,
      locator: { site: env.REMARK42_SITE_ID || "ec-buddhist-sangha", url: body.url },
      pid: body.pid || ""
    })
  });
  if (!res.ok) return jsonResponse(env, { error: "remark_error", status: res.status }, 502);
  return jsonResponse(env, await res.json(), 201);
}
