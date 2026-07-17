const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

// Load posts.js in a minimal DOM-less context. It auto-inits against
// getElementById (which returns null here), so only the pure ECBS.Posts API is
// exercised.
function load() {
  const metas = {
    'meta[name="ecbs:worker-base"]': { getAttribute: () => "https://worker.test" },
    'meta[name="ecbs:site-base"]': { getAttribute: () => "/" }
  };
  const context = {
    URLSearchParams, console, JSON, Math, Date, Object, Array, String,
    window: { fetch: undefined },
    document: {
      readyState: "complete",
      addEventListener: () => {},
      getElementById: () => null,
      querySelector: (sel) => metas[sel] || null
    }
  };
  context.window.window = context.window;
  vm.createContext(context);
  const p = path.join(__dirname, "..", "static", "js", "posts.js");
  vm.runInContext(fs.readFileSync(p, "utf8"), context, { filename: p });
  return context.window.ECBS.Posts;
}

test("cardHtml escapes title, body, and location (no HTML injection)", () => {
  const html = load().cardHtml({
    kind: "announcement",
    slug: "x",
    title: "<script>alert(1)</script>",
    body: "<img src=x onerror=1>",
    published_at: "2026-07-14T17:00:00.000Z",
    tags: []
  });
  assert.ok(!html.includes("<script>alert(1)"));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(html.includes("&lt;script&gt;") && html.includes("&lt;img"));
});

test("announcement card links to the detail view by slug", () => {
  const html = load().cardHtml({ kind: "announcement", slug: "hello-world", title: "Hi", body: "b", published_at: "2026-07-14T17:00:00.000Z", tags: [] });
  assert.ok(html.includes("updates/view/?slug=hello-world"));
  assert.ok(html.includes("Announcement"));
});

test("event card shows the Event label and escaped location", () => {
  const html = load().cardHtml({
    kind: "event",
    slug: "sit",
    title: "Weekly Sit",
    body: "",
    location: "Hall <b>A</b>",
    start_at: "2026-08-01T18:00:00.000Z",
    published_at: "2026-08-01T18:00:00.000Z",
    tags: []
  });
  assert.ok(html.includes("Event"));
  assert.ok(html.includes("Hall &lt;b&gt;A&lt;/b&gt;"));
  assert.ok(!html.includes("<b>A</b>"));
});

test("summary is preferred over body for the card preview", () => {
  const html = load().cardHtml({ kind: "announcement", slug: "s", title: "T", summary: "SHORT SUMMARY", body: "long body text", published_at: "2026-07-14T17:00:00.000Z", tags: [] });
  assert.ok(html.includes("SHORT SUMMARY"));
});

test("admin option adds edit/delete controls keyed by post id; default hides them", () => {
  const P = { id: 7, kind: "announcement", slug: "s", title: "T", body: "b", published_at: "2026-07-14T17:00:00.000Z", tags: [] };
  const plain = load().cardHtml(P);
  assert.ok(!plain.includes("data-edit-post") && !plain.includes("data-delete-post"), "no controls by default");
  const admin = load().cardHtml(P, { admin: true });
  assert.ok(admin.includes('data-edit-post="7"') && admin.includes('data-delete-post="7"'), "controls present for admin");
});
