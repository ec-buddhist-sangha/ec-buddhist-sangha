// Integration smoke for the native-content client modules: run posts.js and
// topics.js inside a real DOM (jsdom) against a mocked worker, and assert the
// feed/list/detail actually render. This is the headless stand-in for a
// Playwright pass — it exercises fetch → DOM, not just pure helpers.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { JSDOM } = require("jsdom");

function read(name) { return fs.readFileSync(path.join(__dirname, "..", "static", "js", name), "utf8"); }
const tick = () => new Promise((r) => setTimeout(r, 30));

function boot(bodyHtml, routes, url) {
  const head = '<meta name="ecbs:worker-base" content="https://worker.test"><meta name="ecbs:site-base" content="/">';
  const dom = new JSDOM("<!DOCTYPE html><html><head>" + head + "</head><body>" + bodyHtml + "</body></html>", {
    runScripts: "outside-only",
    url: url || "https://site.test/"
  });
  dom.window.fetch = async (u) => {
    for (const [match, body] of routes) {
      if (u.includes(match)) return { ok: true, status: 200, json: async () => body };
    }
    return { ok: false, status: 404, json: async () => ({ error: "not_found" }) };
  };
  return dom.window;
}

test("updates feed renders cards from /api/posts", async () => {
  const posts = [
    { id: 1, kind: "announcement", slug: "hello", title: "Hello Sangha", summary: "A warm welcome", body: "b", tags: ["news"], published_at: "2026-07-14T17:00:00.000Z" },
    { id: 2, kind: "event", slug: "weekly-sit", title: "Weekly Sit", body: "", location: "Main Hall", start_at: "2026-08-01T18:00:00.000Z", published_at: "2026-08-01T18:00:00.000Z", tags: [] }
  ];
  const win = boot('<div id="ecbs-updates" data-limit="5"></div>', [["/api/posts", { posts }]], "https://site.test/updates/");
  win.eval(read("posts.js"));
  await tick();
  const html = win.document.getElementById("ecbs-updates").innerHTML;
  assert.ok(html.includes("Hello Sangha"), "shows announcement title");
  assert.ok(html.includes("A warm welcome"), "prefers summary");
  assert.ok(html.includes("Weekly Sit") && html.includes("Main Hall"), "shows event + location");
  assert.ok(html.includes("updates/view/?slug=hello"), "links to detail");
});

test("update detail renders a single post by slug", async () => {
  const post = { id: 9, kind: "announcement", slug: "our-new-website-is-here", title: "Our New Website Is Here", body: "We're glad <b>you're</b> here.", tags: ["website"], published_at: "2026-07-14T17:00:00.000Z" };
  const win = boot('<div id="ecbs-post"></div>', [["/api/posts/our-new-website-is-here", { post }]], "https://site.test/updates/view/?slug=our-new-website-is-here");
  win.eval(read("posts.js"));
  await tick();
  const root = win.document.getElementById("ecbs-post");
  const html = root.innerHTML;
  assert.ok(html.includes("Our New Website Is Here"));
  // Body is plain text: the readable prose appears, but no HTML from the body
  // is injected into the DOM (the <b> is inert text, not an element).
  assert.ok(root.textContent.includes("We're glad <b>you're</b> here."), "body rendered as text");
  assert.equal(root.querySelector("#ecbs-post b, .prose b, b"), null, "no HTML injected from body");
  assert.ok(html.includes("Back to Updates"));
});

test("forum list renders topics from /api/topics", async () => {
  const topics = [
    { id: 1, slug: "sitting-posture", title: "Sitting posture", body: "How do you sit?", author_name: "Mem", tags: ["practice"], reply_count: 2, created_at: "2026-07-05", last_active_at: "2026-07-06" }
  ];
  const win = boot('<div id="ecbs-topics"></div>', [["/api/topics", { topics }]], "https://site.test/topics/");
  win.eval(read("topics.js"));
  await tick();
  const html = win.document.getElementById("ecbs-topics").innerHTML;
  assert.ok(html.includes("Sitting posture"));
  assert.ok(html.includes("By Mem") && html.includes("2 replies"));
  assert.ok(html.includes("topics/view/?slug=sitting-posture"));
  assert.ok(html.includes("Sign in and request access"), "anonymous sees the gated prompt");
});

test("forum list shows a graceful error when the worker is down", async () => {
  const win = boot('<div id="ecbs-topics"></div>', [], "https://site.test/topics/"); // no routes → 404
  win.eval(read("topics.js"));
  await tick();
  const html = win.document.getElementById("ecbs-topics").innerHTML;
  assert.ok(html.includes("unavailable"), "renders an error state, not a crash");
});
