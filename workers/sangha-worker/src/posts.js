// workers/sangha-worker/src/posts.js
// Admin-authored community-feed content (announcements + events) in D1.
// Public reads; writes gated to admins via requireRole in index.js. Bodies are
// stored as text and rendered/escaped client-side (no HTML is trusted).
import { jsonResponse } from "./middleware.js";
import { uniqueSlug } from "./slug.js";

const KINDS = ["announcement", "event"];
const MAX_TITLE = 300;
const MAX_SUMMARY = 500;
const MAX_BODY = 50000;

async function readJson(request) {
  try { return await request.json(); } catch (error) { return null; }
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 20);
}

function rowToPost(r) {
  let tags = [];
  try { tags = JSON.parse(r.tags || "[]"); } catch (error) { tags = []; }
  return {
    id: r.id, kind: r.kind, slug: r.slug, title: r.title,
    summary: r.summary || "", body: r.body || "", tags,
    location: r.location || "", start_at: r.start_at || "", end_at: r.end_at || "",
    published_at: r.published_at, created_at: r.created_at, updated_at: r.updated_at
  };
}

const SELECT_COLS =
  "id, kind, slug, title, summary, body, tags, location, start_at, end_at, published_at, created_at, updated_at";

export async function handleListPosts(request, env) {
  const kind = new URL(request.url).searchParams.get("kind");
  let stmt;
  if (kind && KINDS.includes(kind)) {
    stmt = env.DB.prepare(
      `SELECT ${SELECT_COLS} FROM posts WHERE status = 'published' AND kind = ? ORDER BY published_at DESC`
    ).bind(kind);
  } else {
    stmt = env.DB.prepare(
      `SELECT ${SELECT_COLS} FROM posts WHERE status = 'published' ORDER BY published_at DESC`
    );
  }
  const { results } = await stmt.all();
  return jsonResponse(env, { posts: (results || []).map(rowToPost) });
}

export async function handleGetPost(request, env) {
  const slug = request.params && request.params.slug;
  if (!slug) return jsonResponse(env, { error: "bad_request" }, 400);
  const row = await env.DB
    .prepare(`SELECT ${SELECT_COLS} FROM posts WHERE slug = ? AND status = 'published'`)
    .bind(slug).first();
  if (!row) return jsonResponse(env, { error: "not_found" }, 404);
  return jsonResponse(env, { post: rowToPost(row) });
}

export async function handleCreatePost(request, env, options = {}) {
  const body = await readJson(request);
  if (!body || !KINDS.includes(body.kind) || typeof body.title !== "string" || !body.title.trim()) {
    return jsonResponse(env, { error: "bad_request" }, 400);
  }
  if (body.title.length > MAX_TITLE || (body.body || "").length > MAX_BODY || (body.summary || "").length > MAX_SUMMARY) {
    return jsonResponse(env, { error: "text_too_long" }, 400);
  }
  const nowIso = options.nowIso || new Date().toISOString();
  const slug = await uniqueSlug(env, "posts", body.slug || body.title);
  const publishedAt = body.published_at || body.start_at || nowIso;
  const res = await env.DB.prepare(
    `INSERT INTO posts (kind, slug, title, summary, body, tags, location, start_at, end_at, published_at, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?)`
  ).bind(
    body.kind, slug, body.title.trim(), body.summary || null, body.body || "",
    JSON.stringify(normalizeTags(body.tags)), body.location || null,
    body.start_at || null, body.end_at || null, publishedAt, nowIso
  ).run();
  return jsonResponse(env, { id: res.meta.last_row_id, slug }, 201);
}

export async function handlePatchPost(request, env, options = {}) {
  const body = await readJson(request);
  const id = body && body.id != null ? Number(body.id) : 0;
  if (!id || !body) return jsonResponse(env, { error: "bad_request" }, 400);
  if ((body.title || "").length > MAX_TITLE || (body.body || "").length > MAX_BODY || (body.summary || "").length > MAX_SUMMARY) {
    return jsonResponse(env, { error: "text_too_long" }, 400);
  }
  const existing = await env.DB.prepare("SELECT id FROM posts WHERE id = ? AND status != 'deleted'").bind(id).first();
  if (!existing) return jsonResponse(env, { error: "not_found" }, 404);
  const nowIso = options.nowIso || new Date().toISOString();
  await env.DB.prepare(
    `UPDATE posts SET
       title = COALESCE(?, title),
       summary = COALESCE(?, summary),
       body = COALESCE(?, body),
       tags = COALESCE(?, tags),
       location = COALESCE(?, location),
       start_at = COALESCE(?, start_at),
       end_at = COALESCE(?, end_at),
       published_at = COALESCE(?, published_at),
       updated_at = ?
     WHERE id = ?`
  ).bind(
    body.title != null ? String(body.title).trim() : null,
    body.summary != null ? body.summary : null,
    body.body != null ? body.body : null,
    body.tags != null ? JSON.stringify(normalizeTags(body.tags)) : null,
    body.location != null ? body.location : null,
    body.start_at != null ? body.start_at : null,
    body.end_at != null ? body.end_at : null,
    body.published_at != null ? body.published_at : null,
    nowIso, id
  ).run();
  return jsonResponse(env, { ok: true });
}

export async function handleDeletePost(request, env, options = {}) {
  const body = await readJson(request);
  const id = body && body.id != null ? Number(body.id) : 0;
  if (!id) return jsonResponse(env, { error: "bad_request" }, 400);
  const existing = await env.DB.prepare("SELECT id FROM posts WHERE id = ? AND status != 'deleted'").bind(id).first();
  if (!existing) return jsonResponse(env, { error: "not_found" }, 404);
  const nowIso = options.nowIso || new Date().toISOString();
  await env.DB.prepare("UPDATE posts SET status = 'deleted', updated_at = ? WHERE id = ?").bind(nowIso, id).run();
  return jsonResponse(env, { ok: true });
}
