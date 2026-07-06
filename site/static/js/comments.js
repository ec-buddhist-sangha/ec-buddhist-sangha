// site/static/js/comments.js
// window.ECBS.Comments — native comment thread for Topics/Pages, backed by the
// worker's /api/comments. Bodies are rendered as escaped plain text (no HTML is
// trusted). Members/admins can post/reply/edit/delete; readers are prompted to
// request access.
(function () {
  "use strict";
  var ECBS = (window.ECBS = window.ECBS || {});

  function workerBase() {
    var meta = typeof document !== "undefined" ? document.querySelector('meta[name="ecbs:worker-base"]') : null;
    return meta ? (meta.getAttribute("content") || "").replace(/\/+$/, "") : "";
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function showError(root, msg) {
    root.insertAdjacentHTML(
      "afterbegin",
      '<div class="mb-4 rounded bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2">' + esc(msg) + "</div>"
    );
  }

  function controls(c, ctx) {
    if (!(c.own || ctx.isAdmin)) return "";
    return '<span class="ml-3 text-xs">' +
      '<button type="button" data-edit="' + c.id + '" data-edit-body="' + esc(c.body) + '" class="text-sangha-navy underline">edit</button> ' +
      '<button type="button" data-delete="' + c.id + '" class="text-red-600 underline">delete</button></span>';
  }
  function commentHtml(c, ctx, isReply) {
    var reply = (!isReply && ctx.canComment) ? '<button type="button" data-reply="' + c.id + '" class="mt-1 text-xs text-sangha-navy underline">reply</button>' : "";
    var kids = (c.replies || []).map(function (r) { return commentHtml(r, ctx, true); }).join("");
    return '<li class="' + (isReply ? "ml-6 mt-3" : "border-b border-gray-100 py-4") + '">' +
      '<div class="text-sm"><span class="font-bold text-sangha-navy">' + esc(c.author_name) + '</span> ' +
      '<span class="text-gray-400 text-xs">' + esc(c.created_at) + (c.updated_at ? " (edited)" : "") + '</span>' + controls(c, ctx) + '</div>' +
      '<div class="text-sm text-gray-700 mt-1" style="white-space:pre-wrap">' + esc(c.body) + '</div>' +
      reply +
      (kids ? '<ul>' + kids + '</ul>' : "") +
      '</li>';
  }

  function renderCommentsHtml(comments, ctx) {
    ctx = ctx || {};
    if (!comments || !comments.length) return '<p class="text-sm text-gray-500">No comments yet.</p>';
    return '<ul>' + comments.map(function (c) { return commentHtml(c, ctx, false); }).join("") + '</ul>';
  }

  function threadOf(root) {
    return root.getAttribute("data-thread") || (typeof window !== "undefined" ? window.location.pathname : "");
  }

  async function init(root, deps) {
    var auth = deps || ECBS.Auth;
    if (!root || !auth) return;
    await auth.ready();
    var base = workerBase();
    var thread = threadOf(root);
    var sess = auth.getSession && auth.getSession();
    var canComment = Boolean(sess && (sess.role === "member" || sess.role === "admin"));
    var ctx = { canComment: canComment, isAdmin: Boolean(auth.isAdmin && auth.isAdmin()) };

    function composer(parentId, currentText, editId) {
      return '<form data-composer class="mt-3" data-parent="' + (parentId || "") + '" data-edit-id="' + (editId || "") + '">' +
        '<textarea name="body" rows="3" maxlength="10000" class="w-full border border-gray-300 rounded p-2 text-sm" placeholder="Add a comment…">' + esc(currentText || "") + '</textarea>' +
        '<button type="submit" class="mt-2 rounded bg-sangha-navy text-white text-xs px-4 py-2">Post</button></form>';
    }

    async function load() {
      var res = await auth.fetch(base + "/api/comments?thread=" + encodeURIComponent(thread));
      if (!res.ok) { root.innerHTML = '<p class="text-sm text-red-600">Comments are unavailable right now.</p>'; return; }
      var data = await res.json();
      var html = renderCommentsHtml(data.comments, ctx);
      if (canComment) html += composer(null, "", null);
      else if (auth.isSignedIn && auth.isSignedIn()) html += '<p class="mt-3 text-sm text-gray-500">Your access request is pending, or you have read-only access.</p>';
      else html += '<p class="mt-3 text-sm text-gray-500">Sign in and request access to join the discussion.</p>';
      root.innerHTML = html;
      wire();
    }
    async function send(method, payload) {
      var res;
      try {
        res = await auth.fetch(base + "/api/comments", { method: method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        await load();
        if (!res.ok) showError(root, "That action couldn't be completed. Please try again.");
        return res.ok;
      } catch (e) {
        showError(root, "That action couldn't be completed. Please try again.");
        return false;
      }
    }
    function wire() {
      root.querySelectorAll("[data-composer]").forEach(function (form) {
        if (form.getAttribute("data-wired")) return;
        form.setAttribute("data-wired", "1");
        form.addEventListener("submit", function (e) {
          e.preventDefault();
          var text = form.querySelector('[name="body"]').value;
          if (!text || !text.trim()) return;
          var editId = form.getAttribute("data-edit-id");
          var parent = form.getAttribute("data-parent");
          if (editId) send("PATCH", { id: Number(editId), body: text });
          else send("POST", { thread: thread, parent_id: parent ? Number(parent) : null, body: text });
        });
      });
      root.querySelectorAll("[data-reply]").forEach(function (b) {
        if (b.getAttribute("data-wired")) return;
        b.setAttribute("data-wired", "1");
        b.addEventListener("click", function () {
          if (b.nextElementSibling && b.nextElementSibling.getAttribute && b.nextElementSibling.getAttribute("data-composer") !== null) return;
          b.insertAdjacentHTML("afterend", composer(b.getAttribute("data-reply"), "", null));
          wire();
        });
      });
      root.querySelectorAll("[data-delete]").forEach(function (b) {
        if (b.getAttribute("data-wired")) return;
        b.setAttribute("data-wired", "1");
        b.addEventListener("click", function () { if (window.confirm("Delete this comment?")) send("DELETE", { id: Number(b.getAttribute("data-delete")) }); });
      });
      // edit handled inline: replace body with an edit composer
      root.querySelectorAll("[data-edit]").forEach(function (b) {
        if (b.getAttribute("data-wired")) return;
        b.setAttribute("data-wired", "1");
        b.addEventListener("click", function () {
          b.insertAdjacentHTML("afterend", composer(null, b.getAttribute("data-edit-body"), b.getAttribute("data-edit")));
          wire();
        });
      });
    }
    await load();
  }

  ECBS.Comments = { renderCommentsHtml: renderCommentsHtml, init: init };

  if (typeof document !== "undefined") {
    var start = function () { var root = document.getElementById("ecbs-comments"); if (root) init(root); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
  }
})();
