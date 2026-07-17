// workers/sangha-worker/src/topics.js
// Member-authored forum threads in D1. Public reads; creation gated to
// members/admins; edit/delete gated to the author or an admin. A topic's
// comment thread lives in the comments table under thread = 'topic:' || slug.
// Bodies are stored as text and rendered/escaped client-side.
import { jsonResponse } from "./middleware.js";
import { uniqueSlug } from "./slug.js";

const MAX_TITLE = 300;
const MAX_BODY = 50000;

async function readJson(request) {
  try { return await request.json(); } catch (error) { return null; }
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 20);
}

function rowToTopic(r) {
  let tags = [];
  try { tags = JSON.parse(r.tags || "[]"); } catch (error) { tags = []; }
  return {
    id: r.id, slug: r.slug, title: r.title, body: r.body || "", tags,
    author_name: r.author_name,
    reply_count: r.reply_count != null ? Number(r.reply_count) : 0,
    created_at: r.created_at, updated_at: r.updated_at, last_active_at: r.last_active_at
  };
}

// reply_count counts published comments on the topic's thread.
const REPLY_COUNT_SQL =
  "(SELECT COUNT(*) FROM comments c WHERE c.thread = 'topic:' || t.slug AND c.status = 'published') AS reply_count";

export async function handleListTopics(request, env) {
  const { results } = await env.DB.prepare(
    `SELECT t.id, t.slug, t.title, t.body, t.tags, t.author_name,
            t.created_at, t.updated_at, t.last_active_at, ${REPLY_COUNT_SQL}
     FROM topics t WHERE t.status = 'published' ORDER BY t.last_active_at DESC`
  ).all();
  return jsonResponse(env, { topics: (results || []).map(rowToTopic) });
}

export async function handleGetTopic(request, env) {
  const slug = request.params && request.params.slug;
  if (!slug) return jsonResponse(env, { error: "bad_request" }, 400);
  const row = await env.DB.prepare(
    `SELECT t.id, t.slug, t.title, t.body, t.tags, t.author_name,
            t.created_at, t.updated_at, t.last_active_at, ${REPLY_COUNT_SQL}
     FROM topics t WHERE t.slug = ? AND t.status = 'published'`
  ).bind(slug).first();
  if (!row) return jsonResponse(env, { error: "not_found" }, 404);
  return jsonResponse(env, { topic: rowToTopic(row) });
}

export async function handleCreateTopic(request, env, options = {}) {
  const body = await readJson(request);
  if (!body || typeof body.title !== "string" || !body.title.trim() || typeof body.body !== "string" || !body.body.trim()) {
    return jsonResponse(env, { error: "bad_request" }, 400);
  }
  if (body.title.length > MAX_TITLE || body.body.length > MAX_BODY) {
    return jsonResponse(env, { error: "text_too_long" }, 400);
  }
  const nowIso = options.nowIso || new Date().toISOString();
  const slug = await uniqueSlug(env, "topics", body.title);
  const res = await env.DB.prepare(
    `INSERT INTO topics (slug, title, body, tags, author_email, author_name, status, created_at, last_active_at)
     VALUES (?, ?, ?, ?, ?, ?, 'published', ?, ?)`
  ).bind(
    slug, body.title.trim(), body.body, JSON.stringify(normalizeTags(body.tags)),
    String(request.user.sub).toLowerCase(), request.user.name, nowIso, nowIso
  ).run();
  return jsonResponse(env, { id: res.meta.last_row_id, slug }, 201);
}

// Author (by email) or any admin may edit/delete.
async function ownerOrAdmin(request, env, id) {
  const row = await env.DB.prepare("SELECT author_email FROM topics WHERE id = ? AND status != 'deleted'").bind(id).first();
  if (!row) return { notFound: true };
  const isAdmin = request.user.role === "admin";
  const isOwner = String(row.author_email || "").toLowerCase() === String(request.user.sub).toLowerCase();
  return { ok: isAdmin || isOwner, isAdmin };
}

export async function handlePatchTopic(request, env, options = {}) {
  const body = await readJson(request);
  const id = body && body.id != null ? Number(body.id) : 0;
  if (!id || !body) return jsonResponse(env, { error: "bad_request" }, 400);
  if ((body.title || "").length > MAX_TITLE || (body.body || "").length > MAX_BODY) {
    return jsonResponse(env, { error: "text_too_long" }, 400);
  }
  const perm = await ownerOrAdmin(request, env, id);
  if (perm.notFound) return jsonResponse(env, { error: "not_found" }, 404);
  if (!perm.ok) return jsonResponse(env, { error: "forbidden" }, 403);
  const nowIso = options.nowIso || new Date().toISOString();
  await env.DB.prepare(
    `UPDATE topics SET
       title = COALESCE(?, title),
       body = COALESCE(?, body),
       tags = COALESCE(?, tags),
       updated_at = ?
     WHERE id = ?`
  ).bind(
    body.title != null ? String(body.title).trim() : null,
    body.body != null ? body.body : null,
    body.tags != null ? JSON.stringify(normalizeTags(body.tags)) : null,
    nowIso, id
  ).run();
  return jsonResponse(env, { ok: true });
}

export async function handleDeleteTopic(request, env, options = {}) {
  const body = await readJson(request);
  const id = body && body.id != null ? Number(body.id) : 0;
  if (!id) return jsonResponse(env, { error: "bad_request" }, 400);
  const perm = await ownerOrAdmin(request, env, id);
  if (perm.notFound) return jsonResponse(env, { error: "not_found" }, 404);
  if (!perm.ok) return jsonResponse(env, { error: "forbidden" }, 403);
  const nowIso = options.nowIso || new Date().toISOString();
  const status = perm.isAdmin ? "hidden" : "deleted";
  await env.DB.prepare("UPDATE topics SET status = ?, updated_at = ? WHERE id = ?").bind(status, nowIso, id).run();
  return jsonResponse(env, { ok: true });
}
