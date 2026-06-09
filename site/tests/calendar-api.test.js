const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadApi(options = {}) {
  const element = { getAttribute: (name) => (name === "data-calendar-api" ? (options.base ?? "https://worker.test") : null) };
  const context = {
    URL, URLSearchParams, console,
    window: {
      fetch: options.fetch,
      ECBS: { Auth: { getToken: () => options.token || null } }
    },
    document: { getElementById: (id) => (id === "calendar-app" ? element : null) }
  };
  context.window.window = context.window;
  vm.createContext(context);
  const scriptPath = path.join(__dirname, "..", "static", "js", "calendar-api.js");
  vm.runInContext(fs.readFileSync(scriptPath, "utf8"), context, { filename: scriptPath });
  return context.window.ECBS.CalendarApi;
}

test("enabled reflects whether an API base is configured", () => {
  assert.equal(loadApi({ base: "https://worker.test" }).enabled(), true);
  assert.equal(loadApi({ base: "" }).enabled(), false);
});

test("fetchStore GETs /api/calendar and returns parsed JSON", async () => {
  let seenUrl;
  const fetchImpl = async (url) => { seenUrl = url; return new Response(JSON.stringify({ store: { slots: [] }, revision: 3 }), { status: 200 }); };
  const api = loadApi({ fetch: fetchImpl });
  const data = await api.fetchStore();
  assert.equal(seenUrl, "https://worker.test/api/calendar");
  assert.equal(data.revision, 3);
});

test("putStore sends the bearer token and the revision", async () => {
  let init;
  const fetchImpl = async (url, opts) => { init = opts; return new Response(JSON.stringify({ revision: 5 }), { status: 200 }); };
  const api = loadApi({ fetch: fetchImpl, token: "jwt-123" });
  const res = await api.putStore({ slots: [] }, 4);
  assert.equal(init.method, "PUT");
  assert.equal(init.headers.Authorization, "Bearer jwt-123");
  assert.equal(JSON.parse(init.body).revision, 4);
  assert.equal(res.revision, 5);
});

test("putStore surfaces a 409 conflict payload", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ error: "revision_conflict", revision: 9, store: { slots: [] } }), { status: 409 });
  const api = loadApi({ fetch: fetchImpl, token: "jwt" });
  await assert.rejects(() => api.putStore({}, 1), (err) => err.conflict && err.conflict.revision === 9);
});

test("postSignup POSTs the payload with auth", async () => {
  let init;
  const fetchImpl = async (url, opts) => { init = opts; return new Response(JSON.stringify({ revision: 6, store: {} }), { status: 200 }); };
  const api = loadApi({ fetch: fetchImpl, token: "jwt" });
  await api.postSignup({ itemId: "s1", role: "attendee" });
  assert.equal(init.method, "POST");
  assert.equal(JSON.parse(init.body).itemId, "s1");
});
