import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import {
  handleListTopics, handleGetTopic, handleCreateTopic, handlePatchTopic, handleDeleteTopic
} from "../src/topics.js";
import { handlePostComment } from "../src/comments.js";

const NOW = "2026-07-05T12:00:00.000Z";
beforeEach(async () => {
  await env.DB.prepare("DELETE FROM topics").run();
  await env.DB.prepare("DELETE FROM comments").run();
});

const member = { sub: "m@x.org", name: "Mem", role: "member" };
const other = { sub: "z@x.org", name: "Zed", role: "member" };
const admin = { sub: "a@x.org", name: "Adm", role: "admin" };

function req(method, user, body, path = "/api/topics") {
  const r = new Request("https://worker.test" + path, { method, body: body ? JSON.stringify(body) : undefined });
  if (user) r.user = user;
  return r;
}
async function listTopics() {
  return (await handleListTopics(new Request("https://worker.test/api/topics"), env)).json();
}
async function create(user, body, at) {
  const res = await handleCreateTopic(req("POST", user, body), env, { nowIso: at || NOW });
  return { res, json: await res.json() };
}

describe("create + list", () => {
  it("member creates a topic that lists publicly with author + zero replies", async () => {
    const { res, json } = await create(member, { title: "Sitting posture", body: "How do you sit?" });
    expect(res.status).toBe(201);
    expect(json.slug).toBe("sitting-posture");
    const { topics } = await listTopics();
    expect(topics.length).toBe(1);
    expect(topics[0].author_name).toBe("Mem");
    expect(topics[0].reply_count).toBe(0);
    expect(topics[0].author_email).toBeUndefined(); // no PII leak
  });

  it("requires a title and a body", async () => {
    expect((await handleCreateTopic(req("POST", member, { title: "x" }), env, { nowIso: NOW })).status).toBe(400);
    expect((await handleCreateTopic(req("POST", member, { body: "x" }), env, { nowIso: NOW })).status).toBe(400);
  });

  it("de-duplicates slugs", async () => {
    const a = await create(member, { title: "Metta", body: "a" });
    const b = await create(other, { title: "Metta", body: "b" });
    expect(a.json.slug).toBe("metta");
    expect(b.json.slug).toBe("metta-2");
  });
});

describe("reply_count + last_active_at", () => {
  it("counts published comments on the topic thread and bumps last_active_at", async () => {
    const { json } = await create(member, { title: "Retreat", body: "who's going?" }, "2026-07-01T00:00:00.000Z");
    const thread = "topic:" + json.slug;
    const c = new Request("https://worker.test/api/comments", { method: "POST", body: JSON.stringify({ thread, body: "me!" }) });
    c.user = other;
    await handlePostComment(c, env, { nowIso: "2026-07-09T00:00:00.000Z" });
    const { topics } = await listTopics();
    expect(topics[0].reply_count).toBe(1);
    expect(topics[0].last_active_at).toBe("2026-07-09T00:00:00.000Z"); // bumped past creation
  });

  it("orders topics by most-recent activity", async () => {
    const a = await create(member, { title: "First", body: "." }, "2026-07-01T00:00:00.000Z");
    await create(member, { title: "Second", body: "." }, "2026-07-02T00:00:00.000Z");
    // A comment on the older topic makes it most-recently-active.
    const c = new Request("https://worker.test/api/comments", { method: "POST", body: JSON.stringify({ thread: "topic:" + a.json.slug, body: "bump" }) });
    c.user = member;
    await handlePostComment(c, env, { nowIso: "2026-07-10T00:00:00.000Z" });
    const { topics } = await listTopics();
    expect(topics.map((t) => t.title)).toEqual(["First", "Second"]);
  });
});

describe("edit + delete gating", () => {
  it("author edits own topic; a different member cannot; admin can", async () => {
    const { json } = await create(member, { title: "Orig", body: "b" });
    expect((await handlePatchTopic(req("PATCH", member, { id: json.id, title: "Edited" }), env, { nowIso: NOW })).status).toBe(200);
    expect((await handlePatchTopic(req("PATCH", other, { id: json.id, title: "hax" }), env, { nowIso: NOW })).status).toBe(403);
    expect((await handlePatchTopic(req("PATCH", admin, { id: json.id, title: "modded" }), env, { nowIso: NOW })).status).toBe(200);
    const { topics } = await listTopics();
    expect(topics[0].title).toBe("modded");
  });

  it("author delete hides the topic; unknown id 404s", async () => {
    const { json } = await create(member, { title: "Bye", body: "b" });
    expect((await handleDeleteTopic(req("DELETE", member, { id: json.id }), env, { nowIso: NOW })).status).toBe(200);
    expect((await listTopics()).topics.length).toBe(0);
    expect((await handleDeleteTopic(req("DELETE", admin, { id: 99999 }), env, { nowIso: NOW })).status).toBe(404);
  });
});

describe("get by slug", () => {
  it("returns a topic and 404s for unknown", async () => {
    const { json } = await create(member, { title: "Ask me", body: "content here" });
    const r = new Request("https://worker.test/api/topics/" + json.slug);
    r.params = { slug: json.slug };
    const ok = await handleGetTopic(r, env);
    expect(ok.status).toBe(200);
    expect((await ok.json()).topic.body).toBe("content here");
    const miss = new Request("https://worker.test/api/topics/nope");
    miss.params = { slug: "nope" };
    expect((await handleGetTopic(miss, env)).status).toBe(404);
  });
});
