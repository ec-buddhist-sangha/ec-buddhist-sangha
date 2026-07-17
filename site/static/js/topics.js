// site/static/js/topics.js
// window.ECBS.Topics — member-authored forum threads, backed by the worker's
// /api/topics. Reads are public; members/admins can start topics; the author
// (or an admin) can edit/delete. A topic's discussion lives in the comments
// thread "topic:<slug>". Bodies render as escaped plain text (no HTML trusted).
(function () {
  "use strict";
  var ECBS = (window.ECBS = window.ECBS || {});

  function meta(name) {
    var el = typeof document !== "undefined" ? document.querySelector('meta[name="' + name + '"]') : null;
    return el ? el.getAttribute("content") || "" : "";
  }
  function workerBase() { return (meta("ecbs:worker-base") || "").replace(/\/+$/, ""); }
  function siteBase() { return meta("ecbs:site-base") || "/"; }
  function join(base, path) { return (base || "/").replace(/\/+$/, "") + "/" + path; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtDate(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  }
  function truncate(s, n) { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
  function detailHref(slug) { return join(siteBase(), "topics/view/") + "?slug=" + encodeURIComponent(slug); }
  function queryParam(name) { try { return new URLSearchParams(window.location.search).get(name); } catch (e) { return null; } }

  var TAG_ICON = '<svg class="w-2.5 h-2.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M4 9l16 0M4 15l16 0M10 3l-2 18M16 3l-2 18"/></svg>';
  function tagPills(tags) {
    if (!tags || !tags.length) return "";
    return '<div class="flex items-center gap-2 mb-2 flex-wrap">' + tags.map(function (t) {
      return '<span class="inline-flex items-center gap-1 text-xs font-medium text-sangha-gold bg-yellow-50 px-2 py-1 rounded-md border border-yellow-100">' + TAG_ICON + esc(t) + "</span>";
    }).join("") + "</div>";
  }

  function sessionRole() { var s = ECBS.Auth && ECBS.Auth.getSession && ECBS.Auth.getSession(); return s ? s.role : null; }
  function canPost() { var r = sessionRole(); return r === "member" || r === "admin"; }
  // The topic API omits author_email (no PII), so manage-control visibility is a
  // heuristic: admins, or a signed-in member whose display name matches the
  // author. The worker still enforces owner/admin on every write (403 otherwise).
  function canManage(topic) {
    if (ECBS.Auth && ECBS.Auth.isAdmin && ECBS.Auth.isAdmin()) return true;
    var u = ECBS.Auth && ECBS.Auth.getUser && ECBS.Auth.getUser();
    return Boolean(u && sessionRole() === "member" && u.name === topic.author_name);
  }

  async function fetchTopics() {
    var res = await window.fetch(workerBase() + "/api/topics");
    if (!res.ok) throw new Error("topics_unavailable");
    return (await res.json()).topics || [];
  }
  async function fetchTopic(slug) {
    var res = await window.fetch(workerBase() + "/api/topics/" + encodeURIComponent(slug));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error("topic_unavailable");
    return (await res.json()).topic;
  }

  function rowHtml(t) {
    var replies = t.reply_count || 0;
    return '<a href="' + detailHref(t.slug) + '" class="block p-6 hover:bg-gray-50 transition-colors group">' +
      '<div class="flex items-start justify-between gap-4"><div class="flex-1 min-w-0">' +
        tagPills(t.tags) +
        '<h2 class="text-lg font-bold text-gray-800 group-hover:text-sangha-navy transition-colors mb-1">' + esc(t.title) + "</h2>" +
        '<p class="text-gray-600 text-sm mb-3">' + esc(truncate(t.body, 160)) + "</p>" +
        '<div class="flex items-center gap-4 text-xs text-gray-400">' +
          '<span class="font-medium text-gray-600">By ' + esc(t.author_name) + "</span>" +
          "<span>" + esc(fmtDate(t.last_active_at || t.created_at)) + "</span>" +
          "<span>" + replies + (replies === 1 ? " reply" : " replies") + "</span>" +
        "</div>" +
      "</div>" +
      '<div class="hidden sm:flex items-center text-gray-300 group-hover:translate-x-1 transition-transform mt-2"><svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg></div>' +
    "</div></a>";
  }

  // ---- Composer (create / edit) --------------------------------------------
  function composerHtml(topic) {
    var t = topic || {};
    return '<form data-topic-form class="bg-white rounded-xl p-6 shadow-sm border border-gray-200 mb-6 grid gap-3">' +
      '<input type="hidden" name="id" value="' + esc(t.id || "") + '" />' +
      '<label class="text-sm text-gray-600">Title' +
        '<input name="title" required maxlength="300" value="' + esc(t.title || "") + '" class="mt-1 w-full border border-gray-300 rounded p-2 text-sm" placeholder="What would you like to discuss?" /></label>' +
      '<label class="text-sm text-gray-600">Body' +
        '<textarea name="body" required rows="6" maxlength="50000" class="mt-1 w-full border border-gray-300 rounded p-2 text-sm" placeholder="Share your question or reflection…">' + esc(t.body || "") + "</textarea></label>" +
      '<label class="text-sm text-gray-600">Tags (comma-separated)' +
        '<input name="tags" value="' + esc((t.tags || []).join(", ")) + '" class="mt-1 w-full border border-gray-300 rounded p-2 text-sm" /></label>' +
      '<div class="flex gap-2">' +
        '<button type="submit" class="rounded bg-sangha-navy text-white text-sm px-4 py-2">' + (t.id ? "Save" : "Post topic") + "</button>" +
        '<button type="button" data-topic-cancel class="rounded border border-gray-300 text-gray-600 text-sm px-4 py-2">Cancel</button>' +
      "</div>" +
      '<div data-topic-error class="text-sm text-red-600"></div>' +
    "</form>";
  }
  function readForm(form) {
    function val(n) { var el = form.querySelector('[name="' + n + '"]'); return el ? el.value : ""; }
    var payload = {
      title: val("title").trim(),
      body: val("body"),
      tags: val("tags").split(",").map(function (s) { return s.trim(); }).filter(Boolean)
    };
    var id = val("id");
    if (id) payload.id = Number(id);
    return payload;
  }
  function wireComposer(form, onDone) {
    var cancel = form.querySelector("[data-topic-cancel]");
    if (cancel) cancel.addEventListener("click", function () { onDone(null); });
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var payload = readForm(form);
      if (!payload.title || !payload.body.trim()) return;
      var method = payload.id ? "PATCH" : "POST";
      var res = await ECBS.Auth.fetch(workerBase() + "/api/topics", {
        method: method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
      });
      if (res.ok) { onDone(await res.json().catch(function () { return {}; })); }
      else {
        var box = form.querySelector("[data-topic-error]");
        if (box) box.textContent = "Could not save. Please try again.";
      }
    });
  }

  // ---- List -----------------------------------------------------------------
  async function renderList(root) {
    if (!root) return;
    var topics;
    try { topics = await fetchTopics(); }
    catch (e) { root.innerHTML = '<p class="text-sm text-red-600 text-center py-8">The forum is unavailable right now.</p>'; return; }

    function draw() {
      var list = topics.length
        ? '<div class="grid grid-cols-1 divide-y divide-gray-100">' + topics.map(rowHtml).join("") + "</div>"
        : '<div class="p-12 text-center"><p class="text-gray-400 text-sm">No topics yet. Be the first to start a discussion!</p></div>';
      root.innerHTML = '<div data-compose-slot></div><div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">' + list + "</div>";
      mountCompose();
    }
    function mountCompose() {
      var slot = root.querySelector("[data-compose-slot]");
      if (!slot) return;
      var signedIn = ECBS.Auth && ECBS.Auth.isSignedIn && ECBS.Auth.isSignedIn();
      if (canPost()) {
        slot.innerHTML = '<div class="mb-6 text-right"><button type="button" data-new-topic class="bg-sangha-navy text-white px-4 py-2 rounded-lg inline-flex items-center gap-2 hover:bg-blue-900 transition-colors shadow-md text-sm font-medium"><svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg>New Topic</button></div>';
        slot.querySelector("[data-new-topic]").addEventListener("click", function () {
          slot.innerHTML = composerHtml(null);
          wireComposer(slot.querySelector("[data-topic-form]"), function (created) {
            if (created && created.slug) { window.location.href = detailHref(created.slug); }
            else { mountCompose(); }
          });
        });
      } else if (signedIn) {
        slot.innerHTML = '<div class="mb-6 text-right text-sm text-gray-500">Request access to start a topic.</div>';
      } else {
        slot.innerHTML = '<div class="mb-6 text-right text-sm text-gray-500">Sign in and request access to start a topic.</div>';
      }
    }
    draw();
    if (ECBS.Auth && ECBS.Auth.ready) { await ECBS.Auth.ready(); mountCompose(); }
  }

  // ---- Detail ---------------------------------------------------------------
  async function renderDetail(root) {
    if (!root) return;
    var slug = queryParam("slug");
    if (!slug) { root.innerHTML = notFoundHtml(); return; }
    var topic;
    try { topic = await fetchTopic(slug); }
    catch (e) { root.innerHTML = '<p class="text-sm text-red-600 text-center py-8">This topic is unavailable right now.</p>'; return; }
    if (!topic) { root.innerHTML = notFoundHtml(); return; }
    document.title = topic.title + " | Community Forum";

    function draw() {
      root.innerHTML =
        '<a href="' + join(siteBase(), "topics/") + '" class="inline-flex items-center gap-1 text-sm text-sangha-gold hover:text-yellow-600 transition-colors mb-6"><svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>Back to Forum</a>' +
        tagPills(topic.tags) +
        '<h1 class="font-serif text-3xl font-bold text-sangha-navy mb-3">' + esc(topic.title) + "</h1>" +
        '<div class="flex items-center gap-4 text-sm text-gray-400 mb-6"><span class="font-medium text-gray-600">By ' + esc(topic.author_name) + "</span><span>" + esc(fmtDate(topic.created_at)) + (topic.updated_at ? " (edited)" : "") + "</span></div>" +
        '<div class="bg-white rounded-2xl p-8 md:p-10 shadow-sm"><div class="text-gray-700 leading-relaxed" style="white-space:pre-wrap">' + esc(topic.body) + "</div></div>" +
        '<div data-manage-slot class="mt-4"></div>';
      if (canManage(topic)) mountManage();
    }
    function mountManage() {
      var slot = root.querySelector("[data-manage-slot]");
      if (!slot) return;
      slot.innerHTML = '<button type="button" data-edit class="text-sangha-navy underline text-sm mr-4">Edit</button><button type="button" data-delete class="text-red-600 underline text-sm">Delete</button>';
      slot.querySelector("[data-edit]").addEventListener("click", function () {
        slot.innerHTML = composerHtml(topic);
        wireComposer(slot.querySelector("[data-topic-form]"), async function (result) {
          if (result) { var fresh = await fetchTopic(slug); if (fresh) topic = fresh; }
          draw();
        });
      });
      slot.querySelector("[data-delete]").addEventListener("click", async function () {
        if (!window.confirm("Delete this topic?")) return;
        var res = await ECBS.Auth.fetch(workerBase() + "/api/topics", {
          method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: topic.id })
        });
        if (res.ok) window.location.href = join(siteBase(), "topics/");
      });
    }
    draw();
    if (ECBS.Auth && ECBS.Auth.ready) { await ECBS.Auth.ready(); draw(); }

    // Mount the discussion thread. We inject #ecbs-comments ourselves (rather
    // than leaving it in the page) so its thread is keyed to "topic:<slug>" —
    // the worker convention — instead of comments.js's page-path fallback.
    var host = document.getElementById("ecbs-topic-comments");
    if (host && ECBS.Comments && ECBS.Comments.init) {
      host.innerHTML =
        '<div class="container mx-auto px-4 max-w-3xl">' +
          '<h3 class="font-serif text-2xl font-bold text-sangha-navy mb-6">Discussion</h3>' +
          '<div id="ecbs-comments" data-thread="topic:' + esc(slug) + '"><p class="text-sm text-gray-500">Loading…</p></div>' +
        "</div>";
      ECBS.Comments.init(document.getElementById("ecbs-comments"));
    }
  }

  function notFoundHtml() {
    return '<div class="text-center py-16"><p class="text-gray-500 mb-4">This topic could not be found.</p>' +
      '<a href="' + join(siteBase(), "topics/") + '" class="text-sangha-gold hover:text-yellow-600 font-bold text-sm uppercase tracking-widest">Back to Forum →</a></div>';
  }

  ECBS.Topics = { renderList: renderList, renderDetail: renderDetail, rowHtml: rowHtml };

  if (typeof document !== "undefined") {
    var start = function () {
      var list = document.getElementById("ecbs-topics");
      if (list) renderList(list);
      var detail = document.getElementById("ecbs-topic");
      if (detail) renderDetail(detail);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
  }
})();
