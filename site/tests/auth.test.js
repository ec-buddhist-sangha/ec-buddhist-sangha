const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function makeToken(claims) {
  return b64url({ alg: "HS256", typ: "JWT" }) + "." + b64url(claims) + ".sig";
}

function load(options = {}) {
  const sessionData = new Map();
  const metas = {
    'meta[name="ecbs:worker-base"]': { getAttribute: () => options.workerBase ?? "https://worker.test" },
    'meta[name="ecbs:site-base"]': { getAttribute: () => options.siteBase ?? "/" }
  };
  const container = { innerHTML: "", querySelector: () => null, querySelectorAll: () => [] };
  const location = { href: options.href || "https://eauclairesangha.org/calendar/", hash: options.hash || "", pathname: "/calendar/", search: "" };
  const events = [];
  const context = {
    URLSearchParams, console, atob: (s) => Buffer.from(s, "base64").toString("binary"), escape, unescape, decodeURIComponent, encodeURIComponent, JSON, Math, Date, Promise, Object,
    window: {
      fetch: options.fetch,
      atob: (s) => Buffer.from(s, "base64").toString("binary"),
      location,
      history: { replaceState: (a, b, url) => { location.replacedTo = url; } },
      dispatchEvent: (e) => { events.push(e); return true; },
      addEventListener: () => {},
      CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
      sessionStorage: {
        getItem: (k) => (sessionData.has(k) ? sessionData.get(k) : null),
        setItem: (k, v) => sessionData.set(k, String(v)),
        removeItem: (k) => sessionData.delete(k)
      }
    },
    document: {
      readyState: "complete",
      addEventListener: () => {},
      dispatchEvent: (e) => { events.push(e); return true; },
      getElementById: (id) => (id === "ecbs-auth" ? container : null),
      querySelector: (sel) => metas[sel] || null
    }
  };
  context.window.window = context.window;
  context.window.document = context.document;
  vm.createContext(context);
  const scriptPath = path.join(__dirname, "..", "static", "js", "auth.js");
  vm.runInContext(fs.readFileSync(scriptPath, "utf8"), context, { filename: scriptPath });
  return { Auth: context.window.ECBS.Auth, sessionData, location, events, container };
}

// Fetch stub that answers /api/me with the given session, and records calls.
function apiFetch(session, opts = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/api/me")) {
      if (opts.meStatus && opts.meStatus !== 200) return new Response("", { status: opts.meStatus });
      return new Response(JSON.stringify(session), { status: 200 });
    }
    if (String(url).endsWith("/api/access-request")) {
      return new Response(JSON.stringify({ status: opts.requestStatus || "pending" }), { status: 200 });
    }
    return new Response("", { status: 404 });
  };
  fn.calls = calls;
  return fn;
}

const future = () => Math.floor(Date.now() / 1000) + 600;

test("getUser is null when no token is stored", () => {
  assert.equal(load().Auth.getUser(), null);
});

test("getUser role comes from /api/me, not the token", async () => {
  const fetch = apiFetch({ sub: "mem@x.org", name: "Mem", role: "member", request_status: "none" });
  const { Auth } = load({ hash: "#token=" + makeToken({ sub: "mem@x.org", name: "Mem", exp: future() }), fetch });
  await Auth.ready();
  const user = Auth.getUser();
  assert.equal(user.email, "mem@x.org");
  assert.equal(user.role, "member");
  assert.ok(fetch.calls.some((c) => c.url.endsWith("/api/me")));
});

test("signed-in account menu labels the calendar without RSVP wording", async () => {
  const fetch = apiFetch({ sub: "mem@x.org", name: "Mem", role: "member", request_status: "none" });
  const { Auth, container } = load({ hash: "#token=" + makeToken({ sub: "mem@x.org", name: "Mem", exp: future() }), fetch });
  await Auth.ready();
  Auth.renderButtons();

  assert.match(container.innerHTML, />Calendar<\/a>/);
  assert.doesNotMatch(container.innerHTML, /RSVP/i);
  assert.doesNotMatch(container.innerHTML, /Calendar Admin/);
});

