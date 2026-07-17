// site/static/js/next-gathering.js
// window.ECBS.NextGathering — a homepage card showing the soonest upcoming
// gathering, read from the public /api/calendar projection. It considers both
// explicit dated slots and active recurrence rules (mirroring calendar.js's
// recurrenceMatchesDate logic) and renders the earliest of the two. If the
// calendar is empty or unavailable, the section removes itself (no empty box).
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
  function pad(n) { return String(n).padStart(2, "0"); }
  function parseDate(k) { var p = String(k || "").split("-"); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }
  function dateKey(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function nthWeekdayOfMonth(d) { return Math.ceil(d.getDate() / 7); }

  // Mirrors recurrenceMatchesDate() in calendar.js (weekly + monthly rules).
  function recurrenceMatchesDate(rule, date) {
    if (!rule || !rule.startDate) return false;
    if (dateKey(date) < rule.startDate) return false;
    var start = parseDate(rule.startDate);
    var interval = rule.interval || 1;
    if (rule.frequency === "weekly") {
      var diff = Math.round((date.getTime() - start.getTime()) / 86400000);
      return diff >= 0 && diff % (7 * interval) === 0;
    }
    if (rule.frequency === "monthly") {
      var md = (date.getFullYear() - start.getFullYear()) * 12 + (date.getMonth() - start.getMonth());
      if (md < 0 || md % interval !== 0) return false;
      if (rule.monthlyMode === "month-day") return date.getDate() === start.getDate();
      return date.getDay() === start.getDay() && nthWeekdayOfMonth(date) === nthWeekdayOfMonth(start);
    }
    return false;
  }

  var WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function fmtDate(k) { var d = parseDate(k); return WEEKDAYS[d.getDay()] + ", " + MONTHS[d.getMonth()] + " " + d.getDate(); }
  function fmtTime(t) {
    if (!t) return "";
    var p = String(t).split(":"); var h = Number(p[0]), m = Number(p[1] || 0);
    var ap = h >= 12 ? "PM" : "AM"; var h12 = h % 12; if (h12 === 0) h12 = 12;
    return h12 + (m ? ":" + pad(m) : "") + " " + ap;
  }
  function fmtRange(s, e) { var a = fmtTime(s), b = fmtTime(e); return a && b ? a + " – " + b : a || b; }
  function firstLine(s) { return String(s || "").split("\n")[0].trim(); }

  // Earliest upcoming gathering (today or later) across explicit slots and
  // active recurrences; returns null if nothing is scheduled.
  function nextGathering(store, todayKeyArg) {
    if (!store) return null;
    var todayKey = todayKeyArg || dateKey(new Date());
    var candidates = [];
    var slotByRecurrenceDate = {};
    (store.slots || []).forEach(function (s) {
      if (!s || !s.date) return;
      if (s.recurrenceId) slotByRecurrenceDate[s.recurrenceId + ":" + s.date] = true;
      if (s.date >= todayKey && s.status !== "cancelled") {
        candidates.push({ date: s.date, startTime: s.startTime, endTime: s.endTime, title: s.title || "Gathering", location: s.location });
      }
    });
    (store.recurrences || []).forEach(function (r) {
      if (!r || !r.active) return;
      var skipped = r.skippedDates || [];
      var startKey = todayKey < r.startDate ? r.startDate : todayKey;
      var cursor = parseDate(startKey);
      for (var i = 0; i < 366; i++) {
        var k = dateKey(cursor);
        if (recurrenceMatchesDate(r, cursor) && skipped.indexOf(k) === -1 && !slotByRecurrenceDate[r.id + ":" + k]) {
          candidates.push({ date: k, startTime: r.startTime, endTime: r.endTime, title: r.title || r.name || "Gathering", location: r.location });
          break;
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    });
    candidates.sort(function (a, b) {
      return (a.date + "T" + (a.startTime || "")).localeCompare(b.date + "T" + (b.startTime || ""));
    });
    return candidates[0] || null;
  }

  function cardHtml(g) {
    var when = fmtDate(g.date);
    var time = fmtRange(g.startTime, g.endTime);
    var loc = firstLine(g.location);
    return '<div class="container mx-auto px-4 max-w-5xl">' +
      '<div class="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 md:p-8 flex flex-col sm:flex-row sm:items-center gap-6">' +
        '<div class="flex-shrink-0 w-16 h-16 rounded-full bg-sangha-light text-sangha-gold flex items-center justify-center">' +
          '<svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>' +
        "</div>" +
        '<div class="flex-1 min-w-0">' +
          '<p class="text-[10px] uppercase tracking-widest text-sangha-gold font-bold mb-1">Next Gathering</p>' +
          '<h2 class="font-serif text-xl font-bold text-sangha-navy">' + esc(g.title) + "</h2>" +
          '<p class="text-gray-700 text-sm mt-1">' + esc(when) + (time ? " &bull; " + esc(time) : "") + "</p>" +
          (loc ? '<p class="text-gray-500 text-sm">' + esc(loc) + "</p>" : "") +
        "</div>" +
        '<div class="flex-shrink-0">' +
          '<a href="' + join(siteBase(), "calendar/") + '" class="inline-flex items-center gap-1 text-sangha-navy font-bold text-sm hover:text-sangha-gold transition-colors">See full calendar' +
            '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>' +
          "</a>" +
        "</div>" +
      "</div>" +
    "</div>";
  }

  async function render(root) {
    if (!root) return;
    var base = workerBase();
    if (!base) { root.remove(); return; }
    var store;
    try {
      var res = await window.fetch(base + "/api/calendar");
      if (!res.ok) throw new Error("calendar_unavailable");
      store = (await res.json()).store;
    } catch (e) { root.remove(); return; }
    var g = nextGathering(store);
    if (!g) { root.remove(); return; }
    root.innerHTML = cardHtml(g);
  }

  ECBS.NextGathering = { nextGathering: nextGathering, cardHtml: cardHtml };

  if (typeof document !== "undefined") {
    var start = function () { var root = document.getElementById("ecbs-next-gathering"); if (root) render(root); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
  }
})();
