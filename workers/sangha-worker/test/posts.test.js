import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import {
  handleListPosts, handleGetPost, handleCreatePost, handlePatchPost, handleDeletePost
} from "../src/posts.js";

const NOW = "2026-07-05T12:00:00.000Z";
beforeEach(async () => { await env.DB.prepare("DELETE FROM posts").run(); });

const admin = { sub: "a@x.org", name: "Adm", role: "admin" };

function req(method, user, body) {
  const r = new Request("https://worker.test/api/posts", { method, body: body ? JSON.stringify(body) : undefined });
  if (user) r.user = user;
  return r;
}
async function list(kind) {
  const url = "https://worker.test/api/posts" + (kind ? "?kind=" + kind : "");
  return (await handleListPosts(new Request(url), env)).json();
}
async function create(body) {
  const res = await handleCreatePost(req("POST", admin, body), env, { nowIso: NOW });
  return { res, json: await res.json() };
}

describe("create + list", () => {
  it("creates an announcement and lists it publicly", async () => {
    const { res, json } = await create({ kind: "announcement", title: "Website Live", body: "We launched" });
    expect(res.status).toBe(201);
    expect(json.slug).toBe("website-live");
    const { posts } = await list();
    expect(posts.length).toBe(1);
    expect(posts[0].title).toBe("Website Live");
    expect(posts[0].kind).toBe("announcement");
  });

  it("filters by kind and sorts by published_at desc", async () => {
    await create({ kind: "announcement", title: "Older", published_at: "2026-01-01T00:00:00.000Z" });
    await create({ kind: "event", title: "Sit", published_at: "2026-09-01T00:00:00.000Z", start_at: "2026-09-01T19:00:00.000Z" });
    await create({ kind: "announcement", title: "Newer", published_at: "2026-08-01T00:00:00.000Z" });
    const all = await list();
    expect(all.posts.map((p) => p.title)).toEqual(["Sit", "Newer", "Older"]);
    const anns = await list("announcement");
    expect(anns.posts.map((p) => p.title)).toEqual(["Newer", "Older"]);
  });

  it("de-duplicates slugs", async () => {
    const a = await create({ kind: "announcement", title: "Repeat" });
    const b = await create({ kind: "announcement", title: "Repeat" });
    expect(a.json.slug).toBe("repeat");
    expect(b.json.slug).toBe("repeat-2");
  });

  it("rejects an unknown kind or empty title", async () => {
    expect((await handleCreatePost(req("POST", admin, { kind: "blog", title: "x" }), env, { nowIso: NOW })).status).toBe(400);
    expect((await handleCreatePost(req("POST", admin, { kind: "announcement", title: "  " }), env, { nowIso: NOW })).status).toBe(400);
  });

  it("normalizes tags to a string array", async () => {
    await create({ kind: "announcement", title: "Tagged", tags: ["news", " library ", ""] });
    const { posts } = await list();
    expect(posts[0].tags).toEqual(["news", "library"]);
  });
});

describe("get by slug", () => {
  it("returns a published post and 404s otherwise", async () => {
    await create({ kind: "announcement", title: "Findable", body: "hi" });
    const found = new Request("https://worker.test/api/posts/findable");
    found.params = { slug: "findable" };
    const ok = await handleGetPost(found, env);
    expect(ok.status).toBe(200);
    expect((await ok.json()).post.body).toBe("hi");
    const miss = new Request("https://worker.test/api/posts/nope");
    miss.params = { slug: "nope" };
    expect((await handleGetPost(miss, env)).status).toBe(404);
  });
});

describe("patch + delete", () => {
  async function getBySlug(slug) {
    const r = new Request("https://worker.test/api/posts/" + slug);
    r.params = { slug };
    return (await (await handleGetPost(r, env)).json()).post;
  }

  it("edits fields and leaves others intact", async () => {
    const { json } = await create({ kind: "announcement", title: "Orig", body: "keep-me" });
    const res = await handlePatchPost(req("PATCH", admin, { id: json.id, title: "Edited" }), env, { nowIso: NOW });
    expect(res.status).toBe(200);
    const post = await getBySlug(json.slug);
    expect(post.title).toBe("Edited");
    expect(post.body).toBe("keep-me");
  });

  it("delete hides the post from listings; unknown id 404s", async () => {
    const { json } = await create({ kind: "announcement", title: "Bye" });
    expect((await handleDeletePost(req("DELETE", admin, { id: json.id }), env, { nowIso: NOW })).status).toBe(200);
    expect((await list()).posts.length).toBe(0);
    expect((await handleDeletePost(req("DELETE", admin, { id: 99999 }), env, { nowIso: NOW })).status).toBe(404);
    expect((await handleDeletePost(req("DELETE", admin, {}), env, { nowIso: NOW })).status).toBe(400);
  });
});