test("isAdmin reflects the /api/me role", async () => {
  const fetch = apiFetch({ sub: "boss@x.org", name: "Boss", role: "admin", request_status: "none" });
  const { Auth, container } = load({ hash: "#token=" + makeToken({ sub: "boss@x.org", name: "Boss", exp: future() }), fetch });
  await Auth.ready();
  assert.equal(Auth.isAdmin(), true);
  Auth.renderButtons();
  assert.match(container.innerHTML, /href="\/admin\/calendar\/"[^>]*>Calendar Admin<\/a>/);
  assert.doesNotMatch(container.innerHTML, />CMS<\/a>/);
});

test("getSession exposes role + request_status and getUser.role is null before refresh", async () => {
  const fetch = apiFetch({ sub: "r@x.org", name: "R", role: "reader", request_status: "pending" });
  const { Auth } = load({ hash: "#token=" + makeToken({ sub: "r@x.org", name: "R", exp: future() }), fetch });
  assert.equal(Auth.getSession(), null);       // not loaded yet
  assert.equal(Auth.getUser().role, null);     // no false "member" default
  await Auth.ready();
  assert.deepEqual(Auth.getSession(), { role: "reader", request_status: "pending" });
});

test("refresh dispatches an ecbs:session event", async () => {
  const fetch = apiFetch({ sub: "r@x.org", name: "R", role: "reader", request_status: "none" });
  const { Auth, events } = load({ hash: "#token=" + makeToken({ sub: "r@x.org", name: "R", exp: future() }), fetch });
  await Auth.ready();
  assert.ok(events.some((e) => e.type === "ecbs:session"));
});

test("a 401 from /api/me clears the token and session", async () => {
  const fetch = apiFetch({}, { meStatus: 401 });
  const { Auth, sessionData } = load({ hash: "#token=" + makeToken({ sub: "x@x.org", name: "X", exp: future() }), fetch });
  await Auth.ready();
  assert.equal(Auth.getToken(), null);
  assert.equal(sessionData.has("ecbs-auth-token"), false);
  assert.equal(sessionData.has("ecbs-auth-session"), false);
});

test("ready() is idempotent and only fetches /api/me once", async () => {
  const fetch = apiFetch({ sub: "r@x.org", name: "R", role: "reader", request_status: "none" });
  const { Auth } = load({ hash: "#token=" + makeToken({ sub: "r@x.org", name: "R", exp: future() }), fetch });
  await Promise.all([Auth.ready(), Auth.ready()]);
  const meCalls = fetch.calls.filter((c) => c.url.endsWith("/api/me"));
  assert.equal(meCalls.length, 1);
});

test("after logout, ready() resolves to null", async () => {
  const fetch = apiFetch({ sub: "r@x.org", name: "R", role: "reader", request_status: "none" });
  const { Auth } = load({ hash: "#token=" + makeToken({ sub: "r@x.org", name: "R", exp: future() }), fetch });
  await Auth.ready();
  assert.notEqual(Auth.getUser(), null);
  Auth.logout();
  assert.equal(await Auth.ready(), null);
});

test("requestAccess posts and refreshes to pending", async () => {
  const fetch = apiFetch({ sub: "r@x.org", name: "R", role: "reader", request_status: "none" }, { requestStatus: "pending" });
  const { Auth } = load({ hash: "#token=" + makeToken({ sub: "r@x.org", name: "R", exp: future() }), fetch });
  await Auth.ready();
  // after the request, /api/me should now report pending
  const res = await Auth.requestAccess();
  assert.equal(res.status, "pending");
});

test("ready resolves immediately when signed out", async () => {
  const { Auth } = load();
  assert.equal(await Auth.ready(), null);
});

test("login redirects to the Worker with a return_to", () => {
  const { Auth, location } = load({ href: "https://eauclairesangha.org/calendar/" });
  Auth.login();
  assert.ok(location.href.startsWith("https://worker.test/auth/login?return_to="));
});

test("fetch attaches the bearer token and clears it on 401", async () => {
  let seenAuth;
  const fetchImpl = async (url, opts) => { seenAuth = opts.headers.Authorization; return new Response("", { status: 401 }); };
  const { Auth, sessionData } = load({ hash: "#token=" + makeToken({ sub: "x@x.org", name: "X", exp: future() }), fetch: fetchImpl });
  await Auth.fetch("https://worker.test/api/x");
  assert.ok(seenAuth.startsWith("Bearer "));
  assert.equal(sessionData.has("ecbs-auth-token"), false);
});
