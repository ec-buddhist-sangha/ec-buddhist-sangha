// site/static/js/posts.js
// window.ECBS.Posts — the Community Updates feed (events + announcements),
// backed by the worker's /api/posts. Reads are public; admins get an inline
// composer to create/edit/delete. Bodies are rendered as escaped plain text
// with line breaks preserved (no HTML is trusted), matching the comments model.
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
  function fmtDateTime(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  }
  function truncate(s, n) { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
  function detailHref(slug) { return join(siteBase(), "updates/view/") + "?slug=" + encodeURIComponent(slug); }
  function queryParam(name) {
    try { return new URLSearchParams(window.location.search).get(name); } catch (e) { return null; }
  }

  var EVENT_ICON = '<svg class="w-5 h-5 text-sangha-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>';
  var ANN_ICON = '<svg class="w-5 h-5 text-sangha-navy" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z"/></svg>';

  function tagPills(tags) {
    if (!tags || !tags.length) return "";
    return '<div class="flex items-center gap-2 mt-2 flex-wrap">' + tags.map(function (t) {
      return '<span class="text-xs font-medium text-sangha-gold bg-yellow-50 px-2 py-0.5 rounded-md border border-yellow-100">' + esc(t) + "</span>";
    }).join("") + "</div>";
  }

  function cardHtml(p) {
    var isEvent = p.kind === "event";
    var preview = p.summary || truncate(p.body, 200);
    var when = isEvent && p.start_at ? fmtDateTime(p.start_at) : fmtDate(p.published_at);
    return '<article class="update-card">' +
      '<div class="flex items-start gap-4">' +
        '<div class="w-12 h-12 bg-sangha-light rounded-full flex items-center justify-center flex-shrink-0">' + (isEvent ? EVENT_ICON : ANN_ICON) + "</div>" +
        '<div class="flex-1 min-w-0">' +
          '<div class="flex items-center gap-2 mb-1">' +
            '<span class="text-[10px] uppercase tracking-widest ' + (isEvent ? "text-sangha-gold" : "text-sangha-navy") + ' font-bold">' + (isEvent ? "Event" : "Announcement") + "</span>" +
            '<span class="text-gray-400 text-xs">&bull; ' + esc(when) + "</span>" +
          "</div>" +
          '<h3 class="font-serif text-lg font-bold text-sangha-navy mb-1">' +
            '<a href="' + detailHref(p.slug) + '" class="hover:text-sangha-gold transition-colors">' + esc(p.title) + "</a>" +
          "</h3>" +
          (isEvent && p.location ? '<p class="text-xs text-gray-500 mb-1">' + esc(p.location) + "</p>" : "") +
          '<p class="text-gray-600 text-sm leading-relaxed">' + esc(preview) + "</p>" +
        "</div>" +
      "</div>" +
    "</article>";
  }

  async function fetchPosts() {
    var res = await window.fetch(workerBase() + "/api/posts");
    if (!res.ok) throw new Error("posts_unavailable");
    return (await res.json()).posts || [];
  }
  async function fetchPost(slug) {
    var res = await window.fetch(workerBase() + "/api/posts/" + encodeURIComponent(slug));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error("post_unavailable");
    return (await res.json()).post;
  }

  // ---- Admin composer -------------------------------------------------------
  function composerHtml(post) {
    var p = post || {};
    var isEvent = p.kind === "event";
    return '<form data-post-form class="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 mb-6 grid gap-3">' +
      '<input type="hidden" name="id" value="' + esc(p.id || "") + '" />' +
      '<div class="grid sm:grid-cols-2 gap-3">' +
        '<label class="text-sm text-gray-600">Type' +
          '<select name="kind" class="mt-1 w-full border border-gray-300 rounded p-2 text-sm">' +
            '<option value="announcement"' + (isEvent ? "" : " selected") + ">Announcement</option>" +
            '<option value="event"' + (isEvent ? " selected" : "") + ">Event</option>" +
          "</select></label>" +
        '<label class="text-sm text-gray-600">Date' +
          '<input type="date" name="published_at" value="' + esc((p.published_at || "").slice(0, 10)) + '" class="mt-1 w-full border border-gray-300 rounded p-2 text-sm" /></label>' +
      "</div>" +
      '<label class="text-sm text-gray-600">Title' +
        '<input name="title" required maxlength="300" value="' + esc(p.title || "") + '" class="mt-1 w-full border border-gray-300 rounded p-2 text-sm" /></label>' +
      '<label class="text-sm text-gray-600">Summary' +
        '<input name="summary" maxlength="500" value="' + esc(p.summary || "") + '" class="mt-1 w-full border border-gray-300 rounded p-2 text-sm" /></label>' +
      '<div data-event-fields class="grid sm:grid-cols-3 gap-3" style="' + (isEvent ? "" : "display:none") + '">' +
        '<label class="text-sm text-gray-600">Location' +
          '<input name="location" value="' + esc(p.location || "") + '" class="mt-1 w-full border border-gray-300 rounded p-2 text-sm" /></label>' +
        '<label class="text-sm text-gray-600">Starts' +
          '<input type="datetime-local" name="start_at" value="' + esc(toLocalInput(p.start_at)) + '" class="mt-1 w-full border border-gray-300 rounded p-2 text-sm" /></label>' +
        '<label class="text-sm text-gray-600">Ends' +
          '<input type="datetime-local" name="end_at" value="' + esc(toLocalInput(p.end_at)) + '" class="mt-1 w-full border border-gray-300 rounded p-2 text-sm" /></label>' +
      "</div>" +
      '<label class="text-sm text-gray-600">Body' +
        '<textarea name="body" rows="6" maxlength="50000" class="mt-1 w-full border border-gray-300 rounded p-2 text-sm">' + esc(p.body || "") + "</textarea></label>" +
      '<label class="text-sm text-gray-600">Tags (comma-separated)' +
        '<input name="tags" value="' + esc((p.tags || []).join(", ")) + '" class="mt-1 w-full border border-gray-300 rounded p-2 text-sm" /></label>' +
      '<div class="flex gap-2">' +
        '<button type="submit" class="rounded bg-sangha-navy text-white text-sm px-4 py-2">Save</button>' +
        '<button type="button" data-post-cancel class="rounded border border-gray-300 text-gray-600 text-sm px-4 py-2">Cancel</button>' +
      "</div>" +
    "</form>";
  }
  function toLocalInput(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    var pad = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function fromLocalInput(v) { if (!v) return null; var d = new Date(v); return isNaN(d.getTime()) ? null : d.toISOString(); }
  function fromDateInput(v) { if (!v) return null; var d = new Date(v + "T12:00:00"); return isNaN(d.getTime()) ? null : d.toISOString(); }

  function readForm(form) {
    function val(n) { var el = form.querySelector('[name="' + n + '"]'); return el ? el.value : ""; }
    var kind = val("kind");
    var payload = {
      kind: kind,
      title: val("title").trim(),
      summary: val("summary").trim() || null,
      body: val("body"),
      tags: val("tags").split(",").map(function (t) { return t.trim(); }).filter(Boolean),
      published_at: fromDateInput(val("published_at"))
    };
    if (kind === "event") {
      payload.location = val("location").trim() || null;
      payload.start_at = fromLocalInput(val("start_at"));
      payload.end_at = fromLocalInput(val("end_at"));
    }
    var id = val("id");
    if (id) payload.id = Number(id);
    return payload;
  }

  function wireComposer(form, onDone) {
    var kindSel = form.querySelector('[name="kind"]');
    var eventFields = form.querySelector("[data-event-fields]");
    if (kindSel && eventFields) {
      kindSel.addEventListener("change", function () { eventFields.style.display = kindSel.value === "event" ? "" : "none"; });
    }
    var cancel = form.querySelector("[data-post-cancel]");
    if (cancel) cancel.addEventListener("click", function () { onDone(false); });
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var payload = readForm(form);
      if (!payload.title) return;
      var method = payload.id ? "PATCH" : "POST";
      var res = await ECBS.Auth.fetch(workerBase() + "/api/posts", {
        method: method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
      });
      if (res.ok) onDone(true, payload);
      else onDone(false, null, "Could not save. Please check the fields and try again.");
    });
  }

  // ---- Feed / list ----------------------------------------------------------
  async function renderFeed(root) {
    if (!root) return;
    var limit = Number(root.getAttribute("data-limit") || 0);
    var viewAll = root.getAttribute("data-view-all");
    var allowCreate = root.getAttribute("data-admin-create") === "1";
    var empty = root.getAttribute("data-empty") || "No updates yet. Check back soon!";
    var posts;
    try { posts = await fetchPosts(); }
    catch (e) { root.innerHTML = '<p class="text-sm text-red-600 text-center py-8">Updates are unavailable right now.</p>'; return; }
    if (limit > 0) posts = posts.slice(0, limit);

    function draw() {
      var cards = posts.length
        ? '<div class="grid gap-6">' + posts.map(cardHtml).join("") + "</div>"
        : '<p class="text-gray-500 text-center py-12">' + esc(empty) + "</p>";
      var viewAllLink = viewAll ? '<div class="text-center mt-8"><a href="' + esc(viewAll) + '" class="text-sangha-gold hover:text-yellow-600 font-bold text-sm uppercase tracking-widest">View All Updates →</a></div>' : "";
      root.innerHTML = '<div data-admin-slot></div>' + cards + viewAllLink;
      if (allowCreate && ECBS.Auth && ECBS.Auth.isAdmin && ECBS.Auth.isAdmin()) mountAdmin();
    }
    function mountAdmin() {
      var slot = root.querySelector("[data-admin-slot]");
      if (!slot) return;
      slot.innerHTML = '<div class="mb-6 text-right"><button type="button" data-new-post class="bg-sangha-navy text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-900 transition-colors">+ New update</button></div>';
      slot.querySelector("[data-new-post]").addEventListener("click", function () {
        slot.innerHTML = composerHtml(null);
        wireComposer(slot.querySelector("[data-post-form]"), async function (saved) {
          if (saved) { posts = await fetchPosts(); if (limit > 0) posts = posts.slice(0, limit); }
          draw();
        });
      });
    }
    draw();
    if (allowCreate && ECBS.Auth && ECBS.Auth.ready) { await ECBS.Auth.ready(); draw(); }
  }

  // ---- Detail ---------------------------------------------------------------
  async function renderDetail(root) {
    if (!root) return;
    var slug = queryParam("slug");
    if (!slug) { root.innerHTML = notFoundHtml(); return; }
    var post;
    try { post = await fetchPost(slug); }
    catch (e) { root.innerHTML = '<p class="text-sm text-red-600 text-center py-8">This update is unavailable right now.</p>'; return; }
    if (!post) { root.innerHTML = notFoundHtml(); return; }
    document.title = post.title + " | Community Updates";

    function draw() {
      var isEvent = post.kind === "event";
      var eventMeta = "";
      if (isEvent) {
        var bits = [];
        if (post.start_at) bits.push(fmtDateTime(post.start_at) + (post.end_at ? " – " + fmtDateTime(post.end_at) : ""));
        if (post.location) bits.push(post.location);
        if (bits.length) eventMeta = '<div class="text-sm text-sangha-navy font-medium mb-4">' + bits.map(esc).join(" · ") + "</div>";
      }
      root.innerHTML =
        '<a href="' + join(siteBase(), "updates/") + '" class="inline-flex items-center gap-1 text-sm text-sangha-gold hover:text-yellow-600 transition-colors mb-6"><svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>Back to Updates</a>' +
        '<div class="flex items-center gap-2 mb-2"><span class="text-[10px] uppercase tracking-widest ' + (isEvent ? "text-sangha-gold" : "text-sangha-navy") + ' font-bold">' + (isEvent ? "Event" : "Announcement") + '</span><span class="text-gray-400 text-xs">&bull; ' + esc(fmtDate(post.published_at)) + "</span></div>" +
        '<h1 class="font-serif text-3xl font-bold text-sangha-navy mb-3">' + esc(post.title) + "</h1>" +
        eventMeta +
        '<div class="bg-white rounded-2xl p-8 md:p-10 shadow-sm"><div class="text-gray-700 leading-relaxed" style="white-space:pre-wrap">' + esc(post.body) + "</div>" + tagPills(post.tags) + "</div>" +
        '<div data-admin-slot class="mt-4"></div>';
      if (ECBS.Auth && ECBS.Auth.isAdmin && ECBS.Auth.isAdmin()) mountAdmin();
    }
    function mountAdmin() {
      var slot = root.querySelector("[data-admin-slot]");
      if (!slot) return;
      slot.innerHTML = '<button type="button" data-edit class="text-sangha-navy underline text-sm mr-4">Edit</button><button type="button" data-delete class="text-red-600 underline text-sm">Delete</button>';
      slot.querySelector("[data-edit]").addEventListener("click", function () {
        slot.innerHTML = composerHtml(post);
        wireComposer(slot.querySelector("[data-post-form]"), async function (saved) {
          if (saved) { var fresh = await fetchPost(slug); if (fresh) post = fresh; }
          draw();
        });
      });
      slot.querySelector("[data-delete]").addEventListener("click", async function () {
        if (!window.confirm("Delete this update?")) return;
        var res = await ECBS.Auth.fetch(workerBase() + "/api/posts", {
          method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: post.id })
        });
        if (res.ok) window.location.href = join(siteBase(), "updates/");
      });
    }
    draw();
    if (ECBS.Auth && ECBS.Auth.ready) { await ECBS.Auth.ready(); draw(); }
  }

  function notFoundHtml() {
    return '<div class="text-center py-16"><p class="text-gray-500 mb-4">This update could not be found.</p>' +
      '<a href="' + join(siteBase(), "updates/") + '" class="text-sangha-gold hover:text-yellow-600 font-bold text-sm uppercase tracking-widest">Back to Updates →</a></div>';
  }

  ECBS.Posts = { renderFeed: renderFeed, renderDetail: renderDetail, cardHtml: cardHtml };

  if (typeof document !== "undefined") {
    var start = function () {
      var feed = document.getElementById("ecbs-updates");
      if (feed) renderFeed(feed);
      var detail = document.getElementById("ecbs-post");
      if (detail) renderDetail(detail);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
  }
})();
