// workers/sangha-worker/src/comments.js
// Native D1-backed comments (replaces the Remark42 proxy). Single-level
// threading via parent_id; only 'published' rows are ever returned. Bodies are
// plain text — the client escapes them on render (no HTML is stored or trusted).
import { jsonResponse, authenticate } from "./middleware.js";

const MAX_BODY = 10000;

async function readJson(request) {
  try { return await request.json(); } catch (error) { return null; }
}

export function nestComments(rows) {
  var byId = {};
  var roots = [];
  (rows || []).forEach(function (r) { r.replies = []; byId[r.id] = r; });
  (rows || []).forEach(function (r) {
    if (r.parent_id == null) roots.push(r);
    else if (byId[r.parent_id]) byId[r.parent_id].replies.push(r);
    // else: parent not in the published set -> orphaned reply, dropped
  });
  return roots;
}

export async function handleGetComments(request, env) {
  const thread = new URL(request.url).searchParams.get("thread");
  if (!thread) return jsonResponse(env, { error: "bad_request" }, 400);
  const viewer = await authenticate(request, env); // soft auth: may be null
  const viewerEmail = viewer ? String(viewer.sub || "").toLowerCase() : null;
  const { results } = await env.DB
    .prepare("SELECT id, parent_id, author_email, author_name, body, created_at, updated_at FROM comments WHERE thread = ? AND status = 'published' ORDER BY created_at")
    .bind(thread).all();
  const rows = (results || []).map(function (r) {
    return {
      id: r.id, parent_id: r.parent_id, author_name: r.author_name, body: r.body,
      created_at: r.created_at, updated_at: r.updated_at,
      own: viewerEmail != null && String(r.author_email || "").toLowerCase() === viewerEmail
    };
  });
  return jsonResponse(env, { comments: nestComments(rows) });
}

export async function handlePostComment(request, env, options = {}) {
  const body = await readJson(request);
  if (!body || !body.thread || typeof body.body !== "string" || !body.body.trim()) {
    return jsonResponse(env, { error: "bad_request" }, 400);
  }
  if (body.body.length > MAX_BODY) return jsonResponse(env, { error: "text_too_long" }, 400);
  let parentId = null;
  if (body.parent_id != null && body.parent_id !== "") {
    parentId = Number(body.parent_id);
    const parent = await env.DB.prepare("SELECT thread, parent_id FROM comments WHERE id = ? AND status = 'published'").bind(parentId).first();
    if (!parent || parent.parent_id != null || parent.thread !== body.thread) {
      return jsonResponse(env, { error: "bad_parent" }, 400);
    }
  }
  const nowIso = options.nowIso || new Date().toISOString();
  const res = await env.DB
    .prepare("INSERT INTO comments (thread, parent_id, author_email, author_name, body, status, created_at) VALUES (?, ?, ?, ?, ?, 'published', ?)")
    .bind(body.thread, parentId, String(request.user.sub).toLowerCase(), request.user.name, body.body, nowIso)
    .run();
  // Surface forum activity: bump the parent topic's last_active_at.
  if (body.thread.startsWith("topic:")) {
    await env.DB.prepare("UPDATE topics SET last_active_at = ? WHERE slug = ?")
      .bind(nowIso, body.thread.slice("topic:".length)).run();
  }
  return jsonResponse(env, { id: res.meta.last_row_id }, 201);
}

async function ownerOrAdmin(request, env, id) {
  const row = await env.DB.prepare("SELECT author_email FROM comments WHERE id = ? AND status != 'deleted'").bind(id).first();
  if (!row) return { notFound: true };
  const isAdmin = request.user.role === "admin";
  const isOwner = String(row.author_email || "").toLowerCase() === String(request.user.sub).toLowerCase();
  return { ok: isAdmin || isOwner, isAdmin: isAdmin };
}

export async function handlePatchComment(request, env, options = {}) {
  const body = await readJson(request);
  const id = body && body.id != null ? Number(body.id) : 0;
  if (!id || !body || typeof body.body !== "string" || !body.body.trim()) return jsonResponse(env, { error: "bad_request" }, 400);
  if (body.body.length > MAX_BODY) return jsonResponse(env, { error: "text_too_long" }, 400);
  const perm = await ownerOrAdmin(request, env, id);
  if (perm.notFound) return jsonResponse(env, { error: "not_found" }, 404);
  if (!perm.ok) return jsonResponse(env, { error: "forbidden" }, 403);
  const nowIso = options.nowIso || new Date().toISOString();
  await env.DB.prepare("UPDATE comments SET body = ?, updated_at = ? WHERE id = ?").bind(body.body, nowIso, id).run();
  return jsonResponse(env, { ok: true });
}

export async function handleDeleteComment(request, env, options = {}) {
  const body = await readJson(request);
  const id = body && body.id != null ? Number(body.id) : 0;
  if (!id) return jsonResponse(env, { error: "bad_request" }, 400);
  const perm = await ownerOrAdmin(request, env, id);
  if (perm.notFound) return jsonResponse(env, { error: "not_found" }, 404);
  if (!perm.ok) return jsonResponse(env, { error: "forbidden" }, 403);
  const nowIso = options.nowIso || new Date().toISOString();
  const status = perm.isAdmin ? "hidden" : "deleted";
  await env.DB.prepare("UPDATE comments SET status = ?, updated_at = ? WHERE id = ?").bind(status, nowIso, id).run();
  return jsonResponse(env, { ok: true });
}
