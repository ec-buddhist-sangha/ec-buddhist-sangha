const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

function loadApi() {
  const storage = new Map();
  const context = {
    URL,
    URLSearchParams,
    Date,
    Math,
    console,
    window: {
      location: {
        href: "http://127.0.0.1:1313/ec-buddhist-sangha/admin/calendar/",
        origin: "http://127.0.0.1:1313"
      },
      crypto: {
        randomUUID: () => "test-" + Math.random().toString(16).slice(2)
      },
      localStorage: {
        getItem: (key) => storage.has(key) ? storage.get(key) : null,
        setItem: (key, value) => storage.set(key, String(value))
      }
    },
    document: {
      addEventListener: () => {},
      getElementById: () => null
    },
    navigator: {}
  };
  context.window.window = context.window;
  vm.createContext(context);
  const scriptPath = path.join(__dirname, "..", "static", "js", "calendar.js");
  vm.runInContext(fs.readFileSync(scriptPath, "utf8"), context, { filename: scriptPath });
  const api = context.window.ECBSCalendarTest;
  api.__storage = storage;
  return api;
}

function loadDomApi(options = {}) {
  const url = options.url || "http://127.0.0.1:1313/ec-buddhist-sangha/admin/calendar/?month=2026-06";
  const localDev = options.localDev !== false;
  const dom = new JSDOM(
    `<!doctype html><html><body><div id="calendar-app" data-calendar-view="admin" data-calendar-base="http://127.0.0.1:1313/ec-buddhist-sangha/" data-calendar-local-dev="${localDev ? "true" : "false"}"></div></body></html>`,
    {
      runScripts: "outside-only",
      url
    }
  );
  dom.window.console = console;
  dom.window.scrollTo = () => {};
  const scriptPath = path.join(__dirname, "..", "static", "js", "calendar.js");
  dom.window.eval(fs.readFileSync(scriptPath, "utf8"));
  const api = dom.window.ECBSCalendarTest;
  api.__window = dom.window;
  api.__document = dom.window.document;
  api.__root = dom.window.document.getElementById("calendar-app");
  api.__setStore = (store) => dom.window.localStorage.setItem("ecbs-calendar-v1", JSON.stringify(api.normalizeStore(store)));
  api.__getStore = () => JSON.parse(dom.window.localStorage.getItem("ecbs-calendar-v1"));
  return api;
}

function dateKey(date) {
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}

test("signedUpPeople dedupes speaker and backup by email", () => {
  const api = loadApi();
  const slot = api.normalizeSlot({
    id: "slot-a",
    date: "2026-06-02",
    speaker: api.makeVolunteer("Avery Morgan", "", "", "2026-01-01T00:00:00.000Z", "avery@example.com"),
    backups: [
      api.makeVolunteer("Avery M", "", "", "2026-01-02T00:00:00.000Z", "avery@example.com"),
      api.makeVolunteer("Jordan Lee", "", "", "2026-01-03T00:00:00.000Z", "jordan@example.com")
    ]
  });

  const people = api.signedUpPeople(slot);

  assert.equal(people.length, 2);
  assert.deepEqual(Array.from(people.map((person) => person.email)), ["avery@example.com", "jordan@example.com"]);
});

test("attendance count includes speaker backups and attendees without duplicates", () => {
  const api = loadApi();
  const slot = api.normalizeSlot({
    id: "slot-a",
    date: "2026-06-02",
    speaker: api.makeVolunteer("Avery Morgan", "", "", "2026-01-01T00:00:00.000Z", "avery@example.com"),
    backups: [
      api.makeVolunteer("Jordan Lee", "", "", "2026-01-02T00:00:00.000Z", "jordan@example.com")
    ],
    attendees: [
      api.makeVolunteer("Avery M", "", "", "2026-01-03T00:00:00.000Z", "avery@example.com"),
      api.makeVolunteer("Maya Chen", "", "", "2026-01-04T00:00:00.000Z", "maya@example.com")
    ]
  });

  assert.equal(api.attendanceCount(slot), 3);
});

test("public attendee panel shows count without attendee names", () => {
  const api = loadApi();
  const slot = api.normalizeSlot({
    id: "slot-a",
    itemType: "meeting",
    date: "2026-06-02",
    attendees: [
      api.makeVolunteer("Maya Chen", "", "", "2026-01-04T00:00:00.000Z", "maya@example.com")
    ]
  });

  const html = api.renderAttendeeListPanel(slot);

  assert.match(html, /1 person attending/);
  assert.doesNotMatch(html, /Maya/);
  assert.doesNotMatch(html, /maya@example.com/);
});

test("calendar admin opens directly during local development", () => {
  const api = loadDomApi();

  assert.equal(api.hasCalendarAdminAccess(), true);
});

test("calendar admin local bypass is disabled outside Hugo local development", () => {
  const api = loadDomApi({
    localDev: false,
    url: "https://eauclairesangha.org/admin/calendar/"
  });

  assert.equal(api.hasCalendarAdminAccess(), false);
});

test("calendar admin local bypass requires the Hugo server marker even on localhost", () => {
  const api = loadDomApi({
    localDev: false,
    url: "http://127.0.0.1:1313/ec-buddhist-sangha/admin/calendar/"
  });

  assert.equal(api.hasCalendarAdminAccess(), false);
});

test("calendar admin ignores guessed cms query outside local development", () => {
  const api = loadDomApi({
    localDev: false,
    url: "https://eauclairesangha.org/admin/calendar/?cms=1"
  });

  assert.equal(api.hasCalendarAdminAccess(), false);
});

test("calendar admin accepts Decap session handoff outside local development", () => {
  const api = loadDomApi({
    localDev: false,
    url: "https://eauclairesangha.org/admin/calendar/"
  });
  api.__window.sessionStorage.setItem("ecbs-calendar-admin-access", String(Date.now()));

  assert.equal(api.hasCalendarAdminAccess(), true);
});

test("public regular meeting attend link opens details and auto-attends", () => {
  const api = loadDomApi();
  api.__window.localStorage.setItem("ecbs-calendar-current-user-name", "Current Member");
  api.__window.localStorage.setItem("ecbs-calendar-current-user-email", "current@example.com");
  api.__setStore({
    slots: [
      {
        id: "meeting-open",
        itemType: "meeting",
        date: "2026-06-03",
        title: "Regular meeting",
        attendees: []
      }
    ]
  });

  api.renderCalendar(api.__root, { year: 2026, month: 5 });

  const detailLink = api.__root.querySelector('a[href="/ec-buddhist-sangha/calendar-item/?slot=meeting-open"]');
  const attendLink = api.__root.querySelector('a[href*="slot=meeting-open"][href*="attend=1"]');
  assert.ok(detailLink);
  assert.ok(attendLink);
  assert.equal(attendLink.textContent.trim(), "Attend");

  api.__window.history.replaceState({}, "", "/ec-buddhist-sangha/calendar-item/?slot=meeting-open&attend=1");
  api.renderSchedule(api.__root);

  const slot = api.__getStore().slots.find((item) => item.id === "meeting-open");
  assert.equal(slot.attendees.length, 1);
  assert.equal(slot.attendees[0].name, "Current Member");
  assert.match(api.__root.textContent, /You Are Attending/);
});

test("calendar descriptions preserve newlines in tooltips and item pages", () => {
  const api = loadDomApi();
  const description = "First line\n\n\u25cf Second line\n\u25cf Third line";
  api.__setStore({
    slots: [
      { id: "slot-lines", date: "2026-06-02", title: "Line test", description, speaker: null, backups: [] }
    ]
  });

  api.renderAdmin(api.__root, { year: 2026, month: 5 });
  const calendarDescription = api.__root.querySelector("[data-admin-slot-id] .line-clamp-2 + .line-clamp-2");
  assert.equal(calendarDescription.getAttribute("title"), description);

  api.__window.history.replaceState({}, "", "/ec-buddhist-sangha/calendar-item/?slot=slot-lines");
  api.renderSchedule(api.__root);
  const backLink = api.__root.querySelector('a[href="/ec-buddhist-sangha/calendar/?month=2026-06"]');
  assert.equal(backLink.textContent.trim(), "Back To Calendar");
  const descriptionBlock = api.__root.querySelector("article p.text-gray-600");
  assert.match(descriptionBlock.getAttribute("style"), /white-space:\s*pre-line/);
  assert.match(descriptionBlock.textContent, /First line\n\n● Second line\n● Third line/);
});

