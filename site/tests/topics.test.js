const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

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
  const p = path.join(__dirname, "..", "static", "js", "topics.js");
  vm.runInContext(fs.readFileSync(p, "utf8"), context, { filename: p });
  return context.window.ECBS.Topics;
}

const base = { slug: "sitting-posture", title: "Sitting posture", body: "How do you sit?", author_name: "Mem", tags: [], reply_count: 0, created_at: "2026-07-05", last_active_at: "2026-07-05" };

test("rowHtml escapes title, body, and author (no HTML injection)", () => {
  const html = load().rowHtml(Object.assign({}, base, {
    title: "<script>x</script>",
    body: "<img src=x onerror=1>",
    author_name: "<b>Mem</b>"
  }));
  assert.ok(!html.includes("<script>x") && !html.includes("<img src=x") && !html.includes("<b>Mem</b>"));
  assert.ok(html.includes("&lt;script&gt;") && html.includes("&lt;img") && html.includes("&lt;b&gt;Mem"));
});

test("rowHtml links to the detail view and shows the author", () => {
  const html = load().rowHtml(base);
  assert.ok(html.includes("topics/view/?slug=sitting-posture"));
  assert.ok(html.includes("By Mem"));
});

test("reply_count pluralizes correctly", () => {
  const one = load().rowHtml(Object.assign({}, base, { reply_count: 1 }));
  assert.ok(one.includes("1 reply") && !one.includes("1 replies"));
  const many = load().rowHtml(Object.assign({}, base, { reply_count: 3 }));
  assert.ok(many.includes("3 replies"));
  const zero = load().rowHtml(base);
  assert.ok(zero.includes("0 replies"));
});

test("manage option adds edit/delete controls outside the row anchor; default hides them", () => {
  const plain = load().rowHtml(base);
  assert.ok(!plain.includes("data-edit-topic") && !plain.includes("data-delete-topic"), "no controls by default");
  const managed = load().rowHtml(Object.assign({ id: 5 }, base), { manage: true });
  assert.ok(managed.includes('data-edit-topic="5"') && managed.includes('data-delete-topic="5"'), "controls present when manage");
  // Controls must sit after the closing </a> so clicking them doesn't navigate.
  assert.ok(managed.indexOf("data-edit-topic") > managed.lastIndexOf("</a>"), "controls are outside the anchor");
});

test("tags render as escaped pills", () => {
  const html = load().rowHtml(Object.assign({}, base, { tags: ["metta", "<x>"] }));
  assert.ok(html.includes(">metta<") || html.includes("metta"));
  assert.ok(html.includes("&lt;x&gt;") && !html.includes("<x>"));
});
