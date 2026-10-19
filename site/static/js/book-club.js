(function () {
  "use strict";

  function nextMeeting(meetings, now) {
    return meetings.filter(function (meeting) {
      return Date.parse(meeting.end) > now;
    }).sort(function (a, b) { return Date.parse(a.start) - Date.parse(b.start); })[0] || null;
  }

  function formatDate(start) {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago", weekday: "long", month: "long", day: "numeric", year: "numeric"
    }).format(new Date(start));
  }

  function render(root, meetings, now) {
    var meeting = nextMeeting(meetings, now);
    root.replaceChildren();
    function add(tag, text, classes) {
      var element = document.createElement(tag);
      element.textContent = text;
      element.className = classes;
      root.appendChild(element);
      return element;
    }
    if (!meeting) {
      add("p", "More meeting dates and readings will be announced here. You're welcome to register for the series.", "text-gray-600 mt-3");
      return;
    }
    add("p", formatDate(meeting.start) + " · 7–7:30 p.m. Central", "text-gray-600 mt-3");
    add("h3", meeting.title, "font-serif text-xl md:text-2xl font-bold text-sangha-navy mt-2");
    add("p", meeting.pali + " · MN " + meeting.n, "text-gray-500 text-sm mt-2");
    var links = add("div", "", "flex flex-wrap gap-5 mt-5 text-sm font-bold");
    [["Read on SuttaCentral →", meeting.reading], ["Watch 10-Minute Majjhima →", meeting.video]].forEach(function (item) {
      if (!/^https:\/\//.test(item[1])) return;
      var link = document.createElement("a");
      link.href = item[1];
      link.textContent = item[0];
      link.className = "text-sangha-navy underline";
      links.appendChild(link);
    });
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { nextMeeting: nextMeeting, formatDate: formatDate, render: render };
  if (typeof document === "undefined") return;
  var root = document.getElementById("book-club-next");
  var data = document.getElementById("book-club-data");
  if (!root || !data) return;
  var meetings = JSON.parse(data.textContent).meetings;
  function refresh() { render(root, meetings, Date.now()); }
  refresh();
  window.setInterval(refresh, 60000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) refresh(); });
})();