test("admin calendar renders moved markers without blanking the page", () => {
  const api = loadApi();
  const noopControl = { addEventListener: () => {} };
  const root = {
    innerHTML: "",
    querySelector: (selector) => {
      if (selector === '[data-action="prev-month"]') return noopControl;
      if (selector === '[data-action="next-month"]') return noopControl;
      if (selector === '[data-action="today"]') return noopControl;
      return null;
    },
    querySelectorAll: () => []
  };

  api.__storage.set("ecbs-calendar-v1", JSON.stringify(api.normalizeStore({
    slots: [
      {
        id: "moved-marker",
        date: "2026-05-26",
        title: "Moved talk",
        description: "This meeting moved.",
        movedToDate: "2026-06-02",
        speaker: null,
        backups: []
      }
    ]
  })));

  assert.doesNotThrow(() => api.renderAdmin(root, { year: 2026, month: 4 }));
  assert.match(root.innerHTML, /Moved to 6\/2/);
  assert.match(root.innerHTML, /border-red-200 bg-red-50/);
  assert.match(root.innerHTML, /bg-red-100[^"]*text-red-700/);
});

test("admin cancel meeting buttons open confirmation and mark the item canceled", () => {
  const api = loadDomApi();
  api.__setStore({
    slots: [
      {
        id: "slot-cancel",
        date: "2026-06-02",
        title: "Cancel test talk",
        description: "Cancel this item.",
        speaker: null,
        backups: [],
        attendees: []
      }
    ]
  });

  api.renderAdmin(api.__root, { year: 2026, month: 5, selectedDate: "2026-06-02", selectedSlotId: "slot-cancel" });
  api.__root.querySelector("[data-cancel-meeting]").click();
  assert.match(api.__root.textContent, /Cancel Meeting/);
  assert.match(api.__root.textContent, /Mark as canceled/);
  assert.match(api.__root.textContent, /Remove from calendar/);
  assert.equal(api.__root.querySelector('[name="cancelMode"]:checked').value, "mark");
  assert.match(api.__root.querySelector('[aria-label="Cancel Meeting"]').parentElement.getAttribute("style"), /z-index:\s*60/);

  api.__root.querySelector("[data-confirm-admin-action]").click();
  const store = api.__getStore();
  const slot = store.slots.find((item) => item.id === "slot-cancel");

  assert.equal(slot.canceled, true);
  assert.match(api.__root.textContent, /Meeting canceled/);
  assert.match(api.__root.textContent, /This Meeting Is Canceled/);
});

test("admin cancel meeting can remove the item from the calendar", () => {
  const api = loadDomApi();
  api.__setStore({
    recurrences: [
      { id: "weekly-talks", name: "Weekly Talks", frequency: "weekly", startDate: "2026-06-02", itemType: "talk", active: true, skippedDates: [] }
    ],
    slots: [
      {
        id: "slot-remove",
        recurrenceId: "weekly-talks",
        generatedFromRecurrence: true,
        date: "2026-06-02",
        title: "Remove test talk",
        description: "Remove this item.",
        speaker: null,
        backups: [],
        attendees: []
      }
    ]
  });

  api.renderAdmin(api.__root, { year: 2026, month: 5, selectedDate: "2026-06-02", selectedSlotId: "slot-remove" });
  api.__root.querySelector("[data-cancel-meeting]").click();
  api.__root.querySelector('[name="cancelMode"][value="remove"]').checked = true;
  api.__root.querySelector("[data-confirm-admin-action]").click();
  const store = api.__getStore();

  assert.equal(store.slots.some((slot) => slot.id === "slot-remove"), false);
  assert.ok(store.recurrences[0].skippedDates.includes("2026-06-02"));
  assert.match(api.__root.textContent, /Calendar item removed/);
  assert.equal(api.__root.querySelector("[data-calendar-modal]"), null);
});

test("admin editor for a canceled item shows remove from calendar", () => {
  const api = loadDomApi();
  api.__setStore({
    recurrences: [
      { id: "weekly-talks", name: "Weekly Talks", frequency: "weekly", startDate: "2026-06-02", itemType: "talk", active: true, skippedDates: [] }
    ],
    slots: [
      {
        id: "slot-canceled",
        recurrenceId: "weekly-talks",
        generatedFromRecurrence: true,
        date: "2026-06-02",
        title: "Canceled talk",
        description: "Already canceled.",
        canceled: true,
        speaker: null,
        backups: [],
        attendees: []
      }
    ]
  });

  api.renderAdmin(api.__root, { year: 2026, month: 5, selectedDate: "2026-06-02", selectedSlotId: "slot-canceled" });
  assert.equal(api.__root.querySelector("[data-cancel-meeting]"), null);
  assert.ok(api.__root.querySelector("[data-remove-canceled-meeting]"));

  api.__root.querySelector("[data-remove-canceled-meeting]").click();
  assert.match(api.__root.textContent, /Remove From Calendar/);
  api.__root.querySelector("[data-confirm-admin-action]").click();
  const store = api.__getStore();

  assert.equal(store.slots.some((slot) => slot.id === "slot-canceled"), false);
  assert.ok(store.recurrences[0].skippedDates.includes("2026-06-02"));
});

test("admin push-forward button moves a recurring group with no confirmation when no one is signed up", () => {
  const api = loadDomApi();
  api.__setStore({
    recurrences: [
      { id: "weekly-talks", name: "Weekly Talks", frequency: "weekly", startDate: "2026-06-02", itemType: "talk", active: true }
    ],
    slots: [
      { id: "slot-a", recurrenceId: "weekly-talks", generatedFromRecurrence: true, date: "2026-06-02", title: "Talk A", speaker: null, backups: [] },
      { id: "slot-b", recurrenceId: "weekly-talks", generatedFromRecurrence: true, date: "2026-06-09", title: "Talk B", speaker: null, backups: [] }
    ]
  });

  api.renderAdmin(api.__root, { year: 2026, month: 5, selectedDate: "2026-06-02", selectedSlotId: "slot-a" });
  api.__root.querySelector("[data-push-week]").click();
  const store = api.__getStore();

  assert.ok(store.slots.some((slot) => slot.id === "slot-a" && slot.date === "2026-06-09"));
  assert.ok(store.slots.some((slot) => slot.id === "slot-b" && slot.date === "2026-06-16"));
  assert.ok(store.slots.some((slot) => slot.date === "2026-06-02" && slot.movedToDate === "2026-06-09"));
  assert.equal(store.slots.some((slot) => slot.date === "2026-06-09" && slot.movedToDate === "2026-06-16"), false);
  assert.match(api.__root.textContent, /Schedule moved forward one week/);
});

test("admin push-forward confirmation moves a recurring group when people are signed up", () => {
  const api = loadDomApi();
  api.__setStore({
    recurrences: [
      { id: "weekly-talks", name: "Weekly Talks", frequency: "weekly", startDate: "2026-06-02", itemType: "talk", active: true }
    ],
    slots: [
      {
        id: "slot-a",
        recurrenceId: "weekly-talks",
        generatedFromRecurrence: true,
        date: "2026-06-02",
        title: "Talk A",
        speaker: api.makeVolunteer("Mary Speaker", "", "", "2026-01-01T00:00:00.000Z", "mary@example.com"),
        backups: []
      },
      { id: "slot-b", recurrenceId: "weekly-talks", generatedFromRecurrence: true, date: "2026-06-09", title: "Talk B", speaker: null, backups: [] }
    ]
  });

  api.renderAdmin(api.__root, { year: 2026, month: 5, selectedDate: "2026-06-02", selectedSlotId: "slot-a" });
  api.__root.querySelector("[data-push-week]").click();
  assert.match(api.__root.textContent, /Cancel And Push Forward/);
  assert.match(api.__root.textContent, /Mary S\./);

  api.__root.querySelector("[data-confirm-admin-action]").click();
  const store = api.__getStore();
  const movedSlot = store.slots.find((slot) => slot.id === "slot-a");

  assert.equal(movedSlot.date, "2026-06-09");
  assert.ok(movedSlot.notifications.length > 0);
  assert.match(api.__root.textContent, /Schedule moved forward one week/);
});

test("regular meetings preserve blank descriptions", () => {
  const api = loadApi();
  const meetingSlot = api.normalizeSlot({
    id: "meeting-a",
    itemType: "meeting",
    date: "2026-06-02",
    title: "Regular meeting",
    description: ""
  });
  const meetingRecurrence = api.normalizeRecurrence({
    id: "monthly-meeting",
    itemType: "meeting",
    frequency: "monthly",
    startDate: "2026-06-16",
    title: "Monthly meeting",
    description: ""
  });

  assert.equal(meetingSlot.description, "");
  assert.equal(meetingRecurrence.description, "");
});

test("promoteBackupToSpeaker moves one backup into the speaker slot", () => {
  const api = loadApi();
  const backup = api.makeVolunteer("Jordan Lee", "https://example.com/talk", "Backup notes", "2026-01-03T00:00:00.000Z", "jordan@example.com");
  const slot = api.normalizeSlot({
    id: "slot-a",
    date: "2026-06-02",
    speaker: null,
    backups: [backup, api.makeVolunteer("Maya Chen", "", "", "2026-01-04T00:00:00.000Z", "maya@example.com")],
    attendees: [api.makeVolunteer("Jordan Lee", "", "", "2026-01-02T00:00:00.000Z", "jordan@example.com")]
  });

  api.promoteBackupToSpeaker(slot, backup);

  assert.equal(slot.speaker.name, "Jordan Lee");
  assert.equal(slot.speaker.email, "jordan@example.com");
  assert.deepEqual(Array.from(slot.backups.map((item) => item.name)), ["Maya Chen"]);
  assert.deepEqual(slot.attendees, []);
});

test("recurring push forward removes default duplicate slot and queues one consolidated notice per person", () => {
  const api = loadApi();
  const store = api.normalizeStore({
    recurrences: [
      { id: "weekly-talks", name: "Weekly Talks", frequency: "weekly", startDate: "2026-06-02", itemType: "talk", active: true }
    ],
    slots: [
      {
        id: "slot-a",
        recurrenceId: "weekly-talks",
        date: "2026-06-02",
        title: "Talk A",
        description: "Assigned talk",
        speaker: api.makeVolunteer("Avery Morgan", "", "", "2026-01-01T00:00:00.000Z", "avery@example.com"),
        backups: [],
        notifications: []
      },
      {
        id: "slot-b",
        recurrenceId: "weekly-talks",
        date: "2026-06-09",
        title: "Sangha Meeting",
        description: "Each 90 minute gathering is divided into 30 minute segments:\n\u25cf Group meditation with instruction for newcomers\n\u25cf Recorded Dharma talk from a teacher presented by one of the members\n\u25cf Open discussion about the teachings and meditation practice",
        speaker: null,
        backups: [],
        notifications: []
      }
    ],
    history: []
  });

  const notices = api.queuePushForwardNotifications(store, "2026-06-02", "weekly-talks", "slot-a");

  assert.equal(notices.length, 1);
  assert.equal(notices[0].toEmail, "avery@example.com");
  assert.equal(store.slots.filter((slot) => slot.date === "2026-06-09" && !slot.movedToDate).length, 1);
  assert.ok(store.slots.some((slot) => slot.id === "slot-a" && slot.date === "2026-06-09" && slot.movedFromDate === "2026-06-02"));
  assert.ok(store.slots.some((slot) => slot.date === "2026-06-02" && slot.movedToDate === "2026-06-09" && slot.canceled));
  assert.equal(store.slots.some((slot) => slot.date === "2026-06-09" && slot.movedToDate === "2026-06-16"), false);
});

test("one-time items cannot be pushed forward as a series", () => {
  const api = loadApi();
  const store = api.normalizeStore({
    slots: [
      {
        id: "slot-a",
        date: "2026-06-02",
        title: "One-time talk",
        description: "Assigned talk",
        speaker: api.makeVolunteer("Avery Morgan", "", "", "2026-01-01T00:00:00.000Z", "avery@example.com"),
        backups: [],
        notifications: []
      }
    ],
    history: []
  });

  const notices = api.queuePushForwardNotifications(store, "2026-06-02", "", "slot-a");

  assert.equal(notices.length, 0);
  assert.equal(store.slots[0].date, "2026-06-02");
  assert.equal(store.slots[0].notifications.length, 0);
});

test("push forward can move a recurring group without queuing email notices", () => {
  const api = loadApi();
  const store = api.normalizeStore({
    recurrences: [
      { id: "weekly-talks", name: "Weekly Talks", frequency: "weekly", startDate: "2026-06-02", itemType: "talk", active: true }
    ],
    slots: [
      {
        id: "slot-a",
        recurrenceId: "weekly-talks",
        date: "2026-06-02",
        title: "Talk A",
        description: "Assigned talk",
        speaker: api.makeVolunteer("Avery Morgan", "", "", "2026-01-01T00:00:00.000Z", "avery@example.com"),
        backups: [],
        notifications: []
      }
    ],
    history: []
  });

  const notices = api.queuePushForwardNotifications(store, "2026-06-02", "weekly-talks", "slot-a", false);

  assert.equal(notices.length, 0);
  assert.ok(store.slots.some((slot) => slot.id === "slot-a" && slot.date === "2026-06-09"));
  assert.ok(store.slots.some((slot) => slot.date === "2026-06-02" && slot.movedToDate === "2026-06-09"));
  assert.equal(store.slots.reduce((count, slot) => count + slot.notifications.length, 0), 0);
});

test("scheduleReminders does not duplicate already scheduled reminder options", () => {
  const api = loadApi();
  const slot = api.normalizeSlot({ id: "slot-a", date: "2026-06-02", reminders: [] });

  const first = api.scheduleReminders(slot, ["one-week", "one-day"]);
  const second = api.scheduleReminders(slot, ["one-week", "morning-of"]);

  assert.equal(first.length, 2);
  assert.equal(second.length, 1);
  assert.deepEqual(Array.from(slot.reminders.map((reminder) => reminder.optionId)), ["one-week", "one-day", "morning-of"]);
});

test("icsForSlot exports a calendar event with time and signup link", () => {
  const api = loadApi();
  const slot = api.normalizeSlot({
    id: "slot-a",
    date: "2026-06-02",
    startTime: "19:00",
    endTime: "20:30",
    title: "Metta in daily life",
    description: "A short recorded talk."
  });

  const ics = api.icsForSlot(slot);

  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /DTSTART:20260602T190000/);
  assert.match(ics, /DTEND:20260602T203000/);
  assert.match(ics, /SUMMARY:Metta in daily life/);
  assert.match(ics, /LOCATION:Unity of Eau Claire\\n1808 Folsom Street\\nEau Claire\\, WI 54703/);
  assert.match(ics, /calendar-item\/\?slot=slot-a/);
});

test("upcomingCalendarEmailText omits time and backup count", () => {
  const api = loadApi();
  const store = api.normalizeStore({
    slots: [
      {
        id: "slot-open",
        date: "2026-06-02",
        title: "Third Hindrance: Sloth & Torpor",
        description: "Talk slot",
        speaker: null,
        backups: []
      },
      {
        id: "slot-assigned",
        date: "2026-06-09",
        title: "Fourth Hindrance: Restlessness",
        description: "Talk slot",
        speaker: api.makeVolunteer("Chris Morgan", "", "", "2026-01-01T00:00:00.000Z", "chris@example.com"),
        backups: [api.makeVolunteer("Jordan Lee", "", "", "2026-01-02T00:00:00.000Z", "jordan@example.com")]
      }
    ]
  });

  const text = api.upcomingCalendarEmailText(store);

  assert.match(text, /Jun 2: Third Hindrance: Sloth & Torpor \(.*slot=slot-open.*\): volunteer to bring talk \(/);
  assert.match(text, /Jun 9: Fourth Hindrance: Restlessness \(.*slot=slot-assigned.*\): Chris M\./);
  assert.doesNotMatch(text, /volunteer as backup/);
  assert.doesNotMatch(text, /7:00 PM/);
  assert.doesNotMatch(text, /backup[s]? \|/);
});

test("upcomingCalendarEmailHtml styles names orange and links blue", () => {
  const api = loadApi();
  const store = api.normalizeStore({
    slots: [
      {
        id: "slot-open",
        date: "2026-06-02",
        title: "Third Hindrance: Sloth & Torpor",
        description: "Talk slot",
        speaker: null,
        backups: []
      },
      {
        id: "slot-assigned",
        date: "2026-06-09",
        title: "Fourth Hindrance: Restlessness",
        description: "Talk slot",
        speaker: api.makeVolunteer("Chris Morgan", "", "", "2026-01-01T00:00:00.000Z", "chris@example.com"),
        backups: []
      }
    ]
  });

  const html = api.upcomingCalendarEmailHtml(store);

  assert.match(html, /<a href="[^"]*slot=slot-open" style="color:inherit;text-decoration:none;">Third Hindrance: Sloth &amp; Torpor<\/a>/);
  assert.match(html, /<a href="[^"]*slot=slot-assigned" style="color:inherit;text-decoration:none;">Fourth Hindrance: Restlessness<\/a>/);
  assert.match(html, /<a href="[^"]*slot=slot-open" style="color:#2563eb;text-decoration:underline;">volunteer to bring talk<\/a>/);
  assert.doesNotMatch(html, /volunteer as backup/);
  assert.match(html, /<span style="color:#c76a00;font-weight:700;">Chris M\.<\/span>/);
});

test("calendar settings update future default locations only", () => {
  const api = loadApi();
  const store = api.normalizeStore({
    settings: { defaultLocation: "Old default" },
    recurrences: [
      { id: "default-rule", name: "Default Rule", startDate: "2026-06-02", useDefaultLocation: true, location: "Old default" },
      { id: "custom-rule", name: "Custom Rule", startDate: "2026-06-03", useDefaultLocation: false, location: "Custom place" }
    ],
    slots: [
      { id: "past-default", date: "2026-01-06", useDefaultLocation: true, location: "Old default", speaker: null, backups: [] },
      { id: "future-default", date: "2026-06-02", useDefaultLocation: true, location: "Old default", speaker: null, backups: [] },
      { id: "future-custom", date: "2026-06-09", useDefaultLocation: false, location: "Custom place", speaker: null, backups: [] }
    ]
  });

  api.applyCalendarSettingsUpdate(store, { defaultLocation: "New default", zoomLink: "https://zoom.example/j/123" });

  assert.equal(store.settings.defaultLocation, "New default");
  assert.equal(store.recurrences.find((rule) => rule.id === "default-rule").location, "New default");
  assert.equal(store.recurrences.find((rule) => rule.id === "custom-rule").location, "Custom place");
  assert.equal(store.slots.find((slot) => slot.id === "past-default").location, "Old default");
  assert.equal(store.slots.find((slot) => slot.id === "future-default").location, "New default");
  assert.equal(store.slots.find((slot) => slot.id === "future-custom").location, "Custom place");
});

test("calendar settings store signup window months", () => {
  const api = loadApi();
  const store = api.normalizeStore({
    settings: { defaultLocation: "Old default", signupWindowMonths: 1 },
    slots: []
  });

  api.applyCalendarSettingsUpdate(store, { defaultLocation: "Old default", signupWindowMonths: 3 });

  assert.equal(store.settings.signupWindowMonths, 3);
});

test("default calendar store seeds one weekly Sangha meeting recurrence with the next three talks", () => {
  const api = loadApi();
  const store = api.defaultCalendarStore();

  assert.equal(store.slots.length, 3);
  assert.equal(store.history.length, 0);
  assert.equal(store.recurrences.length, 1);
  assert.equal(store.recurrences[0].itemType, "talk");
  assert.equal(store.recurrences[0].frequency, "weekly");
  assert.equal(store.recurrences[0].startDate, "2026-05-26");
  assert.equal(store.recurrences[0].startTime, "19:00");
  assert.equal(store.recurrences[0].endTime, "20:30");
  assert.equal(store.settings.signupWindowMonths, 1);
  assert.deepEqual(
    Array.from(store.slots.map((slot) => ({ date: slot.date, title: slot.title, speaker: slot.speaker && slot.speaker.name }))),
    [
      { date: "2026-05-26", title: "Third Hindrance: Sloth & Torpor", speaker: "Chris" },
      { date: "2026-06-02", title: "Fourth Hindrance: Restlessness & Worry", speaker: null },
      { date: "2026-06-09", title: "Fifth Hindrance: Skeptical Doubt", speaker: "Mary" }
    ]
  );
});

test("calendar supports physical only zoom only and hybrid items", () => {
  const api = loadApi();
  const settings = { zoomLink: "https://zoom.example/j/123" };
  const physicalOnly = api.normalizeSlot({ id: "physical", date: "2026-06-02", usePhysicalLocation: true, useZoom: false, location: "Unity", speaker: null, backups: [] });
  const zoomOnly = api.normalizeSlot({ id: "zoom", date: "2026-06-03", usePhysicalLocation: false, useZoom: true, location: "", speaker: null, backups: [] });
  const hybrid = api.normalizeSlot({ id: "hybrid", date: "2026-06-04", usePhysicalLocation: true, useZoom: true, location: "Unity", speaker: null, backups: [] });

  assert.equal(api.zoomLinkForSlot(physicalOnly, settings), "");
  assert.equal(api.zoomLinkForSlot(zoomOnly, settings), "https://zoom.example/j/123");
  assert.equal(api.zoomLinkForSlot(hybrid, settings), "https://zoom.example/j/123");
  assert.doesNotMatch(api.icsForSlot(zoomOnly, settings), /LOCATION:/);
  assert.match(api.icsForSlot(hybrid, settings), /LOCATION:Unity/);
});

test("upcomingCalendarEmailText adds Zoom link when enabled", () => {
  const api = loadApi();
  const store = api.normalizeStore({
    settings: { zoomLink: "https://zoom.example/j/123" },
    slots: [
      {
        id: "slot-open",
        date: "2026-06-02",
        title: "Hybrid talk",
        useZoom: true,
        speaker: null,
        backups: []
      }
    ]
  });

  const text = api.upcomingCalendarEmailText(store);

  assert.match(text, /Zoom \(https:\/\/zoom.example\/j\/123\)/);
});

test("open volunteer panels require a logged in user", () => {
  const api = loadApi();
  const slot = api.normalizeSlot({
    id: "slot-open",
    date: "2026-06-02",
    title: "Open talk offering",
    speaker: null,
    backups: []
  });

  const html = api.renderPrimaryPanel(slot);

  assert.match(html, /Sign In Required/);
  assert.doesNotMatch(html, /Sign Up To Bring Talk/);
  assert.doesNotMatch(html, /Talk Already Claimed/);
});

test("future volunteer panels show when signups will open instead of the form", () => {
  const api = loadApi();
  api.__storage.set("ecbs-calendar-current-user-name", "Current Member");
  api.__storage.set("ecbs-calendar-current-user-email", "current.member@example.com");
  const slot = api.normalizeSlot({
    id: "slot-future",
    date: "2099-08-04",
    title: "Future talk",
    speaker: null,
    backups: []
  });

  const html = api.renderPrimaryPanel(slot, { signupWindowMonths: 1 });

  assert.match(html, /Will Open For Volunteers/);
  assert.match(html, /This will open for volunteers 1 month before/);
  assert.doesNotMatch(html, /id="talk-primary-form"/);
  assert.doesNotMatch(html, /Sign Up To Bring Talk/);
});

test("open volunteer panel uses current volunteer wording", () => {
  const api = loadApi();
  api.__storage.set("ecbs-calendar-current-user-name", "Current Member");
  api.__storage.set("ecbs-calendar-current-user-email", "current.member@example.com");
  const slot = api.normalizeSlot({
    id: "slot-open",
    date: "2026-06-02",
    title: "Fourth Hindrance: Restlessness & Worry",
    speaker: null,
    backups: []
  });

  const html = api.renderPrimaryPanel(slot, { signupWindowMonths: 1 });

  assert.match(html, />Volunteer<\/h3>/);
  assert.match(html, /30 minute recorded Dharma talk on <span class="font-bold text-sangha-navy">Fourth Hindrance: Restlessness &amp; Worry<\/span>/);
  assert.match(html, />Volunteer<\/button>/);
  assert.doesNotMatch(html, /Bring The Talk/);
  assert.doesNotMatch(html, /Sign Up To Bring Talk/);
});

test("assigned talk panel uses volunteer info wording", () => {
  const api = loadApi();
  const slot = api.normalizeSlot({
    id: "slot-assigned",
    date: "2026-06-02",
    title: "Assigned talk",
    speaker: api.makeVolunteer("Mary", "", "", "2026-01-01T00:00:00.000Z", ""),
    backups: []
  });

  const html = api.renderPrimaryPanel(slot, { signupWindowMonths: 1 });

  assert.match(html, /Volunteer Info/);
  assert.doesNotMatch(html, /Talk Already Claimed/);
});

test("open signup forms do not show reminder preferences before signup", () => {
  const api = loadApi();
  api.__storage.set("ecbs-calendar-current-user-name", "Current Member");
  api.__storage.set("ecbs-calendar-current-user-email", "current.member@example.com");
  const talkSlot = api.normalizeSlot({
    id: "slot-open",
    date: "2026-06-02",
    title: "Open talk offering",
    speaker: null,
    backups: []
  });
  const meetingSlot = api.normalizeSlot({
    id: "meeting-open",
    itemType: "meeting",
    date: "2026-06-02",
    title: "Regular meeting",
    attendees: []
  });

  assert.doesNotMatch(api.renderPrimaryPanel(talkSlot, { signupWindowMonths: 1 }), /Email Reminder Preferences/);
  assert.doesNotMatch(api.renderBackupPanel(talkSlot, "", { signupWindowMonths: 1 }), /Email Reminder Preferences/);
  assert.doesNotMatch(api.renderTalkAttendancePanel(talkSlot, null, { signupWindowMonths: 1 }), /Email Reminder Preferences/);
  assert.doesNotMatch(api.renderAttendancePanel(meetingSlot, null, { signupWindowMonths: 1 }), /Email Reminder Preferences/);
});

test("speaker panel lets the current speaker update talk details", () => {
  const api = loadApi();
  api.__storage.set("ecbs-calendar-current-user-name", "Current Member");
  api.__storage.set("ecbs-calendar-current-user-email", "current.member@example.com");
  const slot = api.normalizeSlot({
    id: "slot-speaker",
    date: "2026-06-02",
    speaker: api.makeVolunteer("Current Member", "https://example.com/talk", "Existing notes", "2026-01-01T00:00:00.000Z", "current.member@example.com"),
    backups: []
  });

  const html = api.renderPrimaryPanel(slot);

  assert.match(html, /id="talk-speaker-details-form"/);
  assert.match(html, /value="https:\/\/example.com\/talk"/);
  assert.match(html, /Existing notes/);
  assert.match(html, /Update Talk Details/);
});

test("speaker panel shows a confirmation with reminders and calendar export", () => {
  const api = loadApi();
  api.__storage.set("ecbs-calendar-current-user-name", "Current Member");
  api.__storage.set("ecbs-calendar-current-user-email", "current.member@example.com");
  const speaker = api.makeVolunteer("Current Member", "https://example.com/talk", "Existing notes", "2026-01-01T00:00:00.000Z", "current.member@example.com");
  speaker.reminders = ["one-week", "morning-of"];
  const slot = api.normalizeSlot({
    id: "slot-speaker-confirmed",
    date: "2026-06-02",
    startTime: "19:00",
    endTime: "20:30",
    speaker,
    backups: []
  });

  const html = api.renderPrimaryPanel(slot);

  assert.match(html, /Confirmed/);
  assert.match(html, /You are signed up to bring this talk/);
  assert.doesNotMatch(html, /One week before, Morning of/);
  assert.doesNotMatch(html, /Email Reminder Preferences/);
  assert.doesNotMatch(html, /Morning of the talk/);
  assert.doesNotMatch(html, /Email me before the meeting/);
  assert.doesNotMatch(html, /Add To Calendar/);
  assert.doesNotMatch(html, /download="calendar-2026-06-02\.ics"/);
});

test("backup panel lets the current backup update backup details", () => {
  const api = loadApi();
  api.__storage.set("ecbs-calendar-current-user-name", "Current Member");
  api.__storage.set("ecbs-calendar-current-user-email", "current.member@example.com");
  const slot = api.normalizeSlot({
    id: "slot-backup",
    date: "2026-06-02",
    speaker: null,
    backups: [
      api.makeVolunteer("Current Member", "https://example.com/backup", "Backup notes", "2026-01-01T00:00:00.000Z", "current.member@example.com")
    ]
  });

  const html = api.renderBackupPanel(slot, "");

  assert.match(html, /id="talk-backup-details-form"/);
  assert.match(html, /value="https:\/\/example.com\/backup"/);
  assert.match(html, /Backup notes/);
  assert.match(html, /Update Backup Details/);
  assert.match(html, /Cancel As Backup/);
  assert.doesNotMatch(html, /id="talk-backup-form"/);
});

test("backup panel shows a confirmation with update and cancel controls", () => {
  const api = loadApi();
  api.__storage.set("ecbs-calendar-current-user-name", "Current Member");
  api.__storage.set("ecbs-calendar-current-user-email", "current.member@example.com");
  const backup = api.makeVolunteer("Current Member", "", "", "2026-01-01T00:00:00.000Z", "current.member@example.com");
  backup.reminders = ["one-day"];
  const slot = api.normalizeSlot({
    id: "slot-backup-confirmed",
    date: "2026-06-02",
    speaker: null,
    backups: [backup]
  });

  const html = api.renderBackupPanel(slot, "");

  assert.match(html, /You are signed up as a backup/);
  assert.doesNotMatch(html, /One day before/);
  assert.doesNotMatch(html, /Email Reminder Preferences/);
  assert.doesNotMatch(html, /Three days before/);
  assert.match(html, /Update Backup Details/);
  assert.match(html, /Cancel As Backup/);
  assert.doesNotMatch(html, /Add To Calendar/);
});

test("cancelCurrentBackupSignup removes only the logged-in backup", () => {
  const api = loadApi();
  api.__storage.set("ecbs-calendar-current-user-name", "Current Member");
  const slot = api.normalizeSlot({
    id: "slot-backup",
    date: "2026-06-02",
    speaker: null,
    backups: [
      api.makeVolunteer("Current Member", "", "", "2026-01-01T00:00:00.000Z", "current.member@example.com"),
      api.makeVolunteer("Other Member", "", "", "2026-01-02T00:00:00.000Z", "other@example.com")
    ]
  });

  const canceled = api.cancelCurrentBackupSignup(slot);

  assert.equal(canceled.name, "Current Member");
  assert.deepEqual(Array.from(slot.backups.map((backup) => backup.name)), ["Other Member"]);
});

test("cancelCalendarItem marks the item canceled and queues signed-up notices once", () => {
  const api = loadApi();
  const slot = api.normalizeSlot({
    id: "meeting-cancel",
    itemType: "meeting",
    date: "2026-06-02",
    attendees: [
      api.makeVolunteer("Current Member", "", "", "2026-01-01T00:00:00.000Z", "current.member@example.com")
    ],
    notifications: []
  });

  assert.equal(api.cancelCalendarItem(slot), true);
  assert.equal(slot.canceled, true);
  assert.equal(slot.notifications.length, 1);
  assert.equal(api.cancelCalendarItem(slot), false);
  assert.equal(slot.notifications.length, 1);
});

test("regular meeting attendance requires a logged in user", () => {
  const api = loadApi();
  const slot = api.normalizeSlot({
    id: "meeting-a",
    itemType: "meeting",
    date: "2026-06-02",
    title: "Regular meeting",
    attendees: []
  });

  const html = api.renderAttendancePanel(slot, null);

  assert.match(html, /Sign In Required/);
  assert.doesNotMatch(html, /I&rsquo;m Attending/);
});

test("future attendance panels show when signups will open instead of the form", () => {
  const api = loadApi();
  api.__storage.set("ecbs-calendar-current-user-name", "Current Member");
  api.__storage.set("ecbs-calendar-current-user-email", "current.member@example.com");
  const slot = api.normalizeSlot({
    id: "meeting-future",
    itemType: "meeting",
    date: "2099-08-04",
    title: "Future meeting",
    attendees: []
  });

  const html = api.renderAttendancePanel(slot, null, { signupWindowMonths: 2 });

  assert.match(html, /Attendance Not Open Yet/);
  assert.match(html, /Attendance signups open 2 months before/);
  assert.doesNotMatch(html, /id="meeting-attendance-form"/);
  assert.doesNotMatch(html, /I&rsquo;m Attending/);
});

test("regular meeting attendance form uses click to attend label", () => {
  const api = loadApi();
  api.__storage.set("ecbs-calendar-current-user-name", "Current Member");
  api.__storage.set("ecbs-calendar-current-user-email", "current.member@example.com");
  const slot = api.normalizeSlot({
    id: "meeting-open",
    itemType: "meeting",
    date: "2026-06-03",
    title: "Regular meeting",
    attendees: []
  });

  const html = api.renderAttendancePanel(slot, null);

  assert.match(html, /Click To Attend/);
  assert.doesNotMatch(html, /I&rsquo;m Attending/);
});

test("regular meeting attendance panel confirms and allows reminder updates", () => {
  const api = loadApi();
  api.__storage.set("ecbs-calendar-current-user-name", "Current Member");
  api.__storage.set("ecbs-calendar-current-user-email", "current.member@example.com");
  const attendee = api.makeVolunteer("Current Member", "", "", "2026-01-01T00:00:00.000Z", "current.member@example.com");
  attendee.reminders = ["one-day"];
  const slot = api.normalizeSlot({
    id: "meeting-confirmed",
    itemType: "meeting",
    date: "2026-06-03",
    title: "Regular meeting",
    attendees: [attendee]
  });

  const html = api.renderAttendancePanel(slot, attendee);

  assert.match(html, /You are signed up to attend/);
  assert.doesNotMatch(html, /One day before/);
  assert.doesNotMatch(html, /Email Reminder Preferences/);
  assert.doesNotMatch(html, /You are listed as planning to attend this meeting/);
  assert.match(html, /Cancel Attendance/);
});

test("regular meeting detail places reminder preferences beside add to calendar", () => {
  const api = loadDomApi();
  api.__window.localStorage.setItem("ecbs-calendar-current-user-name", "Current Member");
  api.__window.localStorage.setItem("ecbs-calendar-current-user-email", "current.member@example.com");
  const attendee = api.makeVolunteer("Current Member", "", "", "2026-01-01T00:00:00.000Z", "current.member@example.com");
  attendee.reminders = ["one-day"];
  api.__setStore({
    slots: [
      {
        id: "meeting-confirmed",
        itemType: "meeting",
        date: "2026-06-03",
        title: "Regular meeting",
        attendees: [attendee]
      }
    ]
  });
  api.__window.history.replaceState({}, "", "/ec-buddhist-sangha/calendar-item/?slot=meeting-confirmed");

  api.renderSchedule(api.__root);

  assert.ok(api.__root.querySelector("article #personal-reminder-form"));
  assert.match(api.__root.querySelector("article").textContent, /Add To Calendar/);
  assert.match(api.__root.querySelector("article").textContent, /Email Reminder Preferences/);
  assert.doesNotMatch(api.__root.textContent, /You are listed as planning to attend this meeting/);
});

test("admin can assign people by name with optional email", () => {
  const api = loadApi();
  const talkSlot = api.normalizeSlot({
    id: "talk-a",
    date: "2026-06-02",
    speaker: null,
    backups: [api.makeVolunteer("Jordan Lee", "", "", "2026-01-01T00:00:00.000Z", "jordan@example.com")]
  });
  const meetingSlot = api.normalizeSlot({
    id: "meeting-a",
    itemType: "meeting",
    date: "2026-06-03",
    attendees: []
  });

  api.assignPersonToSlot(talkSlot, "speaker", "Jordan Lee", "");
  api.assignPersonToSlot(talkSlot, "backup", "Avery Morgan", "avery@example.com");
  api.assignPersonToSlot(talkSlot, "backup", "Bob", "");
  api.assignPersonToSlot(meetingSlot, "attendee", "Chris", "");

  assert.equal(talkSlot.speaker.name, "Jordan Lee");
  assert.equal(talkSlot.speaker.email, "");
  assert.deepEqual(Array.from(talkSlot.backups.map((backup) => backup.name)), ["Avery Morgan", "Bob"]);
  assert.equal(talkSlot.backups[0].email, "avery@example.com");
  assert.equal(talkSlot.backups[1].email, "");
  assert.equal(meetingSlot.attendees[0].name, "Chris");
  assert.equal(meetingSlot.attendees[0].email, "");
});

test("speaker and backup signup remove duplicate direct attendance", () => {
  const api = loadApi();
  const slot = api.normalizeSlot({
    id: "slot-role",
    date: "2026-06-02",
    speaker: null,
    backups: [],
    attendees: [
      api.makeVolunteer("Current Member", "", "", "2026-01-01T00:00:00.000Z", "current.member@example.com"),
      api.makeVolunteer("Other Member", "", "", "2026-01-01T00:00:00.000Z", "other@example.com")
    ]
  });

  api.assignPersonToSlot(slot, "backup", "Current Member", "current.member@example.com");

  assert.deepEqual(Array.from(slot.attendees.map((attendee) => attendee.name)), ["Other Member"]);
  assert.equal(slot.backups[0].name, "Current Member");

  api.assignPersonToSlot(slot, "speaker", "Other Member", "other@example.com");

  assert.deepEqual(Array.from(slot.attendees.map((attendee) => attendee.name)), []);
  assert.equal(slot.speaker.name, "Other Member");
});

test("calendar history keeps only the last 30 days", () => {
  const api = loadApi();
  const recent = new Date();
  const old = new Date();
  old.setDate(old.getDate() - 31);

  const store = api.normalizeStore({
    slots: [],
    recurrences: [],
    history: [
      { id: "old", at: old.toISOString(), action: "Old", summary: "Old history." },
      { id: "recent", at: recent.toISOString(), action: "Recent", summary: "Recent history." }
    ]
  });

  assert.deepEqual(Array.from(store.history.map((entry) => entry.id)), ["recent"]);
});

test("ensureRecurringSlots generates weekly and monthly start-date recurrence items", () => {
  const api = loadApi();
  const store = api.normalizeStore({
    slots: [],
    recurrences: [
      {
        id: "weekly-tuesday",
        name: "Weekly Sangha Meeting",
        itemType: "talk",
        frequency: "weekly",
        startDate: "2026-06-02",
        title: "Tuesday talk",
        description: "Talk",
        active: true
      },
      {
        id: "monthly-sixteenth",
        name: "Monthly Meeting",
        itemType: "meeting",
        frequency: "monthly",
        monthlyMode: "month-day",
        startDate: "2026-06-16",
        title: "Council meeting",
        description: "",
        active: true
      }
    ]
  });

  api.ensureRecurringSlots(store, 2026, 5);

  assert.ok(store.slots.some((slot) => slot.recurrenceId === "weekly-tuesday" && slot.date === "2026-06-02"));
  assert.ok(store.slots.some((slot) => slot.recurrenceId === "monthly-sixteenth" && slot.date === "2026-06-16" && slot.itemType === "meeting"));
});

test("monthly recurrences can repeat by nth weekday or day of month", () => {
  const api = loadApi();
  const store = api.normalizeStore({
    slots: [],
    recurrences: [
      {
        id: "third-tuesday",
        name: "Third Tuesday",
        itemType: "talk",
        frequency: "monthly",
        startDate: "2026-06-16",
        title: "Third Tuesday talk",
        description: "",
        active: true
      },
      {
        id: "sixteenth",
        name: "Sixteenth",
        itemType: "meeting",
        frequency: "monthly",
        monthlyMode: "month-day",
        startDate: "2026-06-16",
        title: "Sixteenth meeting",
        description: "",
        active: true
      }
    ]
  });

  api.ensureRecurringSlots(store, 2026, 6);

  assert.ok(store.slots.some((slot) => slot.recurrenceId === "third-tuesday" && slot.date === "2026-07-21"));
  assert.equal(store.slots.some((slot) => slot.recurrenceId === "third-tuesday" && slot.date === "2026-07-16"), false);
  assert.ok(store.slots.some((slot) => slot.recurrenceId === "sixteenth" && slot.date === "2026-07-16"));
});

test("normalizeRecurrence emits the current start-date rule shape", () => {
  const api = loadApi();
  const recurrence = api.normalizeRecurrence({
    id: "monthly",
    name: "Monthly Practice",
    itemType: "meeting",
    frequency: "monthly",
    startDate: "2026-06-16",
    startTime: "18:00",
    endTime: "19:00",
    title: "Practice meeting",
    description: "",
    active: true,
    skippedDates: []
  });

  assert.equal(recurrence.frequency, "monthly");
  assert.equal(recurrence.startDate, "2026-06-16");
  assert.equal(recurrence.itemType, "meeting");
  assert.deepEqual(Object.keys(recurrence), [
    "id",
    "name",
    "itemType",
    "frequency",
    "monthlyMode",
    "interval",
    "startDate",
    "startTime",
    "endTime",
    "title",
    "description",
    "usePhysicalLocation",
    "useDefaultLocation",
    "location",
    "useZoom",
    "active",
    "skippedDates",
    "createdAt",
    "updatedAt"
  ]);
});

test("individual recurring occurrence edits are tracked as overrides", () => {
  const api = loadApi();
  const recurrence = api.normalizeRecurrence({
    id: "weekly-talks",
    name: "Weekly Talks",
    frequency: "weekly",
    startDate: "2026-06-02",
    itemType: "talk",
    title: "Series title",
    description: "Series description",
    location: "Series location",
    active: true
  });
  const slot = api.normalizeSlot({
    id: "occurrence-a",
    recurrenceId: "weekly-talks",
    generatedFromRecurrence: true,
    date: "2026-06-02",
    title: "Custom title",
    description: "Custom description",
    location: "Series location",
    speaker: null,
    backups: []
  });

  api.updateOccurrenceOverrides(slot, recurrence);

  assert.deepEqual(Array.from(slot.occurrenceOverrides), ["title", "description"]);
});

test("recurrence edits preserve past generated meetings", () => {
  const api = loadApi();
  const store = api.normalizeStore({
    recurrences: [
      { id: "weekly-talks", name: "Weekly Talks", frequency: "weekly", startDate: "2026-01-06", itemType: "talk", active: true }
    ],
    slots: [
      { id: "past-empty", recurrenceId: "weekly-talks", generatedFromRecurrence: true, date: "2026-01-06", title: "Past generated", speaker: null, backups: [] },
      { id: "future-empty", recurrenceId: "weekly-talks", generatedFromRecurrence: true, date: "2026-06-02", title: "Future generated", speaker: null, backups: [] },
      {
        id: "future-signed",
        recurrenceId: "weekly-talks",
        generatedFromRecurrence: true,
        date: "2026-06-09",
        title: "Future signed",
        speaker: api.makeVolunteer("Avery Morgan", "", "", "2026-01-01T00:00:00.000Z", "avery@example.com"),
        backups: []
      },
      {
        id: "future-custom",
        recurrenceId: "weekly-talks",
        generatedFromRecurrence: true,
        occurrenceOverrides: ["title", "description"],
        date: "2026-06-16",
        title: "Custom occurrence title",
        description: "Custom occurrence description.",
        speaker: null,
        backups: []
      }
    ]
  });
  const editedRecurrence = api.normalizeRecurrence({
    id: "weekly-talks",
    name: "Weekly Talks",
    frequency: "weekly",
    startDate: "2026-06-03",
    itemType: "talk",
    active: true
  });

  api.updateEmptyGeneratedSlotsForRecurrence(store, editedRecurrence);

  assert.ok(store.slots.some((slot) => slot.id === "past-empty"));
  assert.equal(store.slots.some((slot) => slot.id === "future-empty"), false);
  assert.ok(store.slots.some((slot) => slot.id === "future-signed"));
  assert.ok(store.slots.some((slot) => slot.id === "future-custom" && slot.recurrenceId === "weekly-talks"));
});

test("recurrence date edits move future generated occurrences without duplicating the old pattern", () => {
  const api = loadApi();
  const previousRecurrence = api.normalizeRecurrence({
    id: "weekly-talks",
    name: "Weekly Talks",
    frequency: "weekly",
    startDate: "2026-05-26",
    itemType: "talk",
    title: "Open talk offering",
    description: "Old description",
    active: true
  });
  const editedRecurrence = api.normalizeRecurrence({
    id: "weekly-talks",
    name: "Weekly Talks",
    frequency: "weekly",
    startDate: "2026-05-27",
    itemType: "talk",
    title: "Open talk offering",
    description: "Updated description",
    active: true
  });
  const store = api.normalizeStore({
    recurrences: [previousRecurrence],
    slots: [
      { id: "future-empty", recurrenceId: "weekly-talks", generatedFromRecurrence: true, date: "2026-06-02", title: "Open talk offering", description: "Old description", speaker: null, backups: [] },
      {
        id: "future-signed",
        recurrenceId: "weekly-talks",
        generatedFromRecurrence: true,
        date: "2026-06-09",
        title: "Open talk offering",
        description: "Old description",
        speaker: api.makeVolunteer("Avery Morgan", "", "", "2026-01-01T00:00:00.000Z", "avery@example.com"),
        backups: []
      },
      {
        id: "future-custom",
        recurrenceId: "weekly-talks",
        generatedFromRecurrence: true,
        occurrenceOverrides: ["title"],
        date: "2026-06-16",
        title: "Custom talk title",
        description: "Old description",
        speaker: null,
        backups: []
      }
    ]
  });

  api.applyRecurrenceEditToGeneratedSlots(store, previousRecurrence, editedRecurrence);
  store.recurrences[0] = editedRecurrence;
  api.ensureRecurringSlots(store, 2026, 5);

  assert.equal(store.slots.some((slot) => slot.id === "future-empty"), false);
  assert.ok(store.slots.some((slot) => slot.id === "future-signed" && slot.date === "2026-06-10" && slot.speaker && slot.speaker.name === "Avery Morgan"));
  assert.ok(store.slots.some((slot) => slot.id === "future-custom" && slot.date === "2026-06-17" && slot.title === "Custom talk title" && slot.description === "Updated description"));
  assert.equal(store.slots.filter((slot) => slot.recurrenceId === "weekly-talks" && slot.date === "2026-06-09").length, 0);
  assert.equal(store.slots.filter((slot) => slot.recurrenceId === "weekly-talks" && slot.date === "2026-06-10").length, 1);
});

test("deleted recurrences keep historical items as one-time records", () => {
  const api = loadApi();
  const store = api.normalizeStore({
    recurrences: [
      { id: "weekly-talks", name: "Weekly Talks", frequency: "weekly", startDate: "2026-01-06", itemType: "talk", active: true }
    ],
    slots: [
      { id: "past-empty", recurrenceId: "weekly-talks", generatedFromRecurrence: true, date: "2026-01-06", title: "Past generated", speaker: null, backups: [] },
      {
        id: "future-signed",
        recurrenceId: "weekly-talks",
        generatedFromRecurrence: true,
        date: "2026-06-09",
        title: "Future signed",
        speaker: api.makeVolunteer("Avery Morgan", "", "", "2026-01-01T00:00:00.000Z", "avery@example.com"),
        backups: []
      }
    ]
  });

  api.detachSlotsFromRecurrence(store, "weekly-talks");

  assert.deepEqual(
    store.slots.map((slot) => ({ id: slot.id, recurrenceId: slot.recurrenceId, generatedFromRecurrence: slot.generatedFromRecurrence })),
    [
      { id: "past-empty", recurrenceId: "", generatedFromRecurrence: false },
      { id: "future-signed", recurrenceId: "", generatedFromRecurrence: false }
    ]
  );
  assert.deepEqual(store.slots.map((slot) => Array.from(slot.occurrenceOverrides)), [[], []]);
});

test("push forward only affects the selected recurring group", () => {
  const api = loadApi();
  const store = api.normalizeStore({
    recurrences: [
      { id: "tuesday-talks", name: "Tuesday Talks", frequency: "weekly", startDate: "2026-06-02", itemType: "talk", active: true },
      { id: "saturday-event", name: "Saturday Event", frequency: "weekly", startDate: "2026-06-06", itemType: "meeting", title: "Saturday sit", active: true }
    ],
    slots: [
      { id: "tue-1", recurrenceId: "tuesday-talks", generatedFromRecurrence: true, date: "2026-06-02", title: "Tuesday talk", description: "Talk", speaker: null, backups: [] },
      { id: "tue-2", recurrenceId: "tuesday-talks", generatedFromRecurrence: true, date: "2026-06-09", title: "Tuesday talk", description: "Talk", speaker: null, backups: [] },
      { id: "sat-1", recurrenceId: "saturday-event", generatedFromRecurrence: true, itemType: "meeting", date: "2026-06-06", title: "Saturday sit", description: "", attendees: [] }
    ]
  });

  api.queuePushForwardNotifications(store, "2026-06-02", "tuesday-talks", "tue-1");

  assert.ok(store.slots.some((slot) => slot.id === "tue-1" && slot.date === "2026-06-09"));
  assert.ok(store.slots.some((slot) => slot.id === "tue-2" && slot.date === "2026-06-16"));
  assert.ok(store.slots.some((slot) => slot.date === "2026-06-02" && slot.movedToDate === "2026-06-09"));
  assert.equal(store.slots.some((slot) => slot.date === "2026-06-09" && slot.movedToDate === "2026-06-16"), false);
  assert.ok(store.slots.some((slot) => slot.id === "sat-1" && slot.date === "2026-06-06"));
  const rule = store.recurrences.find((item) => item.id === "tuesday-talks");
  assert.ok(rule.skippedDates.includes("2026-06-02"));
  assert.ok(rule.skippedDates.includes("2026-06-09"));
});

test("talk admin modal collapses backup and attending sections by default", () => {
  const api = loadDomApi();
  api.__setStore({
    slots: [
      {
        id: "slot-admin",
        date: "2026-06-02",
        title: "Open talk",
        description: "Description",
        speaker: api.makeVolunteer("Current Member", "", "", "2026-01-01T00:00:00.000Z", "current.member@example.com"),
        backups: [api.makeVolunteer("Backup Member", "", "", "2026-01-01T00:00:00.000Z", "backup@example.com")],
        attendees: [api.makeVolunteer("Attendee Member", "", "", "2026-01-01T00:00:00.000Z", "attendee@example.com")]
      }
    ]
  });

  api.renderAdmin(api.__root, { year: 2026, month: 5, selectedDate: "2026-06-02", selectedSlotId: "slot-admin" });

  const backupSection = api.__root.querySelector('details[data-admin-section="backups"]');
  const attendingSection = api.__root.querySelector('details[data-admin-section="attending"]');
  assert.ok(backupSection);
  assert.ok(attendingSection);
  assert.equal(backupSection.open, false);
  assert.equal(attendingSection.open, false);
  assert.match(api.__root.textContent, /Who Is Bringing The Talk/);
});

test("admin item editor collapses location and saves from the bottom", () => {
  const api = loadDomApi();
  api.__setStore({
    slots: [
      { id: "slot-admin", date: "2026-06-02", title: "Open talk", description: "Description", speaker: null, backups: [] }
    ]
  });

  api.renderAdmin(api.__root, { year: 2026, month: 5, selectedDate: "2026-06-02", selectedSlotId: "slot-admin" });

  const locationSection = api.__root.querySelector('details[data-admin-section="item-location"]');
  const dateTimeRow = api.__root.querySelector('[data-calendar-modal] [data-admin-date-time-row]');
  const form = api.__root.querySelector("#talk-slot-form");
  const saveButton = api.__root.querySelector('button[form="talk-slot-form"]');
  assert.ok(dateTimeRow);
  assert.equal(dateTimeRow.querySelectorAll('input[name="date"], input[name="startTime"], input[name="endTime"]').length, 3);
  assert.ok(locationSection);
  assert.equal(locationSection.open, false);
  assert.equal(form.querySelector('button[type="submit"]'), null);
  assert.equal(saveButton.textContent, "Save And Close");

  form.querySelector('[name="title"]').value = "Saved from bottom";
  saveButton.click();

  assert.equal(api.__getStore().slots.find((slot) => slot.id === "slot-admin").title, "Saved from bottom");
  assert.equal(api.__root.querySelector("[data-calendar-modal]"), null);
});

test("admin utility sections are collapsed by default", () => {
  const api = loadDomApi();
  api.__setStore({
    recurrences: [
      { id: "weekly-talks", name: "Weekly Talks", frequency: "weekly", startDate: "2026-06-02", itemType: "talk", active: true }
    ],
    history: [
      { id: "history-a", at: new Date().toISOString(), action: "Speaker signed up", summary: "Mary signed up for this talk." }
    ],
    slots: [
      {
        id: "slot-notice",
        date: "2026-06-02",
        title: "Notice talk",
        speaker: null,
        backups: [],
        notifications: [
          { id: "notice-a", toName: "Backup Member", toEmail: "backup@example.com", subject: "Talk backup notice", link: "http://example.com/talk" }
        ]
      }
    ]
  });

  api.renderAdmin(api.__root, { year: 2026, month: 5 });

  const emailSection = api.__root.querySelector('details[data-admin-section="email-notices"]');
  const templatesSection = api.__root.querySelector('details[data-admin-section="email-templates"]');
  const historySection = api.__root.querySelector('details[data-admin-section="calendar-history"]');
  const allNodes = Array.from(api.__root.querySelectorAll("*"));
  assert.ok(emailSection);
  assert.equal(emailSection.open, false);
  assert.match(emailSection.className, /border-gray-200/);
  assert.doesNotMatch(emailSection.className, /border-blue-100/);
  assert.match(emailSection.textContent, /1 queued/);
  assert.ok(historySection);
  assert.ok(allNodes.indexOf(emailSection) < allNodes.indexOf(historySection));
  assert.ok(templatesSection);
  assert.equal(templatesSection.open, false);
  assert.match(templatesSection.textContent, /Talk Signup Confirmation/);
  assert.match(templatesSection.textContent, /Meeting Moved/);
  assert.equal(api.__root.querySelector('#calendar-settings-form [name="signupWindowMonths"]').value, "1");
  assert.equal(api.__root.querySelector('details[data-admin-section="zoom-settings"]').open, false);
  assert.equal(api.__root.querySelector('details[data-admin-section="recurrence-form"]').open, false);
  assert.equal(historySection.open, false);

  api.renderAdmin(api.__root, { year: 2026, month: 5, editRecurrenceId: "weekly-talks" });

  assert.equal(api.__root.querySelector('details[data-admin-section="recurrence-form"]').open, true);
});

test("saving a calendar item closes without opening item-level reminder prompts", () => {
  const api = loadDomApi();
  api.__setStore({
    slots: [
      { id: "slot-admin", date: "2026-06-02", title: "Open talk", description: "Description", speaker: null, backups: [] }
    ]
  });

  api.renderAdmin(api.__root, { year: 2026, month: 5, selectedDate: "2026-06-02", selectedSlotId: "slot-admin" });
  const form = api.__root.querySelector("#talk-slot-form");
  form.querySelector('[name="title"]').value = "Updated talk";
  form.dispatchEvent(new api.__window.Event("submit", { bubbles: true, cancelable: true }));

  assert.equal(api.__root.querySelector("#talk-reminder-form"), null);
  assert.equal(api.__getStore().slots.find((slot) => slot.id === "slot-admin").title, "Updated talk");
  assert.equal(api.__root.querySelector("[data-calendar-modal]"), null);
});

test("closing a dirty admin modal can save before closing", () => {
  const api = loadDomApi();
  api.__setStore({
    slots: [
      { id: "slot-admin", date: "2026-06-02", title: "Open talk", description: "Description", speaker: null, backups: [] }
    ]
  });
  api.__window.confirm = () => true;

  api.renderAdmin(api.__root, { year: 2026, month: 5, selectedDate: "2026-06-02", selectedSlotId: "slot-admin" });
  api.__root.querySelector("#talk-slot-form").querySelector('[name="title"]').value = "Saved on close";
  api.__root.querySelector("[data-close-admin-modal]").click();

  assert.equal(api.__getStore().slots.find((slot) => slot.id === "slot-admin").title, "Saved on close");
  assert.equal(api.__root.querySelector("[data-calendar-modal]"), null);
});

test("closing a dirty admin modal can discard changes", () => {
  const api = loadDomApi();
  api.__setStore({
    slots: [
      { id: "slot-admin", date: "2026-06-02", title: "Open talk", description: "Description", speaker: null, backups: [] }
    ]
  });
  api.__window.confirm = () => false;

  api.renderAdmin(api.__root, { year: 2026, month: 5, selectedDate: "2026-06-02", selectedSlotId: "slot-admin" });
  api.__root.querySelector("#talk-slot-form").querySelector('[name="title"]').value = "Discarded on close";
  api.__root.querySelector("[data-close-admin-modal]").click();

  assert.equal(api.__getStore().slots.find((slot) => slot.id === "slot-admin").title, "Open talk");
  assert.equal(api.__root.querySelector("[data-calendar-modal]"), null);
});

test("later open talks are not highlighted when the next meeting already has a speaker", () => {
  const api = loadDomApi();
  api.__setStore({
    recurrences: [
      { id: "inactive", name: "Inactive", frequency: "weekly", startDate: "2099-01-01", active: false }
    ],
    slots: [
      {
        id: "slot-next-assigned",
        date: "2026-06-02",
        title: "Assigned next gathering",
        speaker: api.makeVolunteer("Chris Walker", "", "", "2026-05-01T00:00:00.000Z", "chris@example.com"),
        backups: []
      },
      {
        id: "slot-later-open",
        date: "2026-06-09",
        title: "Later open gathering",
        speaker: null,
        backups: []
      }
    ]
  });

  api.renderAdmin(api.__root, { year: 2026, month: 5 });

  const nextAssigned = api.__root.querySelector('[data-admin-slot-id="slot-next-assigned"]');
  const laterOpen = api.__root.querySelector('[data-admin-slot-id="slot-later-open"]');
  assert.match(nextAssigned.outerHTML, /border-2 border-sangha-gold/);
  assert.doesNotMatch(laterOpen.outerHTML, /bg-green-600|border-green-600|bg-green-50/);
});

test("future month browsing does not move next-meeting highlight to the first visible item", () => {
  const api = loadDomApi();
  api.__setStore({
    recurrences: [
      { id: "inactive", name: "Inactive", frequency: "weekly", startDate: "2099-01-01", active: false }
    ],
    slots: [
      {
        id: "slot-actual-next",
        date: "2026-06-02",
        title: "Actual next gathering",
        speaker: api.makeVolunteer("Chris Walker", "", "", "2026-05-01T00:00:00.000Z", "chris@example.com"),
        backups: []
      },
      {
        id: "slot-future-open",
        date: "2026-08-04",
        title: "Future visible open gathering",
        speaker: null,
        backups: []
      }
    ]
  });

  api.renderAdmin(api.__root, { year: 2026, month: 7 });

  const futureOpen = api.__root.querySelector('[data-admin-slot-id="slot-future-open"]');
  assert.ok(futureOpen);
  assert.doesNotMatch(futureOpen.outerHTML, /border-2 border-sangha-gold/);
  assert.doesNotMatch(futureOpen.outerHTML, /bg-green-600/);
});

test("public calendar hides open signup buttons outside the signup window", () => {
  const api = loadDomApi();
  api.__setStore({
    settings: { signupWindowMonths: 1 },
    recurrences: [
      { id: "inactive", name: "Inactive", frequency: "weekly", startDate: "2099-01-01", active: false }
    ],
    slots: [
      {
        id: "slot-far-future-open",
        date: "2099-08-04",
        title: "Far future open gathering",
        speaker: null,
        backups: []
      }
    ]
  });

  api.renderCalendar(api.__root, { year: 2099, month: 7 });

  assert.match(api.__root.textContent, /Opens 1 month before/);
  assert.doesNotMatch(api.__root.textContent, /Open for volunteer/);
  assert.doesNotMatch(api.__root.textContent, /Sign up as backup/);
});

test("public calendar local development login sets and clears the mock user without storing password", () => {
  const api = loadDomApi();
  api.__setStore({
    recurrences: [
      { id: "inactive", name: "Inactive", frequency: "weekly", startDate: "2099-01-01", active: false }
    ],
    slots: []
  });

  api.renderCalendar(api.__root, {});

  const form = api.__root.querySelector("#local-dev-login-form");
  assert.ok(form);
  form.querySelector('[name="username"]').value = "Bob";
  form.querySelector('[name="password"]').value = "anything-local";
  form.dispatchEvent(new api.__window.Event("submit", { bubbles: true, cancelable: true }));

  assert.equal(api.__window.localStorage.getItem("ecbs-calendar-current-user-name"), "Bob");
  assert.equal(api.__window.localStorage.getItem("ecbs-calendar-current-user-email"), "bob@example.com");
  assert.equal(api.__window.localStorage.getItem("ecbs-calendar-current-user-password"), null);
  assert.match(api.__root.textContent, /Signed in as Bob/);

  api.__root.querySelector('[data-action="clear-local-dev-login"]').click();
  assert.equal(api.__window.localStorage.getItem("ecbs-calendar-current-user-name"), null);
  assert.match(api.__root.textContent, /Not signed in/);
});

test("mobile public calendar starts with today even when empty", () => {
  const api = loadDomApi();
  const today = dateKey(new Date());
  api.__setStore({
    recurrences: [
      { id: "inactive", name: "Inactive", frequency: "weekly", startDate: "2099-01-01", active: false }
    ],
    slots: [
      {
        id: "slot-tomorrow",
        date: api.shiftDateByDays(today, 1),
        title: "Tomorrow gathering",
        speaker: null,
        backups: []
      }
    ]
  });

  api.renderCalendar(api.__root, {});

  const todayBlock = api.__root.querySelector("[data-mobile-calendar-today]");
  const mobileSlots = api.__root.querySelectorAll("[data-mobile-calendar-slot]");
  assert.ok(todayBlock);
  assert.match(todayBlock.textContent, /Today/);
  assert.match(todayBlock.textContent, /No calendar items today/);
  assert.equal(mobileSlots.length, 1);
  assert.match(mobileSlots[0].textContent, /Tomorrow gathering/);
});

test("mobile public calendar paginates upcoming items by five with controls on top and bottom", () => {
  const api = loadDomApi();
  const today = dateKey(new Date());
  const slots = Array.from({ length: 7 }, (_, index) => ({
    id: "mobile-slot-" + index,
    date: api.shiftDateByDays(today, index + 1),
    title: "Mobile item " + index,
    speaker: null,
    backups: []
  }));
  api.__setStore({
    recurrences: [
      { id: "inactive", name: "Inactive", frequency: "weekly", startDate: "2099-01-01", active: false }
    ],
    slots
  });

  api.renderCalendar(api.__root, {});
  assert.equal(api.__root.querySelectorAll("[data-mobile-calendar-slot]").length, 4);
  assert.equal(api.__root.querySelectorAll('[data-action="next-mobile-page"]').length, 2);
  assert.match(api.__root.textContent, /Mobile item 0/);
  assert.doesNotMatch(api.__root.textContent, /Mobile item 4/);

  api.__root.querySelector('[data-action="next-mobile-page"]').click();
  assert.equal(api.__root.querySelector("[data-mobile-calendar-today]"), null);
  assert.equal(api.__root.querySelectorAll("[data-mobile-calendar-slot]").length, 3);
  assert.match(api.__root.textContent, /Mobile item 4/);
  assert.match(api.__root.textContent, /Mobile item 6/);
});

test("the next open talk gets a green action without green card framing", () => {
  const api = loadDomApi();
  api.__setStore({
    recurrences: [
      { id: "inactive", name: "Inactive", frequency: "weekly", startDate: "2099-01-01", active: false }
    ],
    slots: [
      {
        id: "slot-next-open",
        date: "2026-06-02",
        title: "Open next gathering",
        speaker: null,
        backups: []
      }
    ]
  });

  api.renderAdmin(api.__root, { year: 2026, month: 5 });

  const nextOpen = api.__root.querySelector('[data-admin-slot-id="slot-next-open"]');
  assert.match(nextOpen.outerHTML, /border-2 border-sangha-gold/);
  assert.match(nextOpen.outerHTML, /bg-green-600/);
  assert.doesNotMatch(nextOpen.outerHTML, /border-green-600|bg-green-50/);
});
