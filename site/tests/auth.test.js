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
  const context = {
    URLSearchParams, console, atob: (s) => Buffer.from(s, "base64").toString("binary"), escape, unescape, decodeURIComponent, JSON, Math, Date,
    window: {
      fetch: options.fetch,
      atob: (s) => Buffer.from(s, "base64").toString("binary"),
      location,
      history: { replaceState: (a, b, url) => { location.replacedTo = url; } },
      sessionStorage: {
        getItem: (k) => (sessionData.has(k) ? sessionData.get(k) : null),
        setItem: (k, v) => sessionData.set(k, String(v)),
        removeItem: (k) => sessionData.delete(k)
      }
    },
    document: {
      readyState: "complete",
      addEventListener: () => {},
      getElementById: (id) => (id === "ecbs-auth" ? container : null),
      querySelector: (sel) => metas[sel] || null
    }
  };
  context.window.window = context.window;
  context.window.document = context.document;
  vm.createContext(context);
  const scriptPath = path.join(__dirname, "..", "static", "js", "auth.js");
  vm.runInContext(fs.readFileSync(scriptPath, "utf8"), context, { filename: scriptPath });
  return { Auth: context.window.ECBS.Auth, sessionData, location };
}

test("getUser is null when no token is stored", () => {
  assert.equal(load().Auth.getUser(), null);
});

test("consumes a token from the URL fragment and exposes the user", () => {
  const claims = { sub: "mem@eauclairesangha.org", name: "Mem", role: "member", exp: Math.floor(Date.now() / 1000) + 600 };
  const { Auth, location } = load({ hash: "#token=" + makeToken(claims) });
  const user = Auth.getUser();
  assert.equal(user.email, "mem@eauclairesangha.org");
  assert.equal(user.role, "member");
  assert.equal(Auth.isAdmin(), false);
  assert.equal(location.replacedTo, "/calendar/"); // fragment cleared
});

test("isAdmin is true for an admin token", () => {
  const claims = { sub: "boss@eauclairesangha.org", name: "Boss", role: "admin", exp: Math.floor(Date.now() / 1000) + 600 };
  assert.equal(load({ hash: "#token=" + makeToken(claims) }).Auth.isAdmin(), true);
});

test("an expired token is treated as signed out and cleared", () => {
  const claims = { sub: "x@eauclairesangha.org", name: "X", role: "member", exp: Math.floor(Date.now() / 1000) - 1 };
  const { Auth, sessionData } = load({ hash: "#token=" + makeToken(claims) });
  assert.equal(Auth.getUser(), null);
  assert.equal(Auth.getToken(), null);
  assert.equal(sessionData.has("ecbs-auth-token"), false);
});

test("login redirects to the Worker with a return_to", () => {
  const { Auth, location } = load({ href: "https://eauclairesangha.org/calendar/" });
  Auth.login();
  assert.ok(location.href.startsWith("https://worker.test/auth/login?return_to="));
  assert.ok(location.href.includes(encodeURIComponent("https://eauclairesangha.org/calendar/")));
});

test("fetch attaches the bearer token and clears it on 401", async () => {
  const claims = { sub: "x@eauclairesangha.org", name: "X", role: "member", exp: Math.floor(Date.now() / 1000) + 600 };
  let seenAuth;
  const fetchImpl = async (url, opts) => { seenAuth = opts.headers.Authorization; return new Response("", { status: 401 }); };
  const { Auth, sessionData } = load({ hash: "#token=" + makeToken(claims), fetch: fetchImpl });
  await Auth.fetch("https://worker.test/api/x");
  assert.ok(seenAuth.startsWith("Bearer "));
  assert.equal(sessionData.has("ecbs-auth-token"), false);
});
