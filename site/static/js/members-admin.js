// site/static/js/members-admin.js
// Admin-only membership panel for /account/members. Renders the pending queue
// (approve/deny) and the full member list (role assignment), driven by the
// worker's /api/members endpoints. All role gating is enforced server-side; the
// client checks isAdmin() only to render the right view.
(function () {
  "use strict";
  var ECBS = (window.ECBS = window.ECBS || {});
  var ROLES = ["reader", "member", "admin"];

  function workerBase() {
    var meta = typeof document !== "undefined" ? document.querySelector('meta[name="ecbs:worker-base"]') : null;
    return meta ? (meta.getAttribute("content") || "").replace(/\/+$/, "") : "";
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function roleSelect(member) {
    var opts = ROLES.map(function (r) {
      return '<option value="' + r + '"' + (member.role === r ? " selected" : "") + ">" + r + "</option>";
    }).join("");
    return '<select data-role-email="' + esc(member.email) + '" class="border border-gray-300 rounded px-2 py-1 text-sm">' + opts + "</select>";
  }

  function renderMembersHtml(data) {
    var pending = (data && data.pending) || [];
    var members = (data && data.members) || [];
    var pendingRows = pending.length
      ? pending.map(function (m) {
          return '<li class="flex items-center justify-between gap-3 py-2 border-b border-gray-100">' +
            '<span class="text-sm text-sangha-navy">' + esc(m.name || m.email) + ' &lt;' + esc(m.email) + '&gt;</span>' +
            '<span class="flex gap-2">' +
              '<button type="button" data-approve="' + esc(m.email) + '" class="rounded bg-sangha-navy text-white text-xs px-3 py-1">Approve</button>' +
              '<button type="button" data-deny="' + esc(m.email) + '" class="rounded border border-gray-300 text-xs px-3 py-1">Deny</button>' +
            '</span></li>';
        }).join("")
      : '<li class="py-2 text-sm text-gray-500">No pending requests.</li>';
    var memberRows = members.length
      ? members.map(function (m) {
          return '<li class="flex items-center justify-between gap-3 py-2 border-b border-gray-100">' +
            '<span class="text-sm text-sangha-navy">' + esc(m.name || m.email) + ' &lt;' + esc(m.email) + '&gt;</span>' +
            roleSelect(m) + '</li>';
        }).join("")
      : '<li class="py-2 text-sm text-gray-500">No members yet.</li>';
    return '' +
      '<div class="bg-white rounded-xl border border-gray-200 p-6 mb-8">' +
        '<h2 class="font-serif text-xl font-bold text-sangha-navy mb-4">Pending requests</h2>' +
        '<ul>' + pendingRows + '</ul>' +
      '</div>' +
      '<div class="bg-white rounded-xl border border-gray-200 p-6">' +
        '<h2 class="font-serif text-xl font-bold text-sangha-navy mb-4">Members</h2>' +
        '<ul>' + memberRows + '</ul>' +
      '</div>';
  }

  function deny() { return "Only administrators can view this page."; }

  async function init(root, deps) {
    var auth = deps || ECBS.Auth;
    if (!root || !auth) return;
    await auth.ready();
    if (!auth.isAdmin()) {
      root.innerHTML = '<div class="bg-white rounded-xl border border-gray-200 p-6 text-sm text-gray-600">' + deny() + "</div>";
      return;
    }
    var base = workerBase();
    async function load() {
      var res = await auth.fetch(base + "/api/members");
      if (!res.ok) { root.innerHTML = '<p class="text-sm text-red-600">Failed to load members.</p>'; return; }
      root.innerHTML = renderMembersHtml(await res.json());
      wire();
    }
    async function post(path, body) {
      await auth.fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      await load();
    }
    function wire() {
      root.querySelectorAll("[data-approve]").forEach(function (b) {
        b.addEventListener("click", function () { post("/api/members/approve", { email: b.getAttribute("data-approve") }); });
      });
      root.querySelectorAll("[data-deny]").forEach(function (b) {
        b.addEventListener("click", function () { post("/api/members/deny", { email: b.getAttribute("data-deny") }); });
      });
      root.querySelectorAll("[data-role-email]").forEach(function (sel) {
        sel.addEventListener("change", function () { post("/api/members/role", { email: sel.getAttribute("data-role-email"), role: sel.value }); });
      });
    }
    await load();
  }

  ECBS.MembersAdmin = { renderMembersHtml: renderMembersHtml, init: init };

  if (typeof document !== "undefined") {
    var start = function () {
      var root = document.getElementById("ecbs-members-app");
      if (root) init(root);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
  }
})();
