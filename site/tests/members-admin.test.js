const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function load() {
  const context = { window: {}, document: { getElementById: () => null }, console, JSON, Object, Array, String };
  context.window.window = context.window;
  vm.createContext(context);
  const p = path.join(__dirname, "..", "static", "js", "members-admin.js");
  vm.runInContext(fs.readFileSync(p, "utf8"), context, { filename: p });
  return context.window.ECBS.MembersAdmin;
}

test("renderMembersHtml lists pending requests with approve/deny actions", () => {
  const html = load().renderMembersHtml({
    pending: [{ email: "p@x.org", name: "Pat" }],
    members: [{ email: "p@x.org", name: "Pat", role: "reader", request_status: "pending" }]
  });
  assert.ok(html.includes("p@x.org"));
  assert.ok(html.includes('data-approve="p@x.org"'));
  assert.ok(html.includes('data-deny="p@x.org"'));
});

test("renderMembersHtml renders a role selector per member", () => {
  const html = load().renderMembersHtml({
    pending: [],
    members: [{ email: "m@x.org", name: "Mem", role: "member", request_status: "none" }]
  });
  assert.ok(html.includes('data-role-email="m@x.org"'));
  assert.ok(html.includes("reader") && html.includes("member") && html.includes("admin"));
  // current role preselected
  assert.ok(html.includes('value="member" selected'));
});

test("renderMembersHtml shows an empty-state when there are no pending requests", () => {
  const html = load().renderMembersHtml({ pending: [], members: [] });
  assert.ok(/no pending/i.test(html));
});

test("escapes member-provided values", () => {
  const html = load().renderMembersHtml({
    pending: [],
    members: [{ email: "x@x.org", name: "<script>bad</script>", role: "reader", request_status: "none" }]
  });
  assert.ok(!html.includes("<script>bad"));
  assert.ok(html.includes("&lt;script&gt;"));
});
