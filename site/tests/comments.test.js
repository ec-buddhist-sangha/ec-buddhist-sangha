const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function load() {
  const context = { window: {}, document: { getElementById: () => null, querySelector: () => null }, console, JSON, Object, Array, String };
  context.window.window = context.window;
  vm.createContext(context);
  const p = path.join(__dirname, "..", "static", "js", "comments.js");
  vm.runInContext(fs.readFileSync(p, "utf8"), context, { filename: p });
  return context.window.ECBS.Comments;
}

const sample = [
  { id: 1, author_name: "Mem", body: "hello", created_at: "2026-07-05", own: false, replies: [
    { id: 2, author_name: "Adm", body: "hi back", created_at: "2026-07-05", own: true, replies: [] }
  ] }
];

test("renders comment bodies and author names, escaped", () => {
  const html = load().renderCommentsHtml(
    [{ id: 9, author_name: "<b>x</b>", body: "<img src=x onerror=1>", created_at: "2026-07-05", own: false, replies: [] }],
    { canComment: false, isAdmin: false }
  );
  assert.ok(!html.includes("<img src=x"));
  assert.ok(!html.includes("<b>x</b>"));
  assert.ok(html.includes("&lt;img") && html.includes("&lt;b&gt;"));
});

test("renders a nested reply", () => {
  const html = load().renderCommentsHtml(sample, { canComment: false, isAdmin: false });
  assert.ok(html.includes("hello") && html.includes("hi back"));
});

test("shows reply controls only when canComment", () => {
  const off = load().renderCommentsHtml(sample, { canComment: false, isAdmin: false });
  assert.ok(!off.includes('data-reply="1"'));
  const on = load().renderCommentsHtml(sample, { canComment: true, isAdmin: false });
  assert.ok(on.includes('data-reply="1"'));
});

test("shows edit/delete for own comments and, for admin, all", () => {
  const asOwner = load().renderCommentsHtml(sample, { canComment: true, isAdmin: false });
  // id 2 is own -> has controls; id 1 not own, not admin -> no controls
  assert.ok(asOwner.includes('data-delete="2"'));
  assert.ok(!asOwner.includes('data-delete="1"'));
  const asAdmin = load().renderCommentsHtml(sample, { canComment: true, isAdmin: true });
  assert.ok(asAdmin.includes('data-delete="1"') && asAdmin.includes('data-delete="2"'));
});

test("empty state", () => {
  assert.ok(/no comments/i.test(load().renderCommentsHtml([], { canComment: false, isAdmin: false })));
});
