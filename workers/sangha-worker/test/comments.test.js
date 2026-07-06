import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { signJwt } from "../src/jwt.js";
import {
  nestComments, handleGetComments, handlePostComment, handlePatchComment, handleDeleteComment
} from "../src/comments.js";

const NOW = "2026-07-05T12:00:00.000Z";
beforeEach(async () => { await env.DB.prepare("DELETE FROM comments").run(); });

function post(user, body) {
  const r = new Request("https://worker.test/api/comments", { method: "POST", body: JSON.stringify(body) });
  r.user = user;
  return r;
}
async function getFor(thread, authHeader) {
  const init = authHeader ? { headers: { Authorization: authHeader } } : {};
  return handleGetComments(new Request("https://worker.test/api/comments?thread=" + encodeURIComponent(thread), init), env);
}
async function idToken(sub, name) {
  return "Bearer " + await signJwt({ sub, name }, env.JWT_SIGNING_SECRET, { expiresInSeconds: 600 });
}
const member = { sub: "m@x.org", name: "Mem", role: "member" };
const admin = { sub: "a@x.org", name: "Adm", role: "admin" };

describe("nestComments", () => {
  it("attaches replies to their top-level parent", () => {
    const roots = nestComments([
      { id: 1, parent_id: null }, { id: 2, parent_id: 1 }, { id: 3, parent_id: null }
    ]);
    expect(roots.map((r) => r.id)).toEqual([1, 3]);
    expect(roots[0].replies.map((r) => r.id)).toEqual([2]);
  });
});

describe("post + get", () => {
  it("member posts and anyone reads published comments (no email leak)", async () => {
    const created = await handlePostComment(post(member, { thread: "/topics/a/", body: "hello" }), env, { nowIso: NOW });
    expect(created.status).toBe(201);
    const res = await getFor("/topics/a/");
    const body = await res.json();
    expect(body.comments.length).toBe(1);
    expect(body.comments[0].body).toBe("hello");
    expect(body.comments[0].author_name).toBe("Mem");
    expect(body.comments[0].author_email).toBeUndefined();
    expect(body.comments[0].own).toBe(false); // anonymous reader
  });

  it("marks the caller's own comments when authenticated", async () => {
    await handlePostComment(post(member, { thread: "/t/", body: "mine" }), env, { nowIso: NOW });
    const res = await getFor("/t/", await idToken("m@x.org", "Mem"));
    expect((await res.json()).comments[0].own).toBe(true);
  });

  it("rejects an over-length body", async () => {
    const big = "x".repeat(10001);
    const res = await handlePostComment(post(member, { thread: "/t/", body: big }), env, { nowIso: NOW });
    expect(res.status).toBe(400);
  });

  it("rejects a reply to a non-existent or cross-thread parent", async () => {
    const c = await handlePostComment(post(member, { thread: "/t/", body: "root" }), env, { nowIso: NOW });
    const rootId = (await c.json()).id;
    const bad = await handlePostComment(post(member, { thread: "/other/", parent_id: rootId, body: "x" }), env, { nowIso: NOW });
    expect(bad.status).toBe(400);
    const missing = await handlePostComment(post(member, { thread: "/t/", parent_id: 9999, body: "x" }), env, { nowIso: NOW });
    expect(missing.status).toBe(400);
  });

  it("nests a valid reply under its parent", async () => {
    const c = await handlePostComment(post(member, { thread: "/t/", body: "root" }), env, { nowIso: NOW });
    const rootId = (await c.json()).id;
    await handlePostComment(post(admin, { thread: "/t/", parent_id: rootId, body: "reply" }), env, { nowIso: NOW });
    const body = await (await getFor("/t/")).json();
    expect(body.comments.length).toBe(1);
    expect(body.comments[0].replies.map((r) => r.body)).toEqual(["reply"]);
  });

  it("rejects a reply to a comment that is itself a reply", async () => {
    const c = await handlePostComment(post(member, { thread: "/t/", body: "root" }), env, { nowIso: NOW });
    const rootId = (await c.json()).id;
    const r = await handlePostComment(post(member, { thread: "/t/", parent_id: rootId, body: "reply" }), env, { nowIso: NOW });
    const replyId = (await r.json()).id;
    const nested = await handlePostComment(post(member, { thread: "/t/", parent_id: replyId, body: "reply-to-reply" }), env, { nowIso: NOW });
    expect(nested.status).toBe(400);
  });

  it("drops an orphaned reply when its parent is later hidden", async () => {
    const c = await handlePostComment(post(member, { thread: "/t/", body: "root" }), env, { nowIso: NOW });
    const parentId = (await c.json()).id;
    await handlePostComment(post(member, { thread: "/t/", parent_id: parentId, body: "reply" }), env, { nowIso: NOW });
    await env.DB.prepare("UPDATE comments SET status='hidden' WHERE id = ?").bind(parentId).run();
    const body = await (await getFor("/t/")).json();
    expect(body.comments.length).toBe(0);
  });
});

describe("edit + delete", () => {
  async function seed(user, thread, text) {
    const res = await handlePostComment(post(user, { thread: thread, body: text }), env, { nowIso: NOW });
    return (await res.json()).id;
  }
  function withUser(user, body) { const r = new Request("https://worker.test/api/comments", { method: "PATCH", body: JSON.stringify(body) }); r.user = user; return r; }

  it("author edits own comment; a different member cannot", async () => {
    const id = await seed(member, "/t/", "orig");
    const ok = await handlePatchComment(withUser(member, { id: id, body: "edited" }), env, { nowIso: NOW });
    expect(ok.status).toBe(200);
    expect((await (await getFor("/t/")).json()).comments[0].body).toBe("edited");
    const other = await handlePatchComment(withUser({ sub: "z@x.org", name: "Z", role: "member" }, { id: id, body: "hax" }), env, { nowIso: NOW });
    expect(other.status).toBe(403);
  });

  it("admin can edit anyone's comment", async () => {
    const id = await seed(member, "/t/", "orig");
    const res = await handlePatchComment(withUser(admin, { id: id, body: "modded" }), env, { nowIso: NOW });
    expect(res.status).toBe(200);
  });

  it("patch of unknown id is 404", async () => {
    const res = await handlePatchComment(withUser(admin, { id: 999999, body: "x" }), env, { nowIso: NOW });
    expect(res.status).toBe(404);
  });

  it("author delete hides the comment from GET", async () => {
    const id = await seed(member, "/t/", "bye");
    const del = new Request("https://worker.test/api/comments", { method: "DELETE", body: JSON.stringify({ id: id }) });
    del.user = member;
    expect((await handleDeleteComment(del, env, { nowIso: NOW })).status).toBe(200);
    expect((await (await getFor("/t/")).json()).comments.length).toBe(0);
  });

  it("delete of unknown id is 404; missing id is 400", async () => {
    const del = new Request("https://worker.test/api/comments", { method: "DELETE", body: JSON.stringify({ id: 4242 }) });
    del.user = admin;
    expect((await handleDeleteComment(del, env, { nowIso: NOW })).status).toBe(404);
    const bad = new Request("https://worker.test/api/comments", { method: "DELETE", body: JSON.stringify({}) });
    bad.user = admin;
    expect((await handleDeleteComment(bad, env, { nowIso: NOW })).status).toBe(400);
  });
});
