(function () {
  "use strict";

  var STORAGE_KEY = "ecbs-calendar-v1";
  var DEMO_SEEDED_KEY = "ecbs-calendar-demo-seeded-v1";
  var WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var FULL_WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var MONTH_LABELS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  var DEFAULT_START_TIME = "19:00";
  var DEFAULT_END_TIME = "20:30";
  var DEFAULT_TITLE = "Sangha Meeting";
  var DEFAULT_DESCRIPTION = "Each 90 minute gathering is divided into 30 minute segments:\n\u25cf Group meditation with instruction for newcomers\n\u25cf Recorded Dharma talk from a teacher presented by one of the members\n\u25cf Open discussion about the teachings and meditation practice";
  var DEFAULT_LOCATION = "Unity of Eau Claire\n1808 Folsom Street\nEau Claire, WI 54703";
  var DEFAULT_SIGNUP_WINDOW_MONTHS = 1;
  var DEFAULT_TUESDAY_RECURRENCE_ID = "default-weekly-tuesday-talks";
  var MONTHLY_MODE_WEEKDAY = "weekday";
  var MONTHLY_MODE_MONTH_DAY = "month-day";
  var CALENDAR_HISTORY_DAYS = 30;
  var CALENDAR_TITLE_LIMIT = 64;
  var CALENDAR_DESCRIPTION_LIMIT = 92;
  var MOBILE_CALENDAR_PAGE_SIZE = 5;
  var MOBILE_CALENDAR_MONTHS_AHEAD = 12;
  var ADMIN_ACCESS_KEY = "ecbs-calendar-admin-access";
  var ADMIN_ACCESS_MAX_AGE_MS = 8 * 60 * 60 * 1000;
  var REMINDER_OPTIONS = [
    { id: "one-week", label: "One week before", daysBefore: 7 },
    { id: "one-day", label: "One day before", daysBefore: 1 },
    { id: "morning-of", label: "Morning of", daysBefore: 0 }
  ];
  var appBaseUrl = null;
  var localDevelopmentPage = false;
  var modalScrollLock = null;

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function dateKey(date) {
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
  }

  function parseDate(dateValue) {
    return new Date(dateValue + "T12:00:00");
  }

  function displayDate(dateValue) {
    var date = parseDate(dateValue);
    return WEEKDAY_LABELS[date.getDay()] + ", " + MONTH_LABELS[date.getMonth()] + " " + date.getDate() + ", " + date.getFullYear();
  }

  function displayShortDate(dateValue) {
    var date = parseDate(dateValue);
    return MONTH_LABELS[date.getMonth()].slice(0, 3) + " " + date.getDate();
  }

  function displayNumericShortDate(dateValue) {
    var date = parseDate(dateValue);
    return (date.getMonth() + 1) + "/" + date.getDate();
  }

  function calendarDayLabel(day) {
    var isToday = dateKey(day) === dateKey(new Date());
    return '<span class="lg:hidden text-[11px] uppercase text-gray-400">' + WEEKDAY_LABELS[day.getDay()] + '</span> ' +
      '<span class="text-[11px] uppercase text-gray-400">' + MONTH_LABELS[day.getMonth()].slice(0, 3) + '</span> ' +
      '<span class="text-sm md:text-base">' + day.getDate() + '</span>' +
      (isToday ? ' <span class="ml-2 inline-flex items-center gap-1 align-middle text-[10px] uppercase tracking-widest font-bold text-green-700"><span class="h-2 w-2 rounded-full bg-green-600"></span>Today</span>' : '');
  }

  function displayTime(timeValue) {
    if (!timeValue) return "Time TBD";
    var parts = timeValue.split(":");
    var hour = Number(parts[0]);
    var minute = parts[1] || "00";
    var suffix = hour >= 12 ? "PM" : "AM";
    var hour12 = hour % 12 || 12;
    return hour12 + ":" + minute + " " + suffix;
  }

  function displayTimeRange(slot) {
    return displayTime(slot.startTime || DEFAULT_START_TIME) + " - " + displayTime(slot.endTime || DEFAULT_END_TIME);
  }

  function isPastSlot(slot) {
    return slot.date < dateKey(new Date());
  }

  function publicName(name) {
    if (!name) return "";
    var words = name.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return "";
    if (words.length === 1) return words[0];
    return words[0] + " " + words[words.length - 1].charAt(0).toUpperCase() + ".";
  }

  function uid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return "slot-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  function hasOwnValue(source, key) {
    return Object.prototype.hasOwnProperty.call(source || {}, key);
  }

  function textValueOrDefault(source, key, defaultValue) {
    if (!hasOwnValue(source, key)) return defaultValue;
    return source[key] == null ? "" : String(source[key]);
  }

  function uniqueStrings(values) {
    var seen = {};
    return (Array.isArray(values) ? values : []).map(function (value) {
      return String(value || "").trim();
    }).filter(function (value) {
      if (!value || seen[value]) return false;
      seen[value] = true;
      return true;
    });
  }

  function defaultCalendarSettings() {
    return {
      defaultLocation: DEFAULT_LOCATION,
      signupWindowMonths: DEFAULT_SIGNUP_WINDOW_MONTHS,
      zoomName: "",
      zoomEmail: "",
      zoomLink: ""
    };
  }

  function normalizeSignupWindowMonths(value) {
    var months = Number(value);
    if (!Number.isFinite(months)) return DEFAULT_SIGNUP_WINDOW_MONTHS;
    return Math.max(1, Math.min(24, Math.floor(months)));
  }

  function normalizeCalendarSettings(settings) {
    settings = settings || {};
    return {
      defaultLocation: textValueOrDefault(settings, "defaultLocation", DEFAULT_LOCATION) || DEFAULT_LOCATION,
      signupWindowMonths: normalizeSignupWindowMonths(settings.signupWindowMonths),
      zoomName: textValueOrDefault(settings, "zoomName", ""),
      zoomEmail: textValueOrDefault(settings, "zoomEmail", ""),
      zoomLink: textValueOrDefault(settings, "zoomLink", "")
    };
  }

  function defaultCalendarStore() {
    return normalizeStore({
      slots: defaultSeedTalkSlots(),
      recurrences: [defaultTuesdayRecurrence()],
      history: [],
      settings: defaultCalendarSettings()
    });
  }

  function inferUseDefaultLocation(source) {
    if (hasOwnValue(source, "useDefaultLocation")) return source.useDefaultLocation !== false;
    if (hasOwnValue(source, "location")) {
      var location = String(source.location || "").trim();
      return !location || location === DEFAULT_LOCATION;
    }
    return true;
  }

  function inferUsePhysicalLocation(source) {
    if (hasOwnValue(source, "usePhysicalLocation")) return source.usePhysicalLocation !== false;
    return Boolean(String(source && source.location || "").trim()) || !Boolean(source && source.useZoom);
  }

  function applyDefaultLocationSettings(store) {
    var settings = normalizeCalendarSettings(store.settings);
    store.settings = settings;
    store.recurrences.forEach(function (rule) {
      if (rule.usePhysicalLocation !== false && rule.useDefaultLocation !== false) rule.location = settings.defaultLocation;
    });
    store.slots.forEach(function (slot) {
      if (slot.usePhysicalLocation !== false && slot.useDefaultLocation !== false && !isPastSlot(slot)) slot.location = settings.defaultLocation;
    });
    return store;
  }

  function applyCalendarSettingsUpdate(store, settings) {
    store.settings = normalizeCalendarSettings(settings);
    return applyDefaultLocationSettings(store);
  }

  function loadStore() {
    try {
      var raw = window.localStorage && window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultCalendarStore();
      var parsed = JSON.parse(raw);
      return normalizeStore(parsed);
    } catch (error) {
      return defaultCalendarStore();
    }
  }

  function saveStore(store) {
    if (window.localStorage) {
      var normalized = normalizeStore(store);
      normalized.revision = Number(store.revision || 0) + 1;
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    }
  }

  function normalizeStore(store) {
    store = store || {};
    var settings = normalizeCalendarSettings(store.settings);
    var recurrences = Array.isArray(store.recurrences) ? store.recurrences.map(normalizeRecurrence) : [];
    if (!recurrences.length) recurrences.push(defaultTuesdayRecurrence());
    return applyDefaultLocationSettings({
      revision: Number(store.revision || 0),
      slots: Array.isArray(store.slots) ? store.slots.map(normalizeSlot) : [],
      recurrences: recurrences,
      settings: settings,
      history: recentCalendarHistory(store.history)
    });
  }

  function normalizeSlot(slot) {
    slot = slot || {};
    var itemType = slot.itemType || "talk";
    var usePhysicalLocation = inferUsePhysicalLocation(slot);
    return {
      id: slot.id || uid(),
      date: slot.date,
      startTime: slot.startTime || DEFAULT_START_TIME,
      endTime: slot.endTime || DEFAULT_END_TIME,
      itemType: itemType,
      recurrenceId: slot.recurrenceId || "",
      generatedFromRecurrence: Boolean(slot.generatedFromRecurrence),
      occurrenceOverrides: uniqueStrings(slot.occurrenceOverrides),
      isDraft: Boolean(slot.isDraft),
      title: slot.title || DEFAULT_TITLE,
      description: textValueOrDefault(slot, "description", itemType === "meeting" ? "" : DEFAULT_DESCRIPTION),
      usePhysicalLocation: usePhysicalLocation,
      useDefaultLocation: inferUseDefaultLocation(slot),
      location: usePhysicalLocation ? (slot.location || DEFAULT_LOCATION) : "",
      useZoom: Boolean(slot.useZoom),
      canceled: Boolean(slot.canceled),
      movedToDate: slot.movedToDate || "",
      movedFromDate: slot.movedFromDate || "",
      speaker: slot.speaker && slot.speaker.name ? normalizeVolunteer(slot.speaker) : null,
      backups: Array.isArray(slot.backups) ? slot.backups.map(normalizeVolunteer) : [],
      attendees: Array.isArray(slot.attendees) ? slot.attendees.map(normalizeVolunteer) : [],
      notifications: Array.isArray(slot.notifications) ? slot.notifications.map(normalizeNotification) : [],
      reminders: Array.isArray(slot.reminders) ? slot.reminders.map(normalizeReminder) : [],
      revision: Number(slot.revision || 0),
      updatedAt: slot.updatedAt || ""
    };
  }

  function normalizeVolunteer(volunteer) {
    var name = volunteer.name || "";
    return {
      name: name,
      email: volunteer.email || "",
      link: volunteer.link || "",
      notes: volunteer.notes || "",
      reminders: uniqueStrings(volunteer.reminders),
      signedUpAt: volunteer.signedUpAt || new Date().toISOString()
    };
  }

  function defaultTuesdayRecurrence() {
    return normalizeRecurrence({
      id: DEFAULT_TUESDAY_RECURRENCE_ID,
      name: "Weekly Sangha Meeting",
      itemType: "talk",
      frequency: "weekly",
      interval: 1,
      startDate: "2026-05-26",
      startTime: DEFAULT_START_TIME,
      endTime: DEFAULT_END_TIME,
      title: DEFAULT_TITLE,
      description: DEFAULT_DESCRIPTION,
      usePhysicalLocation: true,
      useDefaultLocation: true,
      location: DEFAULT_LOCATION,
      useZoom: false,
      active: true,
      skippedDates: []
    });
  }

  function defaultSeedTalkSlots() {
    return [
      defaultSeedTalkSlot("seed-talk-2026-05-26", "2026-05-26", "Third Hindrance: Sloth & Torpor", makeVolunteer("Chris", "", "", "2026-05-01T12:00:00.000Z", "chris@example.com")),
      defaultSeedTalkSlot("seed-talk-2026-06-02", "2026-06-02", "Fourth Hindrance: Restlessness & Worry", null),
      defaultSeedTalkSlot("seed-talk-2026-06-09", "2026-06-09", "Fifth Hindrance: Skeptical Doubt", makeVolunteer("Mary", "", "", "2026-05-01T12:05:00.000Z", "mary@example.com"))
    ];
  }

  function defaultSeedTalkSlot(id, dateValue, title, speaker) {
    return {
      id: id,
      date: dateValue,
      startTime: DEFAULT_START_TIME,
      endTime: DEFAULT_END_TIME,
      itemType: "talk",
      recurrenceId: DEFAULT_TUESDAY_RECURRENCE_ID,
      generatedFromRecurrence: true,
      occurrenceOverrides: ["title"],
      title: title,
      description: DEFAULT_DESCRIPTION,
      usePhysicalLocation: true,
      useDefaultLocation: true,
      location: DEFAULT_LOCATION,
      useZoom: false,
      canceled: false,
      speaker: speaker,
      backups: [],
      attendees: [],
      notifications: []
    };
  }

  function normalizeRecurrence(rule) {
    rule = rule || {};
    var startDate = rule.startDate && /^\d{4}-\d{2}-\d{2}$/.test(rule.startDate) ? rule.startDate : dateKey(new Date());
    var itemType = rule.itemType || "talk";
    var frequency = rule.frequency || "weekly";
    var monthlyMode = rule.monthlyMode === MONTHLY_MODE_MONTH_DAY ? MONTHLY_MODE_MONTH_DAY : MONTHLY_MODE_WEEKDAY;
    var usePhysicalLocation = inferUsePhysicalLocation(rule);
    return {
      id: rule.id || uid(),
      name: rule.name || "Recurring meeting",
      itemType: itemType,
      frequency: frequency === "monthly" ? "monthly" : "weekly",
      monthlyMode: monthlyMode,
      interval: Math.max(1, Number(rule.interval || 1)),
      startDate: startDate,
      startTime: rule.startTime || DEFAULT_START_TIME,
      endTime: rule.endTime || DEFAULT_END_TIME,
      title: rule.title || (itemType === "meeting" ? "Regular meeting" : DEFAULT_TITLE),
      description: textValueOrDefault(rule, "description", itemType === "meeting" ? "" : DEFAULT_DESCRIPTION),
      usePhysicalLocation: usePhysicalLocation,
      useDefaultLocation: inferUseDefaultLocation(rule),
      location: usePhysicalLocation ? (rule.location || DEFAULT_LOCATION) : "",
      useZoom: Boolean(rule.useZoom),
      active: rule.active !== false,
      skippedDates: Array.isArray(rule.skippedDates) ? rule.skippedDates.slice() : [],
      createdAt: rule.createdAt || new Date().toISOString(),
      updatedAt: rule.updatedAt || ""
    };
  }

  function normalizeNotification(notification) {
    return {
      id: notification.id || uid(),
      type: notification.type || "notice",
      queuedAt: notification.queuedAt || new Date().toISOString(),
      toName: notification.toName || "",
      toEmail: notification.toEmail || "",
      subject: notification.subject || "",
      body: notification.body || "",
      link: notification.link || "",
      dedupeKey: notification.dedupeKey || "",
      status: notification.status || "queued"
    };
  }

  function normalizeReminder(reminder) {
    return {
      id: reminder.id || uid(),
      optionId: reminder.optionId || "",
      label: reminder.label || "",
      daysBefore: Number(reminder.daysBefore || 0),
      scheduledFor: reminder.scheduledFor || "",
      createdAt: reminder.createdAt || new Date().toISOString(),
      createdBy: reminder.createdBy || currentUserName() || "Calendar Admin",
      status: reminder.status || "scheduled"
    };
  }

  function normalizeCalendarHistoryEntry(entry) {
    return {
      id: entry.id || uid(),
      at: entry.at || new Date().toISOString(),
      actor: entry.actor || currentUserName() || "Calendar Admin",
      action: entry.action || "Updated",
      slotId: entry.slotId || "",
      slotDate: entry.slotDate || "",
      summary: entry.summary || ""
    };
  }

  function touchSlot(slot) {
    slot.revision = Number(slot.revision || 0) + 1;
    slot.updatedAt = new Date().toISOString();
  }

  function addCalendarHistory(store, action, slot, summary) {
    store.history = Array.isArray(store.history) ? store.history : [];
    store.history.unshift(normalizeCalendarHistoryEntry({
      action: action,
      slotId: slot && slot.id ? slot.id : "",
      slotDate: slot && slot.date ? slot.date : "",
      summary: summary || ""
    }));
    store.history = recentCalendarHistory(store.history);
  }

  function recentCalendarHistory(entries) {
    if (!Array.isArray(entries)) return [];
    var cutoff = calendarHistoryCutoffTime();
    return entries.map(normalizeCalendarHistoryEntry).filter(function (entry) {
      return calendarHistoryEntryTime(entry) >= cutoff;
    });
  }

  function calendarHistoryCutoffTime() {
    var cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - CALENDAR_HISTORY_DAYS);
    return cutoff.getTime();
  }

  function calendarHistoryEntryTime(entry) {
    var date = new Date(entry.at);
    if (Number.isNaN(date.getTime())) return new Date().getTime();
    return date.getTime();
  }

  function calendarHistoryItemLabel(slot) {
    return isMeetingSlot(slot) ? "this meeting" : "this talk";
  }

  function calendarHistoryPersonName(person) {
    return person && person.name ? publicName(person.name) : "Someone";
  }

  function makeVolunteer(name, link, notes, signedUpAt, email) {
    return normalizeVolunteer({
      name: name,
      email: email || "",
      link: link || "",
      notes: notes || "",
      signedUpAt: signedUpAt || new Date().toISOString()
    });
  }

  function seedDemoStore() {
    var demoIds = {
      "seed-talk-2026-05-26": true,
      "seed-talk-2026-06-02": true,
      "seed-talk-2026-06-09": true
    };
    var store = loadStore();
    try {
      if (window.localStorage) window.localStorage.setItem("ecbs-calendar-current-user-name", "Current Member");
      if (window.localStorage) window.localStorage.setItem("ecbs-calendar-current-user-email", "current.member@example.com");
      if (window.localStorage && window.localStorage.getItem(DEMO_SEEDED_KEY) === "1") return;
    } catch (error) {}
    if (store.slots.some(function (slot) { return demoIds[slot.id]; })) {
      try {
        if (window.localStorage) window.localStorage.setItem(DEMO_SEEDED_KEY, "1");
      } catch (error) {}
      return;
    }
    store = defaultCalendarStore();
    store.slots.sort(byDateTime);
    saveStore(store);
    try {
      if (window.localStorage) window.localStorage.setItem(DEMO_SEEDED_KEY, "1");
    } catch (error) {}
  }

  function addDays(date, count) {
    var copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    copy.setDate(copy.getDate() + count);
    return copy;
  }

  function lastDayOfMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
  }

  function addMonthsClamped(date, count) {
    var targetMonth = date.getMonth() + count;
    var targetYear = date.getFullYear() + Math.floor(targetMonth / 12);
    targetMonth = ((targetMonth % 12) + 12) % 12;
    var targetDay = Math.min(date.getDate(), lastDayOfMonth(targetYear, targetMonth));
    return new Date(targetYear, targetMonth, targetDay);
  }

  function signupWindowLabel(settings) {
    var months = normalizeCalendarSettings(settings).signupWindowMonths;
    return months + " " + (months === 1 ? "month" : "months");
  }

  function signupOpenDate(slot, settings) {
    return dateKey(addMonthsClamped(parseDate(slot.date), -normalizeCalendarSettings(settings).signupWindowMonths));
  }

  function signupWindowOpen(slot, settings) {
    return dateKey(new Date()) >= signupOpenDate(slot, settings);
  }

  function signupWindowMessage(slot, settings, label) {
    return label + " open " + signupWindowLabel(settings) + " before this calendar item, on " + displayDate(signupOpenDate(slot, settings)) + ".";
  }

  function monthWindow(year, month) {
    var first = new Date(year, month, 1);
    var start = new Date(year, month, 1 - first.getDay());
    var end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 41);
    return { start: start, end: end };
  }

  function ensureRecurringSlots(store, year, month) {
    var windowRange = monthWindow(year, month);
    var existingByRecurrenceDate = {};
    store.slots.forEach(function (slot) {
      if (slot.recurrenceId) existingByRecurrenceDate[slot.recurrenceId + ":" + slot.date] = true;
    });

    for (var day = new Date(windowRange.start); day <= windowRange.end; day.setDate(day.getDate() + 1)) {
      var key = dateKey(day);
      store.recurrences.filter(function (rule) { return rule.active; }).forEach(function (rule) {
        var recurrenceDateKey = rule.id + ":" + key;
        if (existingByRecurrenceDate[recurrenceDateKey]) return;
        if (rule.skippedDates.indexOf(key) !== -1) return;
        if (!recurrenceMatchesDate(rule, day)) return;
        store.slots.push(slotFromRecurrence(rule, key));
        existingByRecurrenceDate[recurrenceDateKey] = true;
      });
    }
    store.slots.sort(byDateTime);
    saveStore(store);
    return store;
  }

  function ensureCalendarRenderSlots(store, year, month) {
    var today = new Date();
    var nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    store = ensureRecurringSlots(store, today.getFullYear(), today.getMonth());
    store = ensureRecurringSlots(store, nextMonth.getFullYear(), nextMonth.getMonth());
    if (year !== today.getFullYear() || month !== today.getMonth()) {
      store = ensureRecurringSlots(store, year, month);
    }
    return store;
  }

  function ensureMobileCalendarRenderSlots(store) {
    var today = new Date();
    for (var i = 0; i <= MOBILE_CALENDAR_MONTHS_AHEAD; i += 1) {
      var target = new Date(today.getFullYear(), today.getMonth() + i, 1);
      store = ensureRecurringSlots(store, target.getFullYear(), target.getMonth());
    }
    return store;
  }

  function actualNextUpcomingSlot(store) {
    return store.slots.filter(function (slot) {
      return !isPastSlot(slot) && !slot.canceled;
    }).sort(byDateTime)[0] || null;
  }

  function slotFromRecurrence(rule, dateValue) {
    return normalizeSlot({
      id: uid(),
      date: dateValue,
      startTime: rule.startTime,
      endTime: rule.endTime,
      itemType: rule.itemType,
      recurrenceId: rule.id,
      generatedFromRecurrence: true,
      occurrenceOverrides: [],
      title: rule.title,
      description: rule.description,
      usePhysicalLocation: rule.usePhysicalLocation !== false,
      useDefaultLocation: rule.useDefaultLocation !== false,
      location: rule.location,
      useZoom: Boolean(rule.useZoom),
      canceled: false,
      speaker: null,
      backups: [],
      attendees: [],
      notifications: []
    });
  }

  function updateOccurrenceOverrides(slot, recurrence) {
    if (!slot || !recurrence || !slot.recurrenceId) return;
    var overrides = [];
    var fields = ["startTime", "endTime", "title", "description", "usePhysicalLocation", "useDefaultLocation", "location", "useZoom"];
    fields.forEach(function (field) {
      var slotValue = field === "description"
        ? textValueOrDefault(slot, field, isMeetingSlot(slot) ? "" : DEFAULT_DESCRIPTION)
        : field === "location"
          ? (slot[field] || DEFAULT_LOCATION)
          : field === "usePhysicalLocation" || field === "useDefaultLocation" || field === "useZoom"
            ? String(Boolean(slot[field]))
          : String(slot[field] || "");
      var recurrenceValue = field === "description"
        ? textValueOrDefault(recurrence, field, recurrence.itemType === "meeting" ? "" : DEFAULT_DESCRIPTION)
        : field === "location"
          ? (recurrence[field] || DEFAULT_LOCATION)
          : field === "usePhysicalLocation" || field === "useDefaultLocation" || field === "useZoom"
            ? String(Boolean(recurrence[field]))
          : String(recurrence[field] || "");
      if (slotValue !== recurrenceValue) overrides.push(field);
    });
    slot.occurrenceOverrides = uniqueStrings(overrides);
  }

  function recurrenceMatchesDate(rule, date) {
    var startDate = parseDate(rule.startDate);
    if (dateKey(date) < rule.startDate) return false;
    if (rule.frequency === "weekly") {
      var diffDays = Math.round((date.getTime() - startDate.getTime()) / 86400000);
      return diffDays >= 0 && diffDays % (7 * rule.interval) === 0;
    }
    if (rule.frequency === "monthly") {
      var monthDiff = (date.getFullYear() - startDate.getFullYear()) * 12 + (date.getMonth() - startDate.getMonth());
      if (monthDiff < 0 || monthDiff % rule.interval !== 0) return false;
      if (rule.monthlyMode === MONTHLY_MODE_MONTH_DAY) return date.getDate() === startDate.getDate();
      return date.getDay() === startDate.getDay() && nthWeekdayOfMonth(date) === nthWeekdayOfMonth(startDate);
    }
    return false;
  }

  function nthWeekdayOfMonth(date) {
    return Math.ceil(date.getDate() / 7);
  }

  function ordinalLabel(number) {
    var value = Number(number || 0);
    var mod100 = value % 100;
    if (mod100 >= 11 && mod100 <= 13) return value + "th";
    if (value % 10 === 1) return value + "st";
    if (value % 10 === 2) return value + "nd";
    if (value % 10 === 3) return value + "rd";
    return value + "th";
  }

  function monthlyWeekdayLabel(startDateValue) {
    var startDate = parseDate(startDateValue);
    return "Every " + ordinalLabel(nthWeekdayOfMonth(startDate)) + " " + FULL_WEEKDAY_LABELS[startDate.getDay()];
  }

  function monthlyMonthDayLabel(startDateValue) {
    var startDate = parseDate(startDateValue);
    return "Every " + ordinalLabel(startDate.getDate()) + " day of the month";
  }

  function byDateTime(a, b) {
    return (a.date + "T" + (a.startTime || "00:00")).localeCompare(b.date + "T" + (b.startTime || "00:00"));
  }

  function slotInstanceKey(slot) {
    return [slot.id, slot.date, slot.startTime || "", slot.endTime || ""].join("|");
  }

  function findSlotById(store, slotId) {
    return store.slots.find(function (slot) { return slot.id === slotId; }) || null;
  }

  function freshSlotForAction(slotId, expectedRevision, year, month) {
    var store = ensureRecurringSlots(loadStore(), year, month);
    var slot = findSlotById(store, slotId);
    if (!slot) return { store: store, slot: null, conflict: "That calendar item could not be found. Please refresh the calendar and try again." };
    if (Number(slot.revision || 0) !== Number(expectedRevision || 0)) {
      return {
        store: store,
        slot: slot,
        conflict: "This calendar item changed in another window or by another admin. I refreshed the latest version so you do not overwrite someone else's update."
      };
    }
    return { store: store, slot: slot, conflict: "" };
  }

  function fieldValue(form, name) {
    var field = form.querySelector('[name="' + name + '"]');
    return field ? field.value.trim() : "";
  }

  function checkboxValue(form, name) {
    var field = form.querySelector('[name="' + name + '"]');
    return Boolean(field && field.checked);
  }

  function locationValueFromForm(form, settings) {
    settings = normalizeCalendarSettings(settings);
    if (form.querySelector('[name="usePhysicalLocation"]') && !checkboxValue(form, "usePhysicalLocation")) {
      return "";
    }
    if (form.querySelector('[name="useDefaultLocation"]') && checkboxValue(form, "useDefaultLocation")) {
      return settings.defaultLocation;
    }
    return fieldValue(form, "location") || settings.defaultLocation;
  }

  function currentUserName() {
    return loggedInUserName();
  }

  function loggedInUserName() {
    try {
      return (window.localStorage && window.localStorage.getItem("ecbs-calendar-current-user-name")) || "";
    } catch (error) {
      return "";
    }
  }

  function isLoggedIn() {
    return Boolean(loggedInUserName());
  }

  function emailFromName(name) {
    var key = personKey(name || "member").replace(/[^a-z0-9]+/g, ".");
    return key.replace(/^\.+|\.+$/g, "") + "@example.com";
  }

  function currentUserEmail() {
    try {
      var userName = currentUserName();
      return (window.localStorage && window.localStorage.getItem("ecbs-calendar-current-user-email")) || (userName ? emailFromName(userName) : "");
    } catch (error) {
      return currentUserName() ? emailFromName(currentUserName()) : "";
    }
  }

  function isLocalDevelopmentHost() {
    try {
      var host = window.location && window.location.hostname ? window.location.hostname : "";
      return host === "localhost" || host === "127.0.0.1" || host === "::1" || /^192\.168\./.test(host) || /^10\./.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
    } catch (error) {
      return false;
    }
  }

  function isLocalDevelopmentMode() {
    var rootFlag = false;
    try {
      var root = typeof document !== "undefined" ? document.getElementById("calendar-app") : null;
      rootFlag = Boolean(root && root.getAttribute("data-calendar-local-dev") === "true");
    } catch (error) {
      rootFlag = false;
    }
    return Boolean((localDevelopmentPage || rootFlag) && isLocalDevelopmentHost());
  }

  function slotStatus(slot) {
    if (slot.movedToDate) return "Moved to " + displayShortDate(slot.movedToDate);
    if (isMeetingSlot(slot)) {
      if (slot.canceled) return "Canceled";
      if (isPastSlot(slot)) return "Past meeting";
      return "Meeting";
    }
    if (slot.canceled) return "Canceled";
    if (isPastSlot(slot)) return "Past meeting";
    return slot.speaker && slot.speaker.name ? "Assigned" : "Open";
  }

  function isTalkSlot(slot) {
    return !slot.itemType || slot.itemType === "talk";
  }

  function isMeetingSlot(slot) {
    return slot.itemType === "meeting";
  }

  function backupCountLabel(slot) {
    var count = slot.backups.length;
    return count + " " + (count === 1 ? "backup" : "backups");
  }

  function backupTooltip(slot) {
    if (!slot.backups.length) return "No backup volunteers yet. Sign up as a backup volunteer.";
    return "Backup volunteers: " + slot.backups.map(function (backup) {
      return publicName(backup.name);
    }).filter(Boolean).join(", ");
  }

  function personKey(name) {
    return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  function speakerHistory(store) {
    var history = {};
    store.slots.forEach(function (slot) {
      if (!slot.speaker || !slot.speaker.name) return;
      var key = personKey(slot.speaker.name);
      if (!key) return;
      if (!history[key]) {
        history[key] = { count: 0, lastTalkDate: "" };
      }
      history[key].count += 1;
      if (!history[key].lastTalkDate || slot.date > history[key].lastTalkDate) {
        history[key].lastTalkDate = slot.date;
      }
    });
    return history;
  }

  function orderedBackups(slot, store) {
    var history = speakerHistory(store);
    return slot.backups.slice().sort(function (a, b) {
      var aHistory = history[personKey(a.name)] || { count: 0, lastTalkDate: "" };
      var bHistory = history[personKey(b.name)] || { count: 0, lastTalkDate: "" };
      if (aHistory.lastTalkDate !== bHistory.lastTalkDate) return aHistory.lastTalkDate.localeCompare(bHistory.lastTalkDate);
      return String(a.signedUpAt || "").localeCompare(String(b.signedUpAt || ""));
    });
  }

  function currentUserBackup(slot) {
    if (!isLoggedIn()) return null;
    var userKey = personKey(currentUserName());
    return slot.backups.find(function (backup) {
      return personKey(backup.name) === userKey;
    }) || null;
  }

  function cancelCurrentBackupSignup(slot) {
    var backup = currentUserBackup(slot);
    if (!backup) return null;
    slot.backups = slot.backups.filter(function (item) {
      return personKey(item.name) !== personKey(backup.name);
    });
    return backup;
  }

  function removeDirectAttendanceForPerson(slot, person) {
    if (!slot || !person || !person.name) return;
    var key = personKey(person.name);
    slot.attendees = (slot.attendees || []).filter(function (attendee) {
      return personKey(attendee.name) !== key;
    });
  }

  function currentUserAttendee(slot) {
    if (!isLoggedIn()) return null;
    var userKey = personKey(currentUserName());
    return (slot.attendees || []).find(function (attendee) {
      return personKey(attendee.name) === userKey;
    }) || null;
  }

  function currentUserAttendanceRole(slot) {
    if (!isLoggedIn()) return "";
    var userKey = personKey(currentUserName());
    if (slot.speaker && personKey(slot.speaker.name) === userKey) return isTalkSlot(slot) ? "bringing the talk" : "assigned";
    if ((slot.backups || []).some(function (backup) { return personKey(backup.name) === userKey; })) return "signed up as a backup";
    if (currentUserAttendee(slot)) return "planning to attend";
    return "";
  }

  function currentUserCalendarPerson(slot) {
    if (!isLoggedIn() || !slot) return null;
    var userKey = personKey(currentUserName());
    if (slot.speaker && personKey(slot.speaker.name) === userKey) return slot.speaker;
    var backup = (slot.backups || []).find(function (item) {
      return personKey(item.name) === userKey;
    });
    if (backup) return backup;
    return currentUserAttendee(slot);
  }

  function updateCurrentUserReminders(slot, reminders) {
    var person = currentUserCalendarPerson(slot);
    if (!person) return null;
    person.email = person.email || currentUserEmail();
    person.reminders = reminders;
    return person;
  }

  function cancelCalendarItem(slot, sendEmail) {
    if (!slot || slot.canceled) return false;
    if (sendEmail !== false) queueMeetingCancellationNotifications(slot);
    slot.canceled = true;
    touchSlot(slot);
    return true;
  }

  function signedUpPeople(slot) {
    var people = [];
    var seen = {};
    var addPerson = function (person, role) {
      if (!person || !person.name) return;
      var key = (person.email || personKey(person.name)).toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      people.push({
        name: person.name,
        email: person.email || "",
        role: role
      });
    };
    addPerson(slot.speaker, "speaker");
    slot.backups.forEach(function (backup) { addPerson(backup, "backup"); });
    (slot.attendees || []).forEach(function (attendee) { addPerson(attendee, "attendee"); });
    return people;
  }

  function attendanceCount(slot) {
    return signedUpPeople(slot).length;
  }

  function attendanceCountLabel(slot) {
    var count = attendanceCount(slot);
    return count + " " + (count === 1 ? "person attending" : "people attending");
  }

  function absoluteAppUrl(path, params) {
    return new URL(appUrl(path, params), window.location.origin).href;
  }

  function queueParticipantNotices(slot, recipients, options) {
    recipients = recipients.filter(function (person) { return person && person.email; });
    if (!recipients.length) return [];
    var link = absoluteAppUrl("calendar-item/", { slot: slot.id });
    var existingKeys = {};
    (slot.notifications || []).forEach(function (notice) {
      if (notice.dedupeKey) existingKeys[notice.dedupeKey] = true;
    });
    var notices = recipients.map(function (person) {
      var dedupeKey = options.dedupeKey ? options.dedupeKey + ":" + person.email.toLowerCase() : "";
      if (dedupeKey && existingKeys[dedupeKey]) return null;
      if (dedupeKey) existingKeys[dedupeKey] = true;
      return normalizeNotification({
        type: options.type,
        toName: person.name,
        toEmail: person.email,
        subject: options.subject,
        link: link,
        dedupeKey: dedupeKey,
        body: options.body + " Link: " + link
      });
    }).filter(Boolean);
    slot.notifications = (slot.notifications || []).concat(notices);
    return notices;
  }

  function queueBackupCancellationEmails(slot) {
    if (!slot.backups.length) return [];
    var link = absoluteAppUrl("calendar-item/", { slot: slot.id });
    var speakerName = slot.speaker && slot.speaker.name ? publicName(slot.speaker.name) : "The scheduled speaker";
    var queuedAt = new Date().toISOString();
    var existingKeys = {};
    (slot.notifications || []).forEach(function (notice) {
      if (notice.dedupeKey) existingKeys[notice.dedupeKey] = true;
    });
    var notices = slot.backups.filter(function (backup) { return backup.email; }).map(function (backup) {
      var dedupeKey = "primary-cancelled:" + slot.id + ":" + backup.email.toLowerCase();
      if (existingKeys[dedupeKey]) return null;
      existingKeys[dedupeKey] = true;
      return normalizeNotification({
        type: "primary-cancelled",
        queuedAt: queuedAt,
        toName: backup.name,
        toEmail: backup.email,
        subject: "Backup requested for " + displayDate(slot.date),
        link: link,
        dedupeKey: dedupeKey,
        body: speakerName + " can no longer bring the talk for " + displayDate(slot.date) + ". If you are able to bring the talk, return to the calendar item link and choose Volunteer: " + link
      });
    }).filter(Boolean);
    slot.notifications = (slot.notifications || []).concat(notices);
    return notices;
  }

  function queueSlotChangeNotifications(slot, oldSlot, changes) {
    var recipients = signedUpPeople(slot);
    if (!recipients.length || !changes.length) return [];
    return queueParticipantNotices(slot, recipients, {
      type: "slot-updated",
      dedupeKey: "slot-updated:" + slot.id + ":" + oldSlot.date + ":" + oldSlot.startTime + ":" + oldSlot.endTime + ":" + (oldSlot.location || DEFAULT_LOCATION) + ":" + slot.date + ":" + slot.startTime + ":" + slot.endTime + ":" + (slot.location || DEFAULT_LOCATION),
      subject: "Calendar item updated for " + displayDate(slot.date),
      body: "The calendar item changed from " + displayDate(oldSlot.date) + " at " + displayTimeRange(oldSlot) + " to " + displayDate(slot.date) + " at " + displayTimeRange(slot) + ". Changes: " + changes.join("; ") + "."
    });
  }

  function queuePersonCancellationNotifications(slot, person, role) {
    var recipients = signedUpPeople(slot);
    if (!recipients.length || !person) return [];
    var roleLabel = role === "speaker" ? "the person bringing the talk" : role === "attendee" ? "an attendee" : "a backup volunteer";
    return queueParticipantNotices(slot, recipients, {
      type: role + "-cancelled",
      dedupeKey: role + "-cancelled:" + slot.id + ":" + personKey(person.name),
      subject: "Talk volunteer update for " + displayDate(slot.date),
      body: publicName(person.name) + " was removed as " + roleLabel + " for " + displayDate(slot.date) + "."
    });
  }

  function queueMeetingCancellationNotifications(slot) {
    var recipients = signedUpPeople(slot);
    if (!recipients.length) return [];
    return queueParticipantNotices(slot, recipients, {
      type: "meeting-cancelled",
      dedupeKey: "meeting-cancelled:" + slot.id + ":" + slot.date,
      subject: "Talk meeting canceled for " + displayDate(slot.date),
      body: "The talk meeting on " + displayDate(slot.date) + " at " + displayTimeRange(slot) + " was canceled."
    });
  }

  function promoteBackupToSpeaker(slot, backup) {
    if (!backup || slot.speaker) return;
    slot.speaker = normalizeVolunteer({
      name: backup.name,
      email: backup.email,
      link: backup.link,
      notes: backup.notes,
      signedUpAt: new Date().toISOString()
    });
    slot.backups = slot.backups.filter(function (item) {
      return personKey(item.name) !== personKey(backup.name);
    });
    removeDirectAttendanceForPerson(slot, backup);
  }

  function assignPersonToSlot(slot, role, name, email) {
    var cleanName = String(name || "").trim();
    if (!cleanName) return null;
    var existing = existingPersonOnSlot(slot, cleanName);
    var volunteer = normalizeVolunteer({
      link: existing ? existing.link : "",
      notes: existing ? existing.notes : "",
      name: cleanName,
      email: String(email || "").trim(),
      signedUpAt: existing && existing.signedUpAt ? existing.signedUpAt : new Date().toISOString()
    });
    if (role === "speaker") {
      slot.speaker = volunteer;
      slot.backups = (slot.backups || []).filter(function (backup) {
        return personKey(backup.name) !== personKey(volunteer.name);
      });
      removeDirectAttendanceForPerson(slot, volunteer);
      return volunteer;
    }
    if (role === "backup") {
      slot.backups = upsertPerson(slot.backups || [], volunteer);
      removeDirectAttendanceForPerson(slot, volunteer);
      return volunteer;
    }
    if (role === "attendee") {
      slot.attendees = upsertPerson(slot.attendees || [], volunteer);
      return volunteer;
    }
    return null;
  }

  function existingPersonOnSlot(slot, name) {
    var key = personKey(name);
    if (!key) return null;
    if (slot.speaker && personKey(slot.speaker.name) === key) return slot.speaker;
    var backup = (slot.backups || []).find(function (item) { return personKey(item.name) === key; });
    if (backup) return backup;
    return (slot.attendees || []).find(function (item) { return personKey(item.name) === key; }) || null;
  }

  function upsertPerson(list, person) {
    var updated = false;
    var next = list.map(function (item) {
      if (personKey(item.name) !== personKey(person.name)) return item;
      updated = true;
      return normalizeVolunteer(Object.assign({}, item, {
        name: person.name,
        email: person.email,
        signedUpAt: item.signedUpAt || person.signedUpAt
      }));
    });
    if (!updated) next.push(person);
    return next;
  }

  function isDefaultEmptySlot(slot) {
    return isTalkSlot(slot) && !slot.speaker && !slot.backups.length && !slot.canceled && slot.title === DEFAULT_TITLE && slot.description === DEFAULT_DESCRIPTION;
  }

  function shouldShiftSlot(slot, startDate, recurrenceId, sourceSlotId) {
    if (slot.canceled || slot.movedToDate) return false;
    if (recurrenceId) return slot.recurrenceId === recurrenceId && slot.date >= startDate;
    return false;
  }

  function movedMarkerId(slot, oldDate, newDate) {
    return "moved-" + (slot.recurrenceId || slot.id) + "-" + oldDate + "-to-" + newDate;
  }

  function createMovedMarkerFromSlot(slot, oldDate, newDate) {
    return normalizeSlot({
      id: movedMarkerId(slot, oldDate, newDate),
      date: oldDate,
      startTime: slot.startTime,
      endTime: slot.endTime,
      itemType: slot.itemType,
      recurrenceId: slot.recurrenceId,
      generatedFromRecurrence: Boolean(slot.generatedFromRecurrence),
      occurrenceOverrides: uniqueStrings((slot.occurrenceOverrides || []).concat(["movedToDate"])),
      title: slot.title,
      description: slot.description,
      usePhysicalLocation: slot.usePhysicalLocation,
      useDefaultLocation: slot.useDefaultLocation,
      location: slot.location,
      useZoom: slot.useZoom,
      canceled: true,
      movedToDate: newDate,
      speaker: null,
      backups: [],
      attendees: [],
      notifications: [],
      reminders: []
    });
  }

  function shiftDateByDays(dateValue, count) {
    return dateKey(addDays(parseDate(dateValue), count));
  }

  function removeDuplicateDefaultSlots(store) {
    var seenMeaningfulDate = {};
    store.slots.forEach(function (slot) {
      if (!isDefaultEmptySlot(slot)) seenMeaningfulDate[slot.date] = true;
    });
    var seenDefaultDate = {};
    store.slots = store.slots.filter(function (slot) {
      if (!isDefaultEmptySlot(slot)) return true;
      if (seenMeaningfulDate[slot.date]) return false;
      if (seenDefaultDate[slot.date]) return false;
      seenDefaultDate[slot.date] = true;
      return true;
    });
  }

  function queuePushForwardNotifications(store, startDate, recurrenceId, sourceSlotId, sendEmail) {
    if (!recurrenceId) return [];
    var affected = store.slots.filter(function (slot) {
      return shouldShiftSlot(slot, startDate, recurrenceId, sourceSlotId);
    }).sort(byDateTime);
    if (!affected.length) return [];

    var noticeSlot = affected[0];
    var byEmail = {};
    var affectedIds = {};
    var firstAffectedId = affected[0].id;
    affected.forEach(function (slot) { affectedIds[slot.id] = true; });
    var operationKey = "schedule-pushed-forward:" + (recurrenceId || sourceSlotId || "all") + ":" + startDate + ":" + affected.map(function (slot) {
      return slot.id + "@" + slot.date;
    }).join("|");
    var existingKeys = {};
    store.slots.forEach(function (slot) {
      (slot.notifications || []).forEach(function (notice) {
        if (notice.dedupeKey) existingKeys[notice.dedupeKey] = true;
      });
    });
    affected.forEach(function (slot) {
      var oldDate = slot.date;
      var newDate = shiftDateByDays(slot.date, 7);
      signedUpPeople(slot).forEach(function (person) {
        if (!person.email) return;
        var key = person.email.toLowerCase();
        if (!byEmail[key]) {
          byEmail[key] = { person: person, lines: [] };
        }
        byEmail[key].lines.push((slot.title || DEFAULT_TITLE) + ": " + displayDate(oldDate) + " moves to " + displayDate(newDate) + ".");
      });
      store.slots = store.slots.filter(function (candidate) {
        if (affectedIds[candidate.id]) return true;
        if (candidate === slot || candidate.date !== newDate || !isDefaultEmptySlot(candidate)) return true;
        if (recurrenceId) return candidate.recurrenceId !== recurrenceId;
        return true;
      });
      slot.date = newDate;
      slot.movedFromDate = oldDate;
      if (slot.id === firstAffectedId && !store.slots.some(function (candidate) { return candidate.id === movedMarkerId(slot, oldDate, newDate); })) {
        store.slots.push(createMovedMarkerFromSlot(slot, oldDate, newDate));
      }
    });
    if (recurrenceId) addRecurrenceSkippedDates(store, recurrenceId, affected.map(function (slot) {
      return shiftDateByDays(slot.date, -7);
    }));
    removeDuplicateDefaultSlots(store);

    var notices = sendEmail === false ? [] : Object.keys(byEmail).map(function (key) {
      var item = byEmail[key];
      var dedupeKey = operationKey + ":" + item.person.email.toLowerCase();
      if (existingKeys[dedupeKey]) return null;
      existingKeys[dedupeKey] = true;
      return normalizeNotification({
        type: "schedule-pushed-forward",
        toName: item.person.name,
        toEmail: item.person.email,
        subject: "Calendar schedule moved forward one week",
        link: absoluteAppUrl("calendar/", {}),
        dedupeKey: dedupeKey,
        body: "The calendar schedule was moved forward one week. Changes affecting you: " + item.lines.join(" ")
      });
    }).filter(Boolean);
    noticeSlot.notifications = (noticeSlot.notifications || []).concat(notices);
    store.slots.sort(byDateTime);
    return notices;
  }

  function addRecurrenceSkippedDates(store, recurrenceId, dates) {
    var rule = store.recurrences.find(function (item) { return item.id === recurrenceId; });
    if (!rule) return;
    var seen = {};
    rule.skippedDates.forEach(function (dateValue) { seen[dateValue] = true; });
    dates.forEach(function (dateValue) {
      if (!seen[dateValue]) {
        rule.skippedDates.push(dateValue);
        seen[dateValue] = true;
      }
    });
    rule.updatedAt = new Date().toISOString();
  }

  function reminderDateTime(slot, daysBefore) {
    var date = parseDate(slot.date);
    date.setDate(date.getDate() - Number(daysBefore || 0));
    var time = daysBefore === 0 ? "09:00" : "10:00";
    return dateKey(date) + "T" + time + ":00";
  }

  function scheduleReminders(slot, optionIds) {
    var selected = {};
    optionIds.forEach(function (id) { selected[id] = true; });
    var existing = {};
    (slot.reminders || []).forEach(function (reminder) {
      if (reminder.optionId) existing[reminder.optionId] = true;
    });
    var created = REMINDER_OPTIONS.map(function (option) {
      if (!selected[option.id] || existing[option.id]) return null;
      return normalizeReminder({
        optionId: option.id,
        label: option.label,
        daysBefore: option.daysBefore,
        scheduledFor: reminderDateTime(slot, option.daysBefore)
      });
    }).filter(Boolean);
    slot.reminders = (slot.reminders || []).concat(created);
    return created;
  }

  function icsDateTime(slot, key) {
    var value = slot[key] || (key === "startTime" ? DEFAULT_START_TIME : DEFAULT_END_TIME);
    return slot.date.replace(/-/g, "") + "T" + value.replace(":", "") + "00";
  }

  function escapeIcsText(value) {
    return String(value || "")
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .replace(/\r?\n/g, "\\n");
  }

  function icsForSlot(slot, settings) {
    var link = absoluteAppUrl("calendar-item/", { slot: slot.id });
    var title = slot.title || DEFAULT_TITLE;
    var speaker = slot.speaker && slot.speaker.name ? " Bringing the talk: " + publicName(slot.speaker.name) + "." : "";
    var zoomLink = zoomLinkForSlot(slot, settings);
    var description = (slot.description || "") + speaker + (zoomLink ? " Zoom: " + zoomLink + "." : "") + " Signup: " + link;
    var lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Eau Claire Buddhist Sangha//Calendar//EN",
      "CALSCALE:GREGORIAN",
      "BEGIN:VEVENT",
      "UID:" + escapeIcsText(slot.id) + "@ecbuddhistsangha",
      "DTSTAMP:" + new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z"),
      "DTSTART:" + icsDateTime(slot, "startTime"),
      "DTEND:" + icsDateTime(slot, "endTime"),
      "SUMMARY:" + escapeIcsText(title),
      slot.usePhysicalLocation === false ? "" : "LOCATION:" + escapeIcsText(slot.location || DEFAULT_LOCATION),
      "DESCRIPTION:" + escapeIcsText(description),
      "URL:" + link,
      "END:VEVENT",
      "END:VCALENDAR"
    ].filter(Boolean);
    return lines.join("\r\n");
  }

  function icsDataUrl(slot, settings) {
    return "data:text/calendar;charset=utf-8," + encodeURIComponent(icsForSlot(slot, settings));
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function compactText(value, limit) {
    var text = String(value || "").replace(/\s+/g, " ").trim();
    if (text.length <= limit) return text;
    return text.slice(0, limit - 3).trimEnd() + "...";
  }

  function tooltipAttr(value) {
    var text = String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
    return text ? ' title="' + escapeHtml(text) + '"' : "";
  }

  function appUrl(path, params) {
    var cleanedPath = String(path || "").replace(/^\/+/, "");
    var baseUrl = appBaseUrl;
    if (!baseUrl && typeof document !== "undefined") {
      var root = document.getElementById("calendar-app");
      if (root) baseUrl = root.getAttribute("data-calendar-base");
    }
    if (baseUrl && /^\//.test(baseUrl) && typeof window !== "undefined") {
      baseUrl = window.location.origin + baseUrl;
    }
    var url = new URL(cleanedPath, baseUrl || window.location.href);
    Object.keys(params || {}).forEach(function (key) {
      if (params[key]) url.searchParams.set(key, params[key]);
    });
    return url.pathname + url.search + url.hash;
  }

  function lockPageScrollForModal() {
    if (typeof document === "undefined" || typeof window === "undefined" || !document.body) return;
    if (modalScrollLock) return;
    var scrollY = window.scrollY || document.documentElement.scrollTop || 0;
    modalScrollLock = {
      scrollY: scrollY,
      overflow: document.body.style.overflow,
      position: document.body.style.position,
      top: document.body.style.top,
      left: document.body.style.left,
      right: document.body.style.right,
      width: document.body.style.width
    };
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = "-" + scrollY + "px";
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
  }

  function unlockPageScrollForModal() {
    if (typeof document === "undefined" || typeof window === "undefined" || !document.body || !modalScrollLock) return;
    var scrollY = modalScrollLock.scrollY;
    document.body.style.overflow = modalScrollLock.overflow;
    document.body.style.position = modalScrollLock.position;
    document.body.style.top = modalScrollLock.top;
    document.body.style.left = modalScrollLock.left;
    document.body.style.right = modalScrollLock.right;
    document.body.style.width = modalScrollLock.width;
    modalScrollLock = null;
    window.scrollTo(0, scrollY);
  }

  function syncModalScrollLock(root) {
    if (root && root.querySelector('[aria-modal="true"]')) {
      lockPageScrollForModal();
    } else {
      unlockPageScrollForModal();
    }
  }

  function renderShell(root, inner) {
    root.innerHTML = inner;
    syncModalScrollLock(root);
  }

  function hasCalendarAdminAccess() {
    if (isLocalDevelopmentMode()) return true;
    if (typeof window === "undefined" || !window.sessionStorage) return false;
    try {
      var raw = window.sessionStorage.getItem(ADMIN_ACCESS_KEY);
      var timestamp = Number(raw || 0);
      return Boolean(timestamp && Date.now() - timestamp <= ADMIN_ACCESS_MAX_AGE_MS);
    } catch (error) {
      return false;
    }
  }

  function renderAdminAccessGate(root) {
    renderShell(root,
      '<div class="rounded-2xl border border-sangha-gold/40 bg-white p-6 shadow-sm">' +
        '<h2 class="font-serif text-2xl font-bold text-sangha-navy">Open Calendar Admin Through The CMS</h2>' +
        '<p class="mt-3 text-sm leading-relaxed text-gray-600">Calendar Admin is linked from the Decap CMS menu. Open the CMS first, then choose Calendar Admin from that menu.</p>' +
        '<p class="mt-3 text-xs leading-relaxed text-gray-500">This is a local/static preview gate. Final access control should be enforced with Cloudflare Access or a server-side authorization check.</p>' +
        '<a href="' + appUrl("admin/") + '" class="mt-5 inline-flex rounded-full bg-sangha-navy px-5 py-3 text-xs font-bold uppercase tracking-widest text-white hover:bg-blue-900">Open CMS</a>' +
      '</div>');
  }

  function renderMonthControls(year, month, viewTitle, description) {
    return '<div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4 p-5 border-b border-gray-100">' +
      '<div>' +
        '<h2 class="font-serif text-2xl font-bold text-sangha-navy">' + viewTitle + '</h2>' +
        '<p class="text-sm text-gray-500 mt-1">' + description + '</p>' +
      '</div>' +
      '<div class="flex items-center gap-2">' +
        '<button type="button" data-action="prev-month" class="w-10 h-10 rounded-full border border-gray-200 flex items-center justify-center text-sangha-navy hover:bg-sangha-light" aria-label="Previous month">' +
          '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>' +
        '</button>' +
        '<button type="button" data-action="today" class="px-4 h-10 rounded-full border border-gray-200 text-xs uppercase tracking-widest font-bold text-sangha-navy hover:bg-sangha-light">Today</button>' +
        '<button type="button" data-action="next-month" class="w-10 h-10 rounded-full border border-gray-200 flex items-center justify-center text-sangha-navy hover:bg-sangha-light" aria-label="Next month">' +
          '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>' +
        '</button>' +
      '</div>' +
    '</div>';
  }

  function wireMonthControls(root, renderFn, year, month) {
    root.querySelector('[data-action="prev-month"]').addEventListener("click", function () {
      var next = new Date(year, month - 1, 1);
      renderFn(root, { month: next.getMonth(), year: next.getFullYear() });
    });
    root.querySelector('[data-action="next-month"]').addEventListener("click", function () {
      var next = new Date(year, month + 1, 1);
      renderFn(root, { month: next.getMonth(), year: next.getFullYear() });
    });
    root.querySelector('[data-action="today"]').addEventListener("click", function () {
      var today = new Date();
      renderFn(root, { month: today.getMonth(), year: today.getFullYear() });
    });
  }

  function calendarGridHtml(year, month, store, mode) {
    var first = new Date(year, month, 1);
    var start = new Date(year, month, 1 - first.getDay());
    var cells = [];

    var nextUpcomingSlot = actualNextUpcomingSlot(store);
    var nextUpcomingSlotKey = nextUpcomingSlot ? slotInstanceKey(nextUpcomingSlot) : "";
    var settings = normalizeCalendarSettings(store.settings);

    for (var i = 0; i < 42; i += 1) {
      var day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      var key = dateKey(day);
      var slots = store.slots.filter(function (slot) { return slot.date === key; }).sort(byDateTime);
      cells.push(mode === "admin" ? renderAdminDayCell(day, month, slots, nextUpcomingSlotKey) : renderPublicDayCell(day, month, slots, nextUpcomingSlotKey, settings));
    }

    return '<div class="calendar-weekdays bg-sangha-navy text-white text-[10px] uppercase tracking-widest font-bold">' +
        WEEKDAY_LABELS.map(function (label) { return '<div class="p-3 text-center">' + label + '</div>'; }).join("") +
      '</div>' +
      '<div class="calendar-grid divide-x divide-y divide-gray-100">' + cells.join("") + '</div>';
  }

  function renderMobileCalendarList(store, page) {
    page = Math.max(0, Number(page) || 0);
    var today = dateKey(new Date());
    var settings = normalizeCalendarSettings(store.settings);
    var nextUpcomingSlot = actualNextUpcomingSlot(store);
    var nextUpcomingSlotKey = nextUpcomingSlot ? slotInstanceKey(nextUpcomingSlot) : "";
    var todaySlots = store.slots.filter(function (slot) { return slot.date === today; }).sort(byDateTime);
    var futureSlots = store.slots.filter(function (slot) { return slot.date > today; }).sort(byDateTime);
    var offset = page === 0 ? 0 : 4 + ((page - 1) * MOBILE_CALENDAR_PAGE_SIZE);
    var limit = page === 0 ? MOBILE_CALENDAR_PAGE_SIZE - 1 : MOBILE_CALENDAR_PAGE_SIZE;
    var visibleSlots = futureSlots.slice(offset, offset + limit);
    var hasPrev = page > 0;
    var hasNext = futureSlots.length > offset + limit;
    var rows = page === 0 ? [renderMobileTodayBlock(todaySlots, nextUpcomingSlotKey, settings)] : [];
    rows = rows.concat(visibleSlots.map(function (slot) {
      return renderMobileCalendarSlotBlock(slot, nextUpcomingSlotKey, settings);
    }));
    if (!rows.length) {
      rows.push('<div class="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-500">No upcoming calendar items are currently scheduled.</div>');
    }
    return '<div class="p-4">' +
      '<div class="mb-4">' + renderMobileCalendarPager(page, hasPrev, hasNext) + '</div>' +
      '<div class="grid gap-4">' + rows.join("") + '</div>' +
      '<div class="mt-4">' + renderMobileCalendarPager(page, hasPrev, hasNext) + '</div>' +
    '</div>';
  }

  function renderMobileCalendarPager(page, hasPrev, hasNext) {
    var disabledPrev = hasPrev ? "" : " disabled";
    var disabledNext = hasNext ? "" : " disabled";
    var disabledClass = " disabled:cursor-not-allowed disabled:opacity-40";
    return '<div class="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-3">' +
      '<button type="button" data-action="prev-mobile-page" class="rounded-full border border-gray-200 px-4 py-2 text-xs font-bold uppercase tracking-widest text-sangha-navy hover:bg-sangha-light' + disabledClass + '"' + disabledPrev + '>Prev</button>' +
      '<div class="text-center text-xs font-bold uppercase tracking-widest text-gray-500">' + (page === 0 ? "Today" : "Page " + (page + 1)) + '</div>' +
      '<button type="button" data-action="next-mobile-page" class="rounded-full border border-gray-200 px-4 py-2 text-xs font-bold uppercase tracking-widest text-sangha-navy hover:bg-sangha-light' + disabledClass + '"' + disabledNext + '>Next</button>' +
    '</div>';
  }

  function renderMobileTodayBlock(todaySlots, nextUpcomingSlotKey, settings) {
    var rows = todaySlots.map(function (slot) {
      return renderPublicSlotCard(slot, nextUpcomingSlotKey, settings, "mt-3");
    }).join("");
    if (!rows) {
      rows = '<div class="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">No calendar items today.</div>';
    }
    return '<section data-mobile-calendar-today class="rounded-xl border border-green-200 bg-green-50/60 p-4">' +
      '<div class="flex items-center justify-between gap-3">' +
        '<h2 class="font-serif text-lg font-bold text-sangha-navy">Today</h2>' +
        '<span class="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest font-bold text-green-700"><span class="h-2 w-2 rounded-full bg-green-600"></span>' + escapeHtml(displayDate(dateKey(new Date()))) + '</span>' +
      '</div>' +
      rows +
    '</section>';
  }

  function renderMobileCalendarSlotBlock(slot, nextUpcomingSlotKey, settings) {
    return '<section data-mobile-calendar-slot="' + escapeHtml(slot.id) + '" class="rounded-xl border border-gray-200 bg-white p-4">' +
      '<div class="mb-3 text-xs font-bold uppercase tracking-widest text-gray-400">' + escapeHtml(displayDate(slot.date)) + '</div>' +
      renderPublicSlotCard(slot, nextUpcomingSlotKey, settings, "") +
    '</section>';
  }

  function wireMobileCalendarControls(root, year, month, page) {
    root.querySelectorAll('[data-action="prev-mobile-page"]').forEach(function (button) {
      button.addEventListener("click", function () {
        if (button.disabled) return;
        renderCalendar(root, { year: year, month: month, mobilePage: Math.max(0, page - 1) });
      });
    });
    root.querySelectorAll('[data-action="next-mobile-page"]').forEach(function (button) {
      button.addEventListener("click", function () {
        if (button.disabled) return;
        renderCalendar(root, { year: year, month: month, mobilePage: page + 1 });
      });
    });
  }

  function renderCalendar(root, state) {
    var requestedMonth = initialMonthFromQuery();
    var month = state.month == null ? requestedMonth.month : state.month;
    var year = state.year == null ? requestedMonth.year : state.year;
    var mobilePage = state.mobilePage == null ? 0 : Math.max(0, Number(state.mobilePage) || 0);
    var store = ensureMobileCalendarRenderSlots(ensureCalendarRenderSlots(loadStore(), year, month));

    renderShell(root,
      renderLocalDevelopmentLogin() +
      '<div class="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">' +
        '<div class="hidden lg:block">' +
          renderMonthControls(year, month, MONTH_LABELS[month] + " " + year, "Recurring meetings appear automatically from the admin schedule.") +
          calendarGridHtml(year, month, store, "public") +
        '</div>' +
        '<div class="lg:hidden">' +
          renderMobileCalendarList(store, mobilePage) +
        '</div>' +
      '</div>');

    wireLocalDevelopmentLogin(root, function () {
      renderCalendar(root, { year: year, month: month, mobilePage: mobilePage });
    });
    wireMonthControls(root, renderCalendar, year, month);
    wireMobileCalendarControls(root, year, month, mobilePage);
  }

  function renderLocalDevelopmentLogin() {
    if (!isLocalDevelopmentMode()) return "";
    var userName = currentUserName();
    var status = userName
      ? '<div class="text-xs font-bold text-sangha-navy">Signed in as ' + escapeHtml(userName) + '</div>'
      : '<div class="text-xs font-bold text-gray-500">Not signed in</div>';
    return '<section data-local-dev-login class="mb-4 rounded-2xl border border-dashed border-sangha-gold/60 bg-yellow-50/70 p-4">' +
      '<div class="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">' +
        '<div>' +
          '<p class="text-[10px] uppercase tracking-widest font-bold text-sangha-gold">Local Development Login</p>' +
          status +
        '</div>' +
        '<form id="local-dev-login-form" class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] sm:items-end">' +
          '<label class="text-xs font-bold text-sangha-navy">Username<input name="username" value="' + escapeHtml(userName) + '" class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-normal text-gray-700" autocomplete="username" /></label>' +
          '<label class="text-xs font-bold text-sangha-navy">Password<input name="password" type="password" class="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-normal text-gray-700" autocomplete="current-password" /></label>' +
          '<button type="submit" class="rounded-lg bg-sangha-navy px-4 py-3 text-xs font-bold uppercase tracking-widest text-white hover:bg-blue-900">Set User</button>' +
          '<button type="button" data-action="clear-local-dev-login" class="rounded-lg border border-gray-200 bg-white px-4 py-3 text-xs font-bold uppercase tracking-widest text-sangha-navy hover:bg-sangha-light">Clear</button>' +
        '</form>' +
      '</div>' +
      '<p class="mt-2 text-xs text-gray-500">Password is accepted for preview only and is not stored.</p>' +
    '</section>';
  }

  function wireLocalDevelopmentLogin(root, rerender) {
    var form = root.querySelector("#local-dev-login-form");
    if (!form) return;
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var username = fieldValue(form, "username").trim();
      if (!username || !window.localStorage) return;
      window.localStorage.setItem("ecbs-calendar-current-user-name", username);
      window.localStorage.setItem("ecbs-calendar-current-user-email", emailFromName(username));
      rerender();
    });
    var clearButton = root.querySelector('[data-action="clear-local-dev-login"]');
    if (clearButton) {
      clearButton.addEventListener("click", function () {
        if (window.localStorage) {
          window.localStorage.removeItem("ecbs-calendar-current-user-name");
          window.localStorage.removeItem("ecbs-calendar-current-user-email");
        }
        rerender();
      });
    }
  }

  function addCurrentUserAttendance(store, slot) {
    if (!slot || !isLoggedIn()) return null;
    var existingAttendee = currentUserAttendee(slot);
    if (existingAttendee) return existingAttendee;
    var attendee = makeVolunteer(currentUserName(), "", "", new Date().toISOString(), currentUserEmail());
    slot.attendees = upsertPerson(slot.attendees || [], attendee);
    touchSlot(slot);
    addCalendarHistory(store, "Attendee signed up", slot, calendarHistoryPersonName(attendee) + " signed up to attend this meeting.");
    return attendee;
  }

  function renderPublicSlotCard(slot, nextUpcomingSlotKey, settings, extraClass) {
    settings = normalizeCalendarSettings(settings);
    var meeting = isMeetingSlot(slot);
    var assigned = slot.speaker && slot.speaker.name;
    var past = isPastSlot(slot);
    var canceled = slot.canceled;
    var moved = Boolean(slot.movedToDate);
    var isNext = slotInstanceKey(slot) === nextUpcomingSlotKey;
    var signupsOpen = signupWindowOpen(slot, settings);
    var isNextOpenTalk = isNext && !meeting && !assigned && signupsOpen;
    var signupUrl = appUrl("calendar-item/", { slot: slot.id });
    var attendUrl = appUrl("calendar-item/", { slot: slot.id, attend: "1" });
    var backupUrl = signupUrl + "#talk-backup-form";
    var slotTitle = slot.title || "Calendar item";
    var slotDescription = slot.description || "";
    var backupTitle = backupTooltip(slot);
    var attendanceLabel = attendanceCountLabel(slot);
    var cardClasses = moved
      ? "border-red-200 bg-red-50"
      : past
      ? "border-gray-200 bg-gray-100 opacity-75"
      : canceled
        ? "border-red-200 bg-red-50"
      : isNext
        ? "border-2 border-sangha-gold bg-white shadow-md"
        : "border-gray-200 bg-white";
    var titleClass = moved ? "text-red-700" : past ? "text-gray-500" : canceled ? "text-red-700" : "text-sangha-navy";
    var descriptionClass = moved ? "text-red-700" : past ? "text-gray-500" : canceled ? "text-red-700" : "text-gray-600";
    var primaryActionClass = assigned
      ? (isNext ? "bg-white text-sangha-navy ring-1 ring-sangha-navy/15 hover:bg-sangha-light" : "bg-white text-gray-500 ring-1 ring-gray-200 hover:bg-gray-100")
      : (isNextOpenTalk ? "bg-green-600 text-white shadow-sm hover:bg-green-700" : "bg-white text-sangha-navy ring-1 ring-gray-200 hover:text-sangha-gold hover:ring-sangha-gold");
    var backupActionClass = isNext
      ? "border-sangha-navy/20 bg-white text-sangha-navy shadow-sm hover:border-sangha-gold hover:text-sangha-gold"
      : "border-gray-200 bg-white/80 text-gray-500 shadow-none hover:border-gray-300";

    return '<div class="block rounded-lg border ' + cardClasses + ' p-2 transition-colors ' + (extraClass || "") + '">' +
      '<a href="' + signupUrl + '" class="block rounded-md hover:text-sangha-gold focus:outline-none focus:ring-2 focus:ring-sangha-gold focus:ring-offset-2">' +
        '<div class="text-xs font-bold ' + titleClass + ' line-clamp-2"' + tooltipAttr(slotTitle) + '>' + escapeHtml(compactText(slotTitle, CALENDAR_TITLE_LIMIT)) + '</div>' +
        '<div class="text-xs ' + descriptionClass + ' mt-1 line-clamp-2"' + tooltipAttr(slotDescription) + '>' + escapeHtml(compactText(slotDescription, CALENDAR_DESCRIPTION_LIMIT)) + '</div>' +
        '<div class="text-[10px] uppercase tracking-widest font-bold text-gray-400 mt-2">' + displayTimeRange(slot) + '</div>' +
        '<div class="mt-1 text-[10px] font-bold text-gray-400"' + tooltipAttr(attendanceLabel) + '>' + escapeHtml(attendanceLabel) + '</div>' +
      '</a>' +
      '<div class="mt-2 flex flex-col gap-2">' +
      (moved
        ? '<div class="inline-flex rounded-full bg-red-100 px-2 py-1 text-[10px] uppercase tracking-widest font-bold text-red-700">Moved to ' + escapeHtml(displayNumericShortDate(slot.movedToDate)) + '</div>'
      : past
        ? '<div class="mt-2 inline-flex rounded-full bg-gray-200 px-2 py-1 text-[10px] uppercase tracking-widest font-bold text-gray-500">Past meeting</div>'
        : canceled
          ? '<div class="inline-flex rounded-full bg-red-100 px-2 py-1 text-[10px] uppercase tracking-widest font-bold text-red-700">Canceled</div>'
        : meeting
          ? (signupsOpen ? '<a href="' + attendUrl + '" class="inline-flex w-full min-w-0 items-center justify-center rounded-full px-2 py-2 text-center text-[10px] uppercase tracking-widest font-bold leading-tight ' + primaryActionClass + '">' + (currentUserAttendee(slot) ? 'Attending' : 'Attend') + '</a>' : '<div class="rounded-full bg-gray-50 px-2 py-2 text-center text-[10px] uppercase tracking-widest font-bold leading-tight text-gray-400">' + escapeHtml("Opens " + signupWindowLabel(settings) + " before") + '</div>')
        : assigned
          ? '<a href="' + signupUrl + '" class="inline-flex w-full min-w-0 items-center justify-center rounded-full px-2 py-1 text-center text-xs font-bold ' + primaryActionClass + '">' + escapeHtml(publicName(slot.speaker.name)) + '</a>'
          : (signupsOpen ? '<a href="' + signupUrl + '" class="inline-flex w-full min-w-0 items-center justify-center rounded-full px-2 py-2 text-center text-[10px] uppercase tracking-widest font-bold leading-tight ' + primaryActionClass + '">Open for volunteer</a>' : '<div class="rounded-full bg-gray-50 px-2 py-2 text-center text-[10px] uppercase tracking-widest font-bold leading-tight text-gray-400">' + escapeHtml("Opens " + signupWindowLabel(settings) + " before") + '</div>')) +
      (past || canceled || meeting || !signupsOpen ? '' : '<a href="' + backupUrl + '" class="inline-flex w-full min-w-0 flex-col items-center justify-center rounded-full border px-2 py-1.5 text-center ' + backupActionClass + '"' + tooltipAttr(backupTitle) + ' aria-label="' + escapeHtml(backupTitle) + '"><span class="text-[9px] font-bold leading-none text-gray-400">' + backupCountLabel(slot) + '</span><span class="mt-1 text-[10px] uppercase tracking-widest font-bold leading-tight">Sign up as backup</span></a>') +
      '</div>' +
    '</div>';
  }

  function renderPublicDayCell(day, activeMonth, slots, nextUpcomingSlotKey, settings) {
    settings = normalizeCalendarSettings(settings);
    var muted = day.getMonth() !== activeMonth ? " bg-gray-50 text-gray-400" : " bg-white text-sangha-navy";
    var today = dateKey(day) === dateKey(new Date()) ? " ring-2 ring-green-500 ring-inset" : "";
    var daySlots = slots.map(function (slot) {
      return renderPublicSlotCard(slot, nextUpcomingSlotKey, settings, "mt-2");
    }).join("");

    return '<div class="min-h-28 sm:min-h-36 md:min-h-44 p-2 md:p-3' + muted + today + '">' +
      '<div class="font-bold leading-none">' + calendarDayLabel(day) + '</div>' +
      daySlots +
    '</div>';
  }

  function renderAdmin(root, state) {
    var requestedMonth = initialMonthFromQuery();
    var month = state && state.month != null ? state.month : requestedMonth.month;
    var year = state && state.year != null ? state.year : requestedMonth.year;
    var selectedDate = state && state.selectedDate ? state.selectedDate : null;
    var notice = state && state.notice ? state.notice : "";
    var confirmAction = state && state.confirmAction ? state.confirmAction : null;
    var itemTypePrompt = state && state.itemTypePrompt ? state.itemTypePrompt : false;
    var createBasicsPrompt = state && state.createBasicsPrompt ? state.createBasicsPrompt : false;
    var editRecurrenceId = state && state.editRecurrenceId ? state.editRecurrenceId : "";
    var selectedSlotId = state && state.selectedSlotId ? state.selectedSlotId : "";
    var store = ensureCalendarRenderSlots(loadStore(), year, month);
    var selectedSlot = selectedSlotId
      ? findSlotById(store, selectedSlotId)
      : (selectedDate && !itemTypePrompt ? getOrCreateSlotForDate(store, selectedDate) : null);

    renderShell(root,
      '<div class="rounded-2xl border border-sangha-gold/40 bg-yellow-50/70 p-4 md:p-6 shadow-sm">' +
      renderAdminNotice(notice) +
      '<div class="grid gap-6">' +
        '<div class="bg-white rounded-2xl shadow-sm border border-sangha-gold/40 overflow-hidden">' +
          renderMonthControls(year, month, MONTH_LABELS[month] + " " + year, "Click a date to create or edit its calendar item.") +
          calendarGridHtml(year, month, store, "admin") +
        '</div>' +
      '</div>' +
      renderAdminEmailCopyBlock(store) +
      renderCalendarSettingsBlock(store) +
      renderRecurringMeetingsBlock(store, editRecurrenceId) +
      renderAdminQueuedEmailBlock(store) +
      renderCalendarHistory(store) +
      '</div>' +
      (selectedSlot && !itemTypePrompt && !createBasicsPrompt ? renderAdminPanel(selectedSlot, Boolean(selectedSlot.isDraft), store.settings) : '') +
      (selectedDate && itemTypePrompt ? renderItemTypePromptModal(selectedSlot, selectedDate) : '') +
      (selectedSlot && createBasicsPrompt ? renderCreateBasicsModal(selectedSlot, store.settings) : '') +
      (confirmAction ? renderAdminConfirmModal(confirmAction, store) : ''));

    wireAdminConfirmActions(root, confirmAction, year, month, selectedDate, selectedSlot);
    wireMonthControls(root, renderAdmin, year, month);
    wireAdminCopyBlock(root);
    wireCalendarSettingsBlock(root, year, month);
    wireRecurringMeetingsBlock(root, year, month);
    wireLocationControls(root);

    root.querySelectorAll("[data-admin-slot-id]").forEach(function (button) {
      button.addEventListener("click", function (event) {
        event.stopPropagation();
        var slotId = button.getAttribute("data-admin-slot-id");
        var slot = findSlotById(store, slotId);
        renderAdmin(root, { year: year, month: month, selectedDate: slot ? slot.date : selectedDate, selectedSlotId: slotId });
      });
    });

    root.querySelectorAll("[data-admin-date]").forEach(function (cell) {
      cell.addEventListener("click", function () {
        renderAdmin(root, { year: year, month: month, selectedDate: cell.getAttribute("data-admin-date"), itemTypePrompt: true });
      });
    });

    root.querySelectorAll("[data-select-item-type]").forEach(function (button) {
      button.addEventListener("click", function () {
        var nextType = button.getAttribute("data-select-item-type");
        var editableSlot = selectedSlot || createSlotForDate(store, selectedDate);
        editableSlot.itemType = nextType === "meeting" ? "meeting" : "talk";
        if (isMeetingSlot(editableSlot) && editableSlot.title === DEFAULT_TITLE) {
          editableSlot.title = "Regular meeting";
          editableSlot.description = "";
        }
        if (isTalkSlot(editableSlot) && editableSlot.title === "Regular meeting") {
          editableSlot.title = DEFAULT_TITLE;
          editableSlot.description = DEFAULT_DESCRIPTION;
        }
        touchSlot(editableSlot);
        saveStore(store);
        renderAdmin(root, { year: year, month: month, selectedDate: editableSlot.date, selectedSlotId: editableSlot.id, createBasicsPrompt: true });
      });
    });

    var basicsForm = root.querySelector("#calendar-basics-form");
    if (basicsForm && selectedSlot) {
      basicsForm.addEventListener("submit", function (event) {
        event.preventDefault();
        var expectedRevision = Number(basicsForm.getAttribute("data-slot-revision") || 0);
        var fresh = freshSlotForAction(selectedSlot.id, expectedRevision, year, month);
        if (fresh.conflict) {
          renderAdmin(root, { year: year, month: month, selectedDate: fresh.slot ? fresh.slot.date : selectedDate, selectedSlotId: fresh.slot ? fresh.slot.id : "", notice: fresh.conflict });
          return;
        }
        var slot = fresh.slot;
        slot.date = fieldValue(basicsForm, "date") || slot.date;
        slot.startTime = fieldValue(basicsForm, "startTime") || DEFAULT_START_TIME;
        slot.endTime = fieldValue(basicsForm, "endTime") || DEFAULT_END_TIME;
        slot.title = fieldValue(basicsForm, "title") || (isMeetingSlot(slot) ? "Regular meeting" : DEFAULT_TITLE);
        slot.description = fieldValue(basicsForm, "description");
        slot.usePhysicalLocation = checkboxValue(basicsForm, "usePhysicalLocation");
        slot.useDefaultLocation = checkboxValue(basicsForm, "useDefaultLocation");
        slot.location = locationValueFromForm(basicsForm, fresh.store.settings);
        slot.useZoom = checkboxValue(basicsForm, "useZoom");
        updateOccurrenceOverrides(slot, fresh.store.recurrences.find(function (rule) { return rule.id === slot.recurrenceId; }));
        slot.isDraft = false;
        touchSlot(slot);
        addCalendarHistory(fresh.store, "Created calendar item", slot, "Created " + calendarHistoryItemLabel(slot) + ".");
        fresh.store.slots.sort(byDateTime);
        saveStore(fresh.store);
        renderAdmin(root, { year: parseDate(slot.date).getFullYear(), month: parseDate(slot.date).getMonth(), selectedDate: slot.date, selectedSlotId: slot.id });
      });
    }

    var form = root.querySelector("#talk-slot-form");
    var saveSelectedSlotForm = null;
    if (form && selectedSlot) {
      form.setAttribute("data-initial-signature", adminSlotFormSignature(form));
      saveSelectedSlotForm = function (closeAfterSave) {
        var expectedRevision = Number(form.getAttribute("data-slot-revision") || 0);
        var fresh = freshSlotForAction(selectedSlot.id, expectedRevision, year, month);
        if (fresh.conflict) {
          renderAdmin(root, { year: year, month: month, selectedDate: fresh.slot ? fresh.slot.date : selectedDate, selectedSlotId: fresh.slot ? fresh.slot.id : "", notice: fresh.conflict });
          return;
        }
        var editableSlot = fresh.slot;
        var oldSlot = normalizeSlot(editableSlot);
        var newDate = fieldValue(form, "date") || selectedSlot.date;
        var newStartTime = fieldValue(form, "startTime") || DEFAULT_START_TIME;
        var newEndTime = fieldValue(form, "endTime") || DEFAULT_END_TIME;
        var newUsePhysicalLocation = checkboxValue(form, "usePhysicalLocation");
        var newUseDefaultLocation = checkboxValue(form, "useDefaultLocation");
        var newLocation = locationValueFromForm(form, fresh.store.settings);
        var newUseZoom = checkboxValue(form, "useZoom");
        var changes = [];
        var timeChanged = newStartTime !== editableSlot.startTime || newEndTime !== editableSlot.endTime;
        if (newDate !== editableSlot.date) changes.push("date changed from " + displayDate(editableSlot.date) + " to " + displayDate(newDate));
        if (timeChanged) changes.push("time changed from " + displayTimeRange(editableSlot) + " to " + displayTimeRange({ startTime: newStartTime, endTime: newEndTime }));
        if (newLocation !== (editableSlot.location || DEFAULT_LOCATION)) changes.push("location changed");
        if (newUsePhysicalLocation !== Boolean(editableSlot.usePhysicalLocation)) changes.push(newUsePhysicalLocation ? "physical location added" : "physical location removed");
        if (newUseZoom !== Boolean(editableSlot.useZoom)) changes.push(newUseZoom ? "Zoom added" : "Zoom removed");
        if (timeChanged && signedUpPeople(editableSlot).length) {
          var confirmedTimeChange = window.confirm("Change this meeting time? Signed-up people will receive an email notice with the updated time.");
          if (!confirmedTimeChange) return;
        }
        editableSlot.date = newDate;
        editableSlot.startTime = newStartTime;
        editableSlot.endTime = newEndTime;
        editableSlot.title = fieldValue(form, "title") || (isMeetingSlot(editableSlot) ? "Regular meeting" : DEFAULT_TITLE);
        editableSlot.description = fieldValue(form, "description");
        editableSlot.usePhysicalLocation = newUsePhysicalLocation;
        editableSlot.useDefaultLocation = newUseDefaultLocation;
        editableSlot.location = newLocation;
        editableSlot.useZoom = newUseZoom;
        updateOccurrenceOverrides(editableSlot, fresh.store.recurrences.find(function (rule) { return rule.id === editableSlot.recurrenceId; }));
        var wasDraft = Boolean(editableSlot.isDraft);
        editableSlot.isDraft = false;
        queueSlotChangeNotifications(editableSlot, oldSlot, changes);
        touchSlot(editableSlot);
        addCalendarHistory(fresh.store, wasDraft ? "Created calendar item" : "Saved calendar item", editableSlot, wasDraft ? "Created " + calendarHistoryItemLabel(editableSlot) + "." : (changes.length ? "Updated " + calendarHistoryItemLabel(editableSlot) + ": " + changes.join("; ") + "." : "Updated " + calendarHistoryItemLabel(editableSlot) + "."));
        fresh.store.slots.sort(byDateTime);
        saveStore(fresh.store);
        var nextYear = parseDate(editableSlot.date).getFullYear();
        var nextMonth = parseDate(editableSlot.date).getMonth();
        renderAdmin(root, closeAfterSave
          ? { year: nextYear, month: nextMonth, notice: "Calendar item saved." }
          : { year: nextYear, month: nextMonth, selectedDate: editableSlot.date, selectedSlotId: editableSlot.id, notice: "Calendar item saved." });
      };
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        saveSelectedSlotForm(true);
      });
    }

    var closeButton = root.querySelector("[data-close-admin-modal]");
    if (closeButton) {
      closeButton.addEventListener("click", function () {
        if (form && selectedSlot && adminSlotFormHasChanges(form)) {
          var saveBeforeClosing = window.confirm("Save changes before closing? Choose OK to save, or Cancel to close without saving.");
          if (saveBeforeClosing && saveSelectedSlotForm) {
            saveSelectedSlotForm(true);
            return;
          }
        }
        if (selectedSlot && selectedSlot.isDraft) {
          var freshStore = loadStore();
          freshStore.slots = freshStore.slots.filter(function (slot) { return slot.id !== selectedSlot.id; });
          saveStore(freshStore);
        }
        renderAdmin(root, { year: year, month: month });
      });
    }

    var clearButton = root.querySelector("[data-clear-speaker]");
    if (clearButton && selectedSlot) {
      clearButton.addEventListener("click", function () {
        renderAdmin(root, { year: year, month: month, selectedDate: selectedSlot.date, selectedSlotId: selectedSlot.id, confirmAction: { type: "clear-speaker", slotId: selectedSlot.id, expectedRevision: selectedSlot.revision } });
      });
    }

    root.querySelectorAll("[data-clear-backup]").forEach(function (button) {
      button.addEventListener("click", function () {
        var index = Number(button.getAttribute("data-clear-backup"));
        renderAdmin(root, { year: year, month: month, selectedDate: selectedSlot.date, selectedSlotId: selectedSlot.id, confirmAction: { type: "clear-backup", slotId: selectedSlot.id, backupIndex: index, expectedRevision: selectedSlot.revision } });
      });
    });

    root.querySelectorAll("[data-clear-attendee]").forEach(function (button) {
      button.addEventListener("click", function () {
        var index = Number(button.getAttribute("data-clear-attendee"));
        renderAdmin(root, { year: year, month: month, selectedDate: selectedSlot.date, selectedSlotId: selectedSlot.id, confirmAction: { type: "clear-attendee", slotId: selectedSlot.id, attendeeIndex: index, expectedRevision: selectedSlot.revision } });
      });
    });

    wireAdminAssignmentForm(root, selectedSlot, "admin-speaker-form", "speaker", year, month);
    wireAdminAssignmentForm(root, selectedSlot, "admin-backup-form", "backup", year, month);
    wireAdminAssignmentForm(root, selectedSlot, "admin-attendee-form", "attendee", year, month);

    var cancelMeetingButton = root.querySelector("[data-cancel-meeting]");
    if (cancelMeetingButton && selectedSlot) {
      cancelMeetingButton.addEventListener("click", function () {
        renderAdmin(root, { year: year, month: month, selectedDate: selectedSlot.date, selectedSlotId: selectedSlot.id, confirmAction: { type: "cancel-meeting", slotId: selectedSlot.id, expectedRevision: selectedSlot.revision } });
      });
    }

    var removeCanceledButton = root.querySelector("[data-remove-canceled-meeting]");
    if (removeCanceledButton && selectedSlot) {
      removeCanceledButton.addEventListener("click", function () {
        renderAdmin(root, { year: year, month: month, selectedDate: selectedSlot.date, selectedSlotId: selectedSlot.id, confirmAction: { type: "remove-meeting", slotId: selectedSlot.id, expectedRevision: selectedSlot.revision } });
      });
    }

    var pushWeekButton = root.querySelector("[data-push-week]");
    if (pushWeekButton && selectedSlot) {
      pushWeekButton.addEventListener("click", function () {
        var preview = adminActionPreview({ type: "push-week", slotId: selectedSlot.id }, store);
        if (!preview.recipients.length) {
          performConfirmedAdminAction(root, { type: "push-week", slotId: selectedSlot.id, expectedRevision: selectedSlot.revision }, year, month, selectedDate, { sendEmail: false });
          return;
        }
        renderAdmin(root, { year: year, month: month, selectedDate: selectedSlot.date, selectedSlotId: selectedSlot.id, confirmAction: { type: "push-week", slotId: selectedSlot.id, expectedRevision: selectedSlot.revision } });
      });
    }

  }

  function wireAdminConfirmActions(root, confirmAction, year, month, selectedDate, selectedSlot) {
    var cancelAdminActionButton = root.querySelector("[data-cancel-admin-action]");
    if (cancelAdminActionButton && selectedSlot) {
      cancelAdminActionButton.addEventListener("click", function () {
        renderAdmin(root, { year: year, month: month, selectedDate: selectedSlot.date, selectedSlotId: selectedSlot.id });
      });
    }

    var confirmAdminActionButton = root.querySelector("[data-confirm-admin-action]");
    if (confirmAdminActionButton && confirmAction) {
      confirmAdminActionButton.addEventListener("click", function () {
        var emailCheckbox = root.querySelector("[data-send-email-notice]");
        var cancelModeInput = root.querySelector('[name="cancelMode"]:checked');
        performConfirmedAdminAction(root, confirmAction, year, month, selectedDate, {
          sendEmail: !emailCheckbox || emailCheckbox.checked,
          cancelMode: cancelModeInput ? cancelModeInput.value : "mark"
        });
      });
    }
  }

  function getOrCreateSlotForDate(store, selectedDate) {
    var slot = store.slots.find(function (item) { return item.date === selectedDate; });
    if (slot) return slot;
    slot = createSlotForDate(store, selectedDate);
    touchSlot(slot);
    saveStore(store);
    return slot;
  }

  function createSlotForDate(store, selectedDate) {
    var settings = normalizeCalendarSettings(store.settings);
    var slot = {
      id: uid(),
      date: selectedDate,
      startTime: DEFAULT_START_TIME,
      endTime: DEFAULT_END_TIME,
      itemType: "talk",
      isDraft: true,
      occurrenceOverrides: [],
      title: DEFAULT_TITLE,
      description: DEFAULT_DESCRIPTION,
      usePhysicalLocation: true,
      useDefaultLocation: true,
      location: settings.defaultLocation,
      useZoom: false,
      canceled: false,
      speaker: null,
      backups: [],
      attendees: [],
      notifications: []
    };
    store.slots.push(slot);
    store.slots.sort(byDateTime);
    return slot;
  }

  function adminSlotFormSignature(form) {
    return JSON.stringify({
      date: fieldValue(form, "date"),
      startTime: fieldValue(form, "startTime"),
      endTime: fieldValue(form, "endTime"),
      title: fieldValue(form, "title"),
      description: fieldValue(form, "description"),
      usePhysicalLocation: checkboxValue(form, "usePhysicalLocation"),
      useDefaultLocation: checkboxValue(form, "useDefaultLocation"),
      location: fieldValue(form, "location"),
      useZoom: checkboxValue(form, "useZoom")
    });
  }

  function adminSlotFormHasChanges(form) {
    return form && form.getAttribute("data-initial-signature") !== adminSlotFormSignature(form);
  }

  function wireAdminAssignmentForm(root, selectedSlot, formId, role, year, month) {
    var form = root.querySelector("#" + formId);
    if (!form || !selectedSlot) return;
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var expectedRevision = Number(form.getAttribute("data-slot-revision") || 0);
      var fresh = freshSlotForAction(selectedSlot.id, expectedRevision, year, month);
      if (fresh.conflict) {
        renderAdmin(root, { year: year, month: month, selectedDate: fresh.slot ? fresh.slot.date : selectedSlot.date, selectedSlotId: fresh.slot ? fresh.slot.id : "", notice: fresh.conflict });
        return;
      }
      var slot = fresh.slot;
      var person = assignPersonToSlot(slot, role, fieldValue(form, "name"), fieldValue(form, "email"));
      if (!person) {
        renderAdmin(root, { year: year, month: month, selectedDate: slot.date, selectedSlotId: slot.id, notice: "Enter a name before assigning someone." });
        return;
      }
      touchSlot(slot);
      addCalendarHistory(fresh.store, adminAssignmentHistoryAction(role), slot, adminAssignmentHistorySummary(role, person, slot));
      saveStore(fresh.store);
      renderAdmin(root, { year: parseDate(slot.date).getFullYear(), month: parseDate(slot.date).getMonth(), selectedDate: slot.date, selectedSlotId: slot.id, notice: publicName(person.name) + " was assigned." });
    });
  }

  function adminAssignmentHistoryAction(role) {
    if (role === "speaker") return "Assigned speaker";
    if (role === "backup") return "Assigned backup";
    return "Assigned attendee";
  }

  function adminAssignmentRoleLabel(role) {
    if (role === "speaker") return "the person bringing the talk";
    if (role === "backup") return "a backup volunteer";
    return "an attendee";
  }

  function adminAssignmentHistorySummary(role, person, slot) {
    if (role === "speaker") return calendarHistoryPersonName(person) + " was assigned to bring this talk.";
    if (role === "backup") return calendarHistoryPersonName(person) + " was added as a backup for this talk.";
    return calendarHistoryPersonName(person) + " was added as attending this " + (isTalkSlot(slot) ? "talk" : "meeting") + ".";
  }

  function renderAdminDayCell(day, activeMonth, slots, nextUpcomingSlotKey) {
    var key = dateKey(day);
    var muted = day.getMonth() !== activeMonth ? " bg-gray-50 text-gray-400" : " bg-white text-sangha-navy";
    var today = key === dateKey(new Date()) ? " ring-2 ring-green-500 ring-inset" : "";
    var slotMarkup = slots.map(function (slot) {
      var meeting = isMeetingSlot(slot);
      var assigned = slot.speaker && slot.speaker.name;
      var past = isPastSlot(slot);
      var canceled = slot.canceled;
      var moved = Boolean(slot.movedToDate);
      var isNext = slotInstanceKey(slot) === nextUpcomingSlotKey;
      var isNextOpenTalk = isNext && !meeting && !assigned;
      var slotTitle = slot.title || "Talk offering";
      var slotDescription = slot.description || "";
      var cardClasses = moved
        ? 'border-red-200 bg-red-50'
        : past
        ? 'border-gray-200 bg-gray-100 opacity-75'
        : canceled
          ? 'border-red-200 bg-red-50'
          : isNext
            ? 'border-2 border-sangha-gold bg-white shadow-md'
            : assigned
              ? 'border-gray-200 bg-white'
              : 'border-gray-200 bg-white';
      var openBadgeClass = isNextOpenTalk ? 'bg-green-600 text-white shadow-sm' : 'bg-white text-gray-500 ring-1 ring-gray-200';
      return '<button type="button" data-admin-slot-id="' + escapeHtml(slot.id) + '" class="mt-2 block w-full rounded-lg border ' + cardClasses + ' p-2 text-left hover:border-sangha-gold focus:outline-none focus:ring-2 focus:ring-sangha-gold" aria-label="Edit ' + escapeHtml(slotTitle) + '">' +
        '<div class="text-xs font-bold ' + (moved ? 'text-red-700' : past ? 'text-gray-500' : canceled ? 'text-red-700' : 'text-sangha-navy') + ' line-clamp-2"' + tooltipAttr(slotTitle) + '>' + escapeHtml(compactText(slotTitle, CALENDAR_TITLE_LIMIT)) + '</div>' +
        '<div class="text-xs ' + (moved ? 'text-red-700' : past ? 'text-gray-500' : canceled ? 'text-red-700' : 'text-gray-600') + ' mt-1 line-clamp-2"' + tooltipAttr(slotDescription) + '>' + escapeHtml(compactText(slotDescription, CALENDAR_DESCRIPTION_LIMIT)) + '</div>' +
        '<div class="text-[10px] uppercase tracking-widest font-bold text-gray-400 mt-2">' + displayTimeRange(slot) + '</div>' +
        '<div class="mt-1 text-[10px] font-bold text-gray-400">' + escapeHtml(attendanceCountLabel(slot)) + '</div>' +
        (moved
          ? '<div class="mt-2 inline-flex rounded-full bg-red-100 px-2 py-1 text-[10px] uppercase tracking-widest font-bold text-red-700">Moved to ' + escapeHtml(displayNumericShortDate(slot.movedToDate)) + '</div>'
        : past
          ? '<div class="mt-2 inline-flex rounded-full bg-gray-200 px-2 py-1 text-[10px] uppercase tracking-widest font-bold text-gray-500">Past meeting</div>'
          : canceled
            ? '<div class="mt-2 inline-flex rounded-full bg-red-100 px-2 py-1 text-[10px] uppercase tracking-widest font-bold text-red-700">Canceled</div>'
          : meeting
            ? '<div class="mt-2 inline-flex rounded-full bg-blue-50 px-3 py-1 text-[10px] uppercase tracking-widest font-bold text-sangha-navy">' + attendanceCount(slot) + ' attending</div>'
          : assigned
            ? '<div class="mt-2 text-xs font-bold text-sangha-navy">' + escapeHtml(publicName(slot.speaker.name)) + '</div>'
            : '<div class="mt-2 inline-flex rounded-full px-3 py-1 text-[10px] uppercase tracking-widest font-bold ' + openBadgeClass + '">Open</div>') +
      '</button>';
    }).join("");

    var bottomPadding = slots.length ? " pb-5 md:pb-6" : " pb-3 md:pb-4";
    return '<div data-admin-date="' + key + '" class="group min-h-28 sm:min-h-36 md:min-h-44 cursor-pointer px-2 pt-2 md:px-3 md:pt-3' + bottomPadding + ' text-left hover:bg-yellow-50' + muted + today + '">' +
      '<div class="font-bold leading-none">' + calendarDayLabel(day) + '</div>' +
      slotMarkup +
      '<div class="mt-2 flex justify-center text-lg leading-none font-bold text-gray-300 transition-colors group-hover:text-sangha-gold" style="cursor: pointer; user-select: none;" aria-hidden="true">+</div>' +
    '</div>';
  }

  function upcomingCalendarEmailRows(store) {
    var today = dateKey(new Date());
    var upcoming = store.slots.filter(function (slot) {
      return slot.date >= today && (!isDefaultEmptySlot(slot) || slot.date <= shiftDateByDays(today, 42));
    }).sort(byDateTime);
    if (!upcoming.length) return [];
    return upcoming.map(function (slot) {
      var scheduleUrl = absoluteAppUrl("calendar-item/", { slot: slot.id });
      var attendUrl = absoluteAppUrl("calendar-item/", { slot: slot.id, attend: "1" });
      var title = slot.title || (isMeetingSlot(slot) ? "Meeting" : DEFAULT_TITLE);
      var zoomLink = zoomLinkForSlot(slot, store);
      if (isMeetingSlot(slot)) {
        return {
          date: displayShortDate(slot.date),
          title: title,
          titleHref: scheduleUrl,
          actions: [
            { text: slot.canceled ? "canceled" : "attend", href: attendUrl }
          ].concat(zoomLink ? [{ text: "Zoom", href: zoomLink }] : [])
        };
      }
      return {
        date: displayShortDate(slot.date),
        title: title,
        titleHref: scheduleUrl,
        actions: [
          slot.canceled
            ? { text: "canceled", href: scheduleUrl }
            : slot.speaker && slot.speaker.name
              ? { text: publicName(slot.speaker.name), href: "", kind: "name" }
              : { text: "volunteer to bring talk", href: scheduleUrl }
        ].concat(zoomLink ? [{ text: "Zoom", href: zoomLink }] : [])
      };
    });
  }

  function zoomLinkForSlot(slot, storeOrSettings) {
    if (!slot || !slot.useZoom) return "";
    var settings = normalizeCalendarSettings(storeOrSettings && storeOrSettings.settings ? storeOrSettings.settings : storeOrSettings);
    return settings.zoomLink || "";
  }

  function isSlotOccurringNow(slot) {
    if (!slot || slot.date !== dateKey(new Date())) return false;
    var now = new Date();
    var minutes = now.getHours() * 60 + now.getMinutes();
    var startParts = (slot.startTime || DEFAULT_START_TIME).split(":");
    var endParts = (slot.endTime || DEFAULT_END_TIME).split(":");
    var start = Number(startParts[0] || 0) * 60 + Number(startParts[1] || 0);
    var end = Number(endParts[0] || 0) * 60 + Number(endParts[1] || 0);
    return minutes >= start && minutes <= end;
  }

  function renderZoomSummary(slot, store) {
    var zoomLink = zoomLinkForSlot(slot, store);
    if (!zoomLink) return "";
    var label = isSlotOccurringNow(slot) ? "Join Zoom" : "Zoom Link";
    return '<div class="mt-5 rounded-xl border border-blue-100 bg-blue-50 p-4">' +
      '<p class="text-xs uppercase tracking-widest font-bold text-sangha-navy mb-2">Online</p>' +
      '<a href="' + escapeHtml(zoomLink) + '" target="_blank" rel="noopener" class="inline-flex rounded-lg bg-sangha-navy px-4 py-3 text-xs uppercase tracking-widest font-bold text-white hover:bg-blue-900">' + escapeHtml(label) + '</a>' +
    '</div>';
  }

  function upcomingCalendarEmailText(store) {
    var rows = upcomingCalendarEmailRows(store);
    if (!rows.length) return "No upcoming calendar items are currently scheduled.";
    return rows.map(function (row) {
      var title = row.titleHref ? row.title + " (" + row.titleHref + ")" : row.title;
      return row.date + ": " + title + ": " + row.actions.map(function (action) {
        return action.href ? action.text + " (" + action.href + ")" : action.text;
      }).join(", ");
    }).join("\n");
  }

  function upcomingCalendarEmailHtml(store) {
    var rows = upcomingCalendarEmailRows(store);
    if (!rows.length) return '<p>No upcoming calendar items are currently scheduled.</p>';
    return rows.map(function (row) {
      var titleMarkup = row.titleHref
        ? '<a href="' + escapeHtml(row.titleHref) + '" style="color:inherit;text-decoration:none;">' + escapeHtml(row.title) + '</a>'
        : escapeHtml(row.title);
      return '<p class="mb-2">' + escapeHtml(row.date) + ': ' + titleMarkup + ': ' + row.actions.map(function (action) {
        if (action.href) return '<a href="' + escapeHtml(action.href) + '" style="color:#2563eb;text-decoration:underline;">' + escapeHtml(action.text) + '</a>';
        if (action.kind === "name") return '<span style="color:#c76a00;font-weight:700;">' + escapeHtml(action.text) + '</span>';
        return escapeHtml(action.text);
      }).join(", ") + '</p>';
    }).join("");
  }

  function renderAdminEmailCopyBlock(store) {
    var text = upcomingCalendarEmailText(store);
    var html = upcomingCalendarEmailHtml(store);
    return '<section class="mt-6 rounded-2xl border border-sangha-gold/30 bg-white p-5 shadow-sm">' +
      '<div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">' +
        '<div>' +
          '<h2 class="font-serif text-xl font-bold text-sangha-navy mb-2">Upcoming Calendar Email Block</h2>' +
          '<p class="text-sm text-gray-600 leading-relaxed">Copy this into an email to share the current upcoming calendar items.</p>' +
        '</div>' +
        '<button type="button" data-copy-upcoming-talks class="rounded-lg bg-sangha-navy px-4 py-3 text-xs uppercase tracking-widest font-bold text-white hover:bg-blue-900">Copy</button>' +
      '</div>' +
      '<div data-upcoming-talks-html class="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-700">' + html + '</div>' +
      '<textarea readonly data-upcoming-talks-text aria-hidden="true" tabindex="-1" class="absolute h-px w-px overflow-hidden opacity-0 pointer-events-none">' + escapeHtml(text) + '</textarea>' +
      '<textarea readonly data-upcoming-talks-html-source aria-hidden="true" tabindex="-1" class="absolute h-px w-px overflow-hidden opacity-0 pointer-events-none">' + escapeHtml(html) + '</textarea>' +
      '<p data-copy-upcoming-talks-status class="mt-2 text-xs text-gray-500"></p>' +
    '</section>';
  }

  function renderAdminNotice(notice) {
    if (!notice) return "";
    return '<div class="mb-6 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-sangha-navy">' + escapeHtml(notice) + '</div>';
  }

  function renderAdminQueuedEmailBlock(store) {
    var notices = [];
    (store.slots || []).forEach(function (slot) {
      (slot.notifications || []).forEach(function (notice) {
        notices.push({ slot: slot, notice: notice });
      });
    });
    notices.sort(function (a, b) {
      return String(b.notice.queuedAt || "").localeCompare(String(a.notice.queuedAt || ""));
    });
    var rows = notices.slice(0, 12).map(function (entry) {
      var notice = entry.notice;
      var slot = entry.slot;
      return '<li class="border-b border-gray-100 py-3 last:border-b-0">' +
        '<div class="flex flex-wrap items-center justify-between gap-2">' +
          '<span class="text-sm font-bold text-sangha-navy">' + escapeHtml(publicName(notice.toName)) + '</span>' +
          '<span class="text-xs text-gray-400">' + escapeHtml(notice.toEmail) + '</span>' +
        '</div>' +
        '<p class="mt-1 text-xs text-gray-500">' + escapeHtml(displayShortDate(slot.date) + ": " + (slot.title || "Calendar item")) + '</p>' +
        '<p class="mt-1 text-xs text-gray-500">' + escapeHtml(notice.subject) + '</p>' +
        '<a class="text-xs text-sangha-gold hover:text-yellow-600 break-all" href="' + escapeHtml(notice.link) + '">' + escapeHtml(notice.link) + '</a>' +
      '</li>';
    }).join("");
    return '<details data-admin-section="email-notices" class="mt-6 rounded-2xl border border-gray-200 bg-white shadow-sm">' +
      '<summary class="cursor-pointer list-none rounded-2xl p-5 hover:bg-sangha-light">' +
        '<div class="flex flex-wrap items-center justify-between gap-3">' +
          '<div>' +
            '<h2 class="font-serif text-xl font-bold text-sangha-navy mb-2">Email Notices Queued</h2>' +
            '<p class="text-sm text-gray-600 leading-relaxed">Preview records for cancellation, backup, and schedule-change notices.</p>' +
          '</div>' +
          '<span class="rounded-full bg-sangha-light px-3 py-1 text-[10px] uppercase tracking-widest font-bold text-sangha-navy">' + notices.length + ' queued</span>' +
        '</div>' +
      '</summary>' +
      '<ul class="border-t border-gray-100 px-5 pb-5">' + (rows || '<li class="pt-4 text-sm text-gray-500">No email notices are queued.</li>') + '</ul>' +
    '</details>';
  }

  function emailTemplateItems() {
    return [
      {
        title: "Talk Signup Confirmation",
        subject: "You are signed up to bring the talk on {date}",
        body: "Hi {name},\n\nThank you for volunteering to bring the talk on {date} at {time}.\n\nCalendar item: {title}\nCalendar item link: {schedule_link}\n\nYou can return to the link to update your optional talk link, notes, and reminder preferences or cancel if needed.\n\nWith appreciation,\nEau Claire Buddhist Sangha"
      },
      {
        title: "Backup Signup Confirmation",
        subject: "You are signed up as a backup for {date}",
        body: "Hi {name},\n\nThank you for being willing to serve as a backup for {title} on {date}.\n\nIf the person bringing the talk cannot make it, you can return to the calendar item link and choose Volunteer.\n\nCalendar item link: {schedule_link}\n\nWith appreciation,\nEau Claire Buddhist Sangha"
      },
      {
        title: "Attendance Confirmation",
        subject: "You are marked as attending on {date}",
        body: "Hi {name},\n\nYou are marked as planning to attend {title} on {date} at {time}.\n\nCalendar item link: {schedule_link}\n{zoom_line}\n\nYou can return to the link to update reminder preferences or cancel your attendance.\n\nWith appreciation,\nEau Claire Buddhist Sangha"
      },
      {
        title: "Backup Needed After Cancellation",
        subject: "Backup help may be needed for {date}",
        body: "Hi {name},\n\nThe person who was bringing the talk for {title} on {date} has canceled.\n\nIf you are still able to bring the talk, please return to the calendar item link and choose Volunteer.\n\nCalendar item link: {schedule_link}\n\nWith appreciation,\nEau Claire Buddhist Sangha"
      },
      {
        title: "Meeting Canceled",
        subject: "{title} on {date} has been canceled",
        body: "Hi {name},\n\nThis is a note that {title} on {date} at {time} has been canceled.\n\nCalendar item link: {schedule_link}\n\nWith appreciation,\nEau Claire Buddhist Sangha"
      },
      {
        title: "Meeting Moved",
        subject: "{title} has moved from {old_date} to {new_date}",
        body: "Hi {name},\n\nThis is a note that {title} has moved from {old_date} to {new_date} at {time}.\n\nCalendar item link: {schedule_link}\n{zoom_line}\n\nWith appreciation,\nEau Claire Buddhist Sangha"
      },
      {
        title: "Reminder",
        subject: "Reminder: {title} is coming up on {date}",
        body: "Hi {name},\n\nThis is your reminder for {title} on {date} at {time}.\n\nCalendar item link: {schedule_link}\n{zoom_line}\n\nWith appreciation,\nEau Claire Buddhist Sangha"
      }
    ];
  }

  function renderEmailTemplatesBlock() {
    var rows = emailTemplateItems().map(function (template) {
      return '<li class="rounded-xl border border-gray-200 bg-gray-50 p-4">' +
        '<h3 class="font-serif text-lg font-bold text-sangha-navy">' + escapeHtml(template.title) + '</h3>' +
        '<p class="mt-2 text-xs text-gray-500"><span class="font-bold text-sangha-navy">Subject:</span> ' + escapeHtml(template.subject) + '</p>' +
        '<textarea readonly class="mt-3 min-h-40 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs leading-relaxed text-gray-600 focus:outline-none">' + escapeHtml(template.body) + '</textarea>' +
      '</li>';
    }).join("");
    return '<details data-admin-section="email-templates" class="mt-5 rounded-xl border border-blue-100 bg-white">' +
      '<summary class="cursor-pointer list-none rounded-xl px-4 py-3 text-xs uppercase tracking-widest font-bold text-sangha-navy hover:bg-sangha-light">Email Templates</summary>' +
      '<div class="border-t border-blue-100 p-4">' +
        '<p class="mb-4 text-sm leading-relaxed text-gray-600">Draft copy for the emails the backend should send for signups, cancellations, schedule moves, and reminders. Placeholder tokens will be filled by the production Worker.</p>' +
        '<ul class="grid gap-4 md:grid-cols-2">' + rows + '</ul>' +
      '</div>' +
    '</details>';
  }

  function renderCalendarSettingsBlock(store) {
    var settings = normalizeCalendarSettings(store.settings);
    return '<section class="mt-6 rounded-2xl border border-sangha-navy/20 bg-blue-50/80 p-5 shadow-sm">' +
      '<div class="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">' +
        '<div>' +
          '<p class="mb-2 text-[10px] uppercase tracking-widest font-bold text-sangha-navy">Admin Settings</p>' +
          '<h2 class="font-serif text-xl font-bold text-sangha-navy mb-2">Calendar Settings</h2>' +
          '<p class="text-sm text-gray-600 leading-relaxed">Manage shared calendar defaults for future calendar items.</p>' +
        '</div>' +
      '</div>' +
      '<form id="calendar-settings-form" class="mt-5 grid gap-4 rounded-xl border border-blue-100 bg-white p-4">' +
        textareaMarkup("Default Location", "defaultLocation", true, settings.defaultLocation) +
        numberFieldMarkup("Signup Window (months)", "signupWindowMonths", settings.signupWindowMonths, 1, 24, "Members can volunteer, sign up as backup, or mark attendance once a calendar item is inside this window. The default is 1 month.") +
        '<button type="submit" class="rounded-lg bg-sangha-navy px-4 py-3 text-xs uppercase tracking-widest font-bold text-white hover:bg-blue-900">Save Settings</button>' +
        '<p class="text-xs leading-relaxed text-gray-500">Changing the default location updates future items and recurring rules that are checked to use the default. Past items and custom locations are left alone.</p>' +
      '</form>' +
      '<details data-admin-section="zoom-settings" class="mt-5 rounded-xl border border-blue-100 bg-white">' +
        '<summary class="cursor-pointer list-none rounded-xl px-4 py-3 text-xs uppercase tracking-widest font-bold text-sangha-navy hover:bg-sangha-light">Zoom Meeting Settings</summary>' +
        '<form id="zoom-settings-form" class="grid gap-4 border-t border-blue-100 p-4">' +
          '<div>' +
            '<p class="mb-2 text-[10px] uppercase tracking-widest font-bold text-sangha-navy">Zoom</p>' +
            '<h3 class="font-serif text-lg font-bold text-sangha-navy mb-2">Zoom Meeting Settings</h3>' +
            '<p class="text-sm leading-relaxed text-gray-600">For the local static implementation, this stores a manually supplied Zoom link. For deployment, the plan is Server-to-Server OAuth in the Cloudflare Worker so recurring calendar items can automatically create or update Zoom meetings without storing a Zoom username or password.</p>' +
          '</div>' +
          '<div class="grid gap-4 md:grid-cols-2">' +
            fieldMarkup("Zoom User Name", "zoomName", "text", false, settings.zoomName) +
            fieldMarkup("Zoom User Email", "zoomEmail", "email", false, settings.zoomEmail) +
          '</div>' +
          fieldMarkup("Zoom Meeting Link", "zoomLink", "url", false, settings.zoomLink) +
          '<div class="rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs leading-relaxed text-gray-600">' +
            '<p class="font-bold text-sangha-navy">Server-to-Server OAuth plan</p>' +
            '<p class="mt-1">Backend secrets will be <span class="font-bold">ZOOM_ACCOUNT_ID</span>, <span class="font-bold">ZOOM_CLIENT_ID</span>, and <span class="font-bold">ZOOM_CLIENT_SECRET</span>. The Worker will request short-lived access tokens, then call Zoom meeting APIs for events marked to use Zoom.</p>' +
          '</div>' +
          '<button type="submit" class="rounded-lg bg-sangha-navy px-4 py-3 text-xs uppercase tracking-widest font-bold text-white hover:bg-blue-900">Save Zoom Settings</button>' +
        '</form>' +
      '</details>' +
      renderEmailTemplatesBlock() +
      '<div class="mt-5 rounded-xl border border-red-100 bg-white p-4">' +
        '<p class="mb-2 text-[10px] uppercase tracking-widest font-bold text-red-700">Development</p>' +
        '<h3 class="font-serif text-lg font-bold text-sangha-navy mb-2">Local Prototype Data</h3>' +
        '<p class="mb-4 text-sm leading-relaxed text-gray-600">Use this only while testing. It clears browser-local calendar items and history, then restores the weekly Sangha meeting recurrence with the current seeded talks.</p>' +
        '<button type="button" data-reset-calendar-store class="rounded-lg border border-red-200 bg-white px-4 py-3 text-xs uppercase tracking-widest font-bold text-red-700 hover:bg-red-50">Reset Local Calendar Data</button>' +
      '</div>' +
    '</section>';
  }

  function wireCalendarSettingsBlock(root, year, month) {
    var form = root.querySelector("#calendar-settings-form");
    if (form) {
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        var store = loadStore();
        applyCalendarSettingsUpdate(store, {
          defaultLocation: fieldValue(form, "defaultLocation") || DEFAULT_LOCATION,
          signupWindowMonths: fieldValue(form, "signupWindowMonths"),
          zoomName: store.settings.zoomName,
          zoomEmail: store.settings.zoomEmail,
          zoomLink: store.settings.zoomLink
        });
        addCalendarHistory(store, "Updated calendar settings", null, "Updated calendar settings.");
        saveStore(store);
        renderAdmin(root, { year: year, month: month, notice: "Calendar settings updated. Future default-location items now use the current default location." });
      });
    }

    var zoomForm = root.querySelector("#zoom-settings-form");
    if (zoomForm) {
      zoomForm.addEventListener("submit", function (event) {
        event.preventDefault();
        var store = loadStore();
        applyCalendarSettingsUpdate(store, {
          defaultLocation: store.settings.defaultLocation,
          signupWindowMonths: store.settings.signupWindowMonths,
          zoomName: fieldValue(zoomForm, "zoomName"),
          zoomEmail: fieldValue(zoomForm, "zoomEmail"),
          zoomLink: fieldValue(zoomForm, "zoomLink")
        });
        addCalendarHistory(store, "Updated Zoom settings", null, "Updated Zoom meeting settings.");
        saveStore(store);
        renderAdmin(root, { year: year, month: month, notice: "Zoom settings updated." });
      });
    }

    var resetButton = root.querySelector("[data-reset-calendar-store]");
    if (resetButton) {
      resetButton.addEventListener("click", function () {
        var confirmed = window.confirm("Reset local calendar preview data? This clears local items and history, then creates only the weekly Sangha meeting recurrence.");
        if (!confirmed) return;
        var clean = defaultCalendarStore();
        saveStore(clean);
        try {
          if (window.localStorage) window.localStorage.removeItem(DEMO_SEEDED_KEY);
        } catch (error) {}
        renderAdmin(root, { year: year, month: month, notice: "Local calendar data reset. Weekly Tuesday talks were restored with the seeded May 26, June 2, and June 9 entries." });
      });
    }
  }

  function renderItemTypePromptModal(slot, selectedDate) {
    var slotDate = slot && slot.date ? slot.date : selectedDate;
    var talkSelected = !slot || isTalkSlot(slot);
    var meetingSelected = slot && isMeetingSlot(slot);
    return '<div data-calendar-modal class="fixed inset-0 z-50 overflow-y-auto bg-sangha-navy/50 px-4 py-10" style="overscroll-behavior: contain;">' +
      '<section role="dialog" aria-modal="true" aria-label="Choose calendar item type" class="mx-auto max-w-xl rounded-2xl border border-gray-200 bg-white p-6 shadow-xl">' +
        '<p class="text-[10px] uppercase tracking-widest font-bold text-sangha-gold mb-2">' + displayDate(slotDate) + '</p>' +
        '<h2 class="font-serif text-2xl font-bold text-sangha-navy">Calendar Item Type</h2>' +
        '<p class="mt-3 text-sm leading-relaxed text-gray-600">Choose whether this item is a talk signup or a regular meeting attendance item.</p>' +
        '<div class="mt-6 grid gap-3 md:grid-cols-2">' +
          '<button type="button" data-select-item-type="talk" class="rounded-xl border ' + (talkSelected ? 'border-sangha-gold bg-yellow-50' : 'border-gray-200 bg-white') + ' p-4 text-left hover:border-sangha-gold">' +
            '<span class="block text-sm font-bold text-sangha-navy">Talk</span>' +
            '<span class="mt-1 block text-xs text-gray-500">Person bringing the talk plus backup volunteers.</span>' +
          '</button>' +
          '<button type="button" data-select-item-type="meeting" class="rounded-xl border ' + (meetingSelected ? 'border-sangha-gold bg-yellow-50' : 'border-gray-200 bg-white') + ' p-4 text-left hover:border-sangha-gold">' +
            '<span class="block text-sm font-bold text-sangha-navy">Regular Meeting</span>' +
            '<span class="mt-1 block text-xs text-gray-500">One attendance list for people planning to come.</span>' +
          '</button>' +
        '</div>' +
        '<button type="button" data-close-admin-modal class="mt-5 rounded-lg border border-gray-200 px-4 py-3 text-xs uppercase tracking-widest font-bold text-sangha-navy hover:bg-sangha-light">Cancel</button>' +
      '</section>' +
    '</div>';
  }

  function renderCreateBasicsModal(slot, settings) {
    var itemLabel = isMeetingSlot(slot) ? "Regular Meeting" : "Talk";
    settings = normalizeCalendarSettings(settings);
    return '<div data-calendar-modal class="fixed inset-0 z-50 overflow-y-auto bg-sangha-navy/50 px-4 py-10" style="overscroll-behavior: contain;">' +
      '<section role="dialog" aria-modal="true" aria-label="Create calendar item" class="mx-auto max-w-xl rounded-2xl border border-gray-200 bg-white p-6 shadow-xl">' +
        '<div class="flex items-start justify-between gap-4 border-b border-gray-100 pb-4">' +
          '<div>' +
            '<p class="text-[10px] uppercase tracking-widest font-bold text-sangha-gold mb-2">Create ' + escapeHtml(itemLabel) + '</p>' +
            '<h2 class="font-serif text-2xl font-bold text-sangha-navy">Set The Basics</h2>' +
            '<p class="mt-2 text-sm leading-relaxed text-gray-600">Add the core calendar details first. After this is saved, the full editor will open.</p>' +
          '</div>' +
          '<button type="button" data-close-admin-modal class="rounded-full border border-gray-200 px-3 py-2 text-xs font-bold text-sangha-navy hover:bg-sangha-light" aria-label="Discard draft">Close</button>' +
        '</div>' +
        '<form id="calendar-basics-form" data-slot-revision="' + Number(slot.revision || 0) + '" class="mt-5 grid gap-0">' +
          adminDateTimeRowMarkup("Date", "date", slot.date, slot.startTime || DEFAULT_START_TIME, slot.endTime || DEFAULT_END_TIME) +
          fieldMarkup("Title", "title", "text", true, slot.title || (isMeetingSlot(slot) ? "Regular meeting" : DEFAULT_TITLE)) +
          textareaMarkup("Description", "description", false, slot.description || "") +
          adminCollapsedLocationMarkup(slot.location || settings.defaultLocation, slot.useDefaultLocation !== false, settings, slot.usePhysicalLocation !== false) +
          checkboxMarkup("useZoom", "Use Zoom", Boolean(slot.useZoom), "Include the configured Zoom meeting link for this calendar item.") +
          '<button type="submit" class="w-full mt-2 rounded-lg bg-sangha-gold px-4 py-3 text-xs uppercase tracking-widest font-bold text-sangha-navy hover:bg-yellow-600">Create And Continue</button>' +
        '</form>' +
      '</section>' +
    '</div>';
  }

  function wireAdminCopyBlock(root) {
    var button = root.querySelector("[data-copy-upcoming-talks]");
    var textarea = root.querySelector("[data-upcoming-talks-text]");
    var htmlSource = root.querySelector("[data-upcoming-talks-html-source]");
    var htmlBlock = root.querySelector("[data-upcoming-talks-html]");
    var status = root.querySelector("[data-copy-upcoming-talks-status]");
    if (!button || !textarea) return;
    button.addEventListener("click", function () {
      var copied = false;
      if (navigator.clipboard && navigator.clipboard.write && window.ClipboardItem && htmlBlock) {
        navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([htmlBlock.innerHTML], { type: "text/html" }),
            "text/plain": new Blob([htmlSource ? htmlSource.value : htmlBlock.innerHTML], { type: "text/plain" })
          })
        ]).then(function () {
          if (status) status.textContent = "Copied HTML to clipboard.";
        }).catch(function () {
          copyPlainEmailText(htmlSource || textarea, status, "Copied HTML source to clipboard.");
        });
        copied = true;
      }
      if (!copied) copyPlainEmailText(htmlSource || textarea, status, "Copied HTML source to clipboard.");
    });
  }

  function copyPlainEmailText(textarea, status, successText) {
    var copyNode = document.createElement("textarea");
    copyNode.value = textarea.value;
    copyNode.setAttribute("readonly", "readonly");
    copyNode.style.position = "fixed";
    copyNode.style.left = "-9999px";
    copyNode.style.top = "0";
    document.body.appendChild(copyNode);
    copyNode.focus();
    copyNode.select();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(textarea.value).then(function () {
        if (status) status.textContent = successText || "Copied to clipboard.";
      }).catch(function () {
        if (status) status.textContent = "Selected. Use Ctrl+C to copy.";
      }).finally(function () {
        if (copyNode.parentNode) copyNode.parentNode.removeChild(copyNode);
      });
      return;
    }
    if (copyNode.parentNode) copyNode.parentNode.removeChild(copyNode);
    if (status) status.textContent = "Selected. Use Ctrl+C to copy.";
  }

  function renderRecurringMeetingsBlock(store, editRecurrenceId) {
    var editingRule = store.recurrences.find(function (rule) { return rule.id === editRecurrenceId; }) || null;
    var rows = store.recurrences.map(function (rule) {
      return '<li class="rounded-xl border border-gray-200 bg-white p-4">' +
        '<div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">' +
          '<div>' +
            '<p class="text-sm font-bold text-sangha-navy">' + escapeHtml(rule.name) + '</p>' +
            '<p class="mt-1 text-xs text-gray-500">' + escapeHtml(recurrenceSummary(rule)) + '</p>' +
            '<p class="mt-1 text-[10px] uppercase tracking-widest font-bold ' + (rule.active ? 'text-green-700' : 'text-gray-400') + '">' + (rule.active ? 'Active' : 'Paused') + '</p>' +
          '</div>' +
          '<div class="flex gap-2">' +
            '<button type="button" data-edit-recurrence="' + escapeHtml(rule.id) + '" class="rounded-lg border border-gray-200 px-3 py-2 text-[10px] uppercase tracking-widest font-bold text-sangha-navy hover:bg-sangha-light">Edit</button>' +
            '<button type="button" data-toggle-recurrence="' + escapeHtml(rule.id) + '" class="rounded-lg border border-gray-200 px-3 py-2 text-[10px] uppercase tracking-widest font-bold text-sangha-navy hover:bg-sangha-light">' + (rule.active ? 'Pause' : 'Resume') + '</button>' +
            (rule.id === DEFAULT_TUESDAY_RECURRENCE_ID ? '' : '<button type="button" data-delete-recurrence="' + escapeHtml(rule.id) + '" class="rounded-lg border border-red-200 px-3 py-2 text-[10px] uppercase tracking-widest font-bold text-red-700 hover:bg-red-50">Delete</button>') +
          '</div>' +
        '</div>' +
      '</li>';
    }).join("");

    return '<section class="mt-6 rounded-2xl border border-sangha-gold/30 bg-white p-5 shadow-sm">' +
      '<div class="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">' +
        '<div>' +
          '<h2 class="font-serif text-xl font-bold text-sangha-navy mb-2">Recurring Meetings</h2>' +
          '<p class="text-sm text-gray-600 leading-relaxed">Create recurring calendar groups for weekly or monthly talks and regular meetings. Push-forward actions stay inside the selected group.</p>' +
        '</div>' +
      '</div>' +
      '<ul class="mt-4 grid gap-3">' + rows + '</ul>' +
      '<details data-admin-section="recurrence-form" class="mt-5 rounded-xl border border-gray-200 bg-gray-50"' + (editingRule ? ' open' : '') + '>' +
        '<summary class="cursor-pointer list-none rounded-xl px-4 py-3 text-xs uppercase tracking-widest font-bold text-sangha-navy hover:bg-white">' + (editingRule ? 'Edit Recurring Meeting' : 'Create Recurring Meeting') + '</summary>' +
        '<div class="border-t border-gray-200">' +
          renderRecurrenceForm(editingRule, store.settings) +
        '</div>' +
      '</details>' +
    '</section>';
  }

  function renderRecurrenceForm(rule, settings) {
    var isEditing = Boolean(rule);
    var itemType = rule ? rule.itemType : "talk";
    var frequency = rule ? rule.frequency : "weekly";
    var startDate = rule ? rule.startDate : dateKey(new Date());
    var monthlyMode = rule ? rule.monthlyMode : MONTHLY_MODE_WEEKDAY;
    settings = normalizeCalendarSettings(settings);
    return '<form id="recurrence-form" data-edit-recurrence-id="' + escapeHtml(rule && rule.id ? rule.id : "") + '" class="grid gap-4 p-4 md:grid-cols-2">' +
      '<div class="md:col-span-2 flex items-center justify-between gap-3">' +
        '<h3 class="font-serif text-lg font-bold text-sangha-navy">' + (isEditing ? 'Edit Recurring Meeting' : 'Create Recurring Meeting') + '</h3>' +
        (isEditing ? '<button type="button" data-cancel-recurrence-edit class="rounded-lg border border-gray-200 px-3 py-2 text-[10px] uppercase tracking-widest font-bold text-sangha-navy hover:bg-white">Cancel Edit</button>' : '') +
      '</div>' +
      fieldMarkup("Name", "name", "text", true, rule ? rule.name : "") +
      recurrenceSelectMarkup("Item Type", "itemType", [{ value: "talk", label: "Talk" }, { value: "meeting", label: "Regular Meeting" }], itemType) +
      recurrenceSelectMarkup("Repeats", "frequency", [{ value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }], frequency) +
      adminDateTimeRowMarkup("Start Date", "startDate", startDate, rule ? rule.startTime : DEFAULT_START_TIME, rule ? rule.endTime : DEFAULT_END_TIME) +
      renderMonthlyModeOptions(monthlyMode, startDate, frequency) +
      fieldMarkup("Title", "title", "text", true, rule ? rule.title : DEFAULT_TITLE) +
      textareaMarkup("Description", "description", false, rule ? rule.description : DEFAULT_DESCRIPTION) +
      locationControlMarkup(rule ? rule.location : settings.defaultLocation, rule ? rule.useDefaultLocation !== false : true, settings, rule ? rule.usePhysicalLocation !== false : true) +
      checkboxMarkup("useZoom", "Use Zoom", Boolean(rule && rule.useZoom), "Include the configured Zoom meeting link for generated items.") +
      '<div class="md:col-span-2"><button type="submit" class="w-full rounded-lg bg-sangha-navy px-4 py-3 text-xs uppercase tracking-widest font-bold text-white hover:bg-blue-900">' + (isEditing ? 'Save Recurring Meeting' : 'Create Recurring Meeting') + '</button></div>' +
    '</form>';
  }

  function renderMonthlyModeOptions(monthlyMode, startDate, frequency) {
    var hidden = frequency === "monthly" ? "" : " hidden";
    var selected = monthlyMode === MONTHLY_MODE_MONTH_DAY ? MONTHLY_MODE_MONTH_DAY : MONTHLY_MODE_WEEKDAY;
    return '<fieldset data-monthly-mode-options class="md:col-span-2 rounded-xl border border-gray-200 bg-white p-4' + hidden + '">' +
      '<legend class="px-1 text-xs uppercase tracking-widest font-bold text-sangha-navy">Monthly Pattern</legend>' +
      '<div class="mt-3 grid gap-3 md:grid-cols-2">' +
        monthlyModeRadio(MONTHLY_MODE_WEEKDAY, monthlyWeekdayLabel(startDate), selected) +
        monthlyModeRadio(MONTHLY_MODE_MONTH_DAY, monthlyMonthDayLabel(startDate), selected) +
      '</div>' +
    '</fieldset>';
  }

  function monthlyModeRadio(value, label, selected) {
    return '<label class="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">' +
      '<input type="radio" name="monthlyMode" value="' + escapeHtml(value) + '" class="mt-0.5 accent-sangha-gold"' + (value === selected ? ' checked' : '') + ' />' +
      '<span data-monthly-mode-label="' + escapeHtml(value) + '" class="font-bold text-sangha-navy">' + escapeHtml(label) + '</span>' +
    '</label>';
  }

  function wireMonthlyModeOptions(form) {
    var frequency = form.querySelector('[name="frequency"]');
    var startDate = form.querySelector('[name="startDate"]');
    var monthlyOptions = form.querySelector("[data-monthly-mode-options]");
    if (!frequency || !startDate || !monthlyOptions) return;
    var update = function () {
      monthlyOptions.classList.toggle("hidden", frequency.value !== "monthly");
      var weekdayLabel = form.querySelector('[data-monthly-mode-label="' + MONTHLY_MODE_WEEKDAY + '"]');
      var monthDayLabel = form.querySelector('[data-monthly-mode-label="' + MONTHLY_MODE_MONTH_DAY + '"]');
      var value = startDate.value || dateKey(new Date());
      if (weekdayLabel) weekdayLabel.textContent = monthlyWeekdayLabel(value);
      if (monthDayLabel) monthDayLabel.textContent = monthlyMonthDayLabel(value);
    };
    frequency.addEventListener("change", update);
    startDate.addEventListener("input", update);
    update();
  }

  function recurrenceSelectMarkup(label, name, options, selectedValue) {
    return '<label class="block mb-4">' +
      '<span class="block text-xs uppercase tracking-widest font-bold text-sangha-navy mb-2">' + label + '</span>' +
      '<select name="' + name + '" class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sangha-gold">' +
        options.map(function (option) {
          return '<option value="' + escapeHtml(option.value) + '"' + (String(option.value) === String(selectedValue || "") ? ' selected' : '') + '>' + escapeHtml(option.label) + '</option>';
        }).join("") +
      '</select>' +
    '</label>';
  }

  function recurrenceSummary(rule) {
    var itemLabel = rule.itemType === "meeting" ? "Regular meeting" : "Talk";
    var time = displayTime(rule.startTime) + " - " + displayTime(rule.endTime);
    var start = displayShortDate(rule.startDate);
    var startDate = parseDate(rule.startDate);
    if (rule.frequency === "weekly") return itemLabel + " weekly from " + start + " on " + FULL_WEEKDAY_LABELS[startDate.getDay()] + " at " + time + ".";
    return itemLabel + " monthly from " + start + " on " + (rule.monthlyMode === MONTHLY_MODE_MONTH_DAY ? monthlyMonthDayLabel(rule.startDate).toLowerCase() : monthlyWeekdayLabel(rule.startDate).toLowerCase()) + " at " + time + ".";
  }

  function wireRecurringMeetingsBlock(root, year, month) {
    var form = root.querySelector("#recurrence-form");
    if (form) {
      wireMonthlyModeOptions(form);
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        var store = ensureRecurringSlots(loadStore(), year, month);
        var editId = form.getAttribute("data-edit-recurrence-id") || "";
        var recurrence = normalizeRecurrence({
          id: editId || undefined,
          name: fieldValue(form, "name"),
          itemType: fieldValue(form, "itemType"),
          frequency: fieldValue(form, "frequency"),
          monthlyMode: fieldValue(form, "monthlyMode") || MONTHLY_MODE_WEEKDAY,
          startDate: fieldValue(form, "startDate"),
          startTime: fieldValue(form, "startTime") || DEFAULT_START_TIME,
          endTime: fieldValue(form, "endTime") || DEFAULT_END_TIME,
          title: fieldValue(form, "title") || DEFAULT_TITLE,
          description: fieldValue(form, "description"),
          usePhysicalLocation: checkboxValue(form, "usePhysicalLocation"),
          useDefaultLocation: checkboxValue(form, "useDefaultLocation"),
          location: locationValueFromForm(form, store.settings),
          useZoom: checkboxValue(form, "useZoom")
        });
        if (editId) {
          var index = store.recurrences.findIndex(function (item) { return item.id === editId; });
          if (index !== -1) {
            recurrence.active = store.recurrences[index].active;
            recurrence.skippedDates = store.recurrences[index].skippedDates;
            recurrence.createdAt = store.recurrences[index].createdAt;
            recurrence.updatedAt = new Date().toISOString();
            var previousRecurrence = store.recurrences[index];
            store.recurrences[index] = recurrence;
            applyRecurrenceEditToGeneratedSlots(store, previousRecurrence, recurrence);
          }
          addCalendarHistory(store, "Updated recurring meeting", null, "Updated recurring meeting: " + recurrence.name + ".");
        } else {
          store.recurrences.push(recurrence);
          addCalendarHistory(store, "Created recurring meeting", null, "Created recurring meeting: " + recurrence.name + ".");
        }
        saveStore(store);
        renderAdmin(root, { year: year, month: month, notice: editId ? "Recurring meeting updated." : "Recurring meeting created." });
      });
    }

    root.querySelectorAll("[data-edit-recurrence]").forEach(function (button) {
      button.addEventListener("click", function () {
        renderAdmin(root, { year: year, month: month, editRecurrenceId: button.getAttribute("data-edit-recurrence") });
      });
    });

    var cancelEditButton = root.querySelector("[data-cancel-recurrence-edit]");
    if (cancelEditButton) {
      cancelEditButton.addEventListener("click", function () {
        renderAdmin(root, { year: year, month: month });
      });
    }

    root.querySelectorAll("[data-toggle-recurrence]").forEach(function (button) {
      button.addEventListener("click", function () {
        var store = loadStore();
        var rule = store.recurrences.find(function (item) { return item.id === button.getAttribute("data-toggle-recurrence"); });
        if (!rule) return;
        rule.active = !rule.active;
        rule.updatedAt = new Date().toISOString();
        addCalendarHistory(store, rule.active ? "Resumed recurring meeting" : "Paused recurring meeting", null, (rule.active ? "Resumed" : "Paused") + " recurring meeting: " + rule.name + ".");
        saveStore(store);
        renderAdmin(root, { year: year, month: month });
      });
    });

    root.querySelectorAll("[data-delete-recurrence]").forEach(function (button) {
      button.addEventListener("click", function () {
        var id = button.getAttribute("data-delete-recurrence");
        var store = loadStore();
        var rule = store.recurrences.find(function (item) { return item.id === id; });
        if (!rule) return;
        store.recurrences = store.recurrences.filter(function (item) { return item.id !== id; });
        store.slots = store.slots.filter(function (slot) {
          return slot.recurrenceId !== id || !isFutureEmptyGeneratedSlot(slot);
        });
        detachSlotsFromRecurrence(store, id);
        addCalendarHistory(store, "Deleted recurring meeting", null, "Deleted recurring meeting: " + rule.name + ".");
        saveStore(store);
        renderAdmin(root, { year: year, month: month, notice: "Recurring meeting deleted. Any non-empty existing items were kept as one-time calendar items." });
      });
    });
  }

  function isEmptyGeneratedSlot(slot) {
    return slot.generatedFromRecurrence && !slot.canceled && !slot.occurrenceOverrides.length && !slot.speaker && !slot.backups.length && !slot.attendees.length && !slot.notifications.length && !slot.reminders.length;
  }

  function isFutureEmptyGeneratedSlot(slot) {
    return isEmptyGeneratedSlot(slot) && !isPastSlot(slot);
  }

  function updateEmptyGeneratedSlotsForRecurrence(store, recurrence) {
    store.slots = store.slots.filter(function (slot) {
      return slot.recurrenceId !== recurrence.id || !isFutureEmptyGeneratedSlot(slot);
    });
  }

  function applyRecurrenceEditToGeneratedSlots(store, previousRecurrence, recurrence) {
    updateEmptyGeneratedSlotsForRecurrence(store, recurrence);
    store.slots.forEach(function (slot) {
      if (slot.recurrenceId !== recurrence.id || !slot.generatedFromRecurrence || isPastSlot(slot)) return;
      var occurrenceIndex = recurrenceOccurrenceIndex(previousRecurrence, slot.date);
      var nextDate = occurrenceIndex == null ? "" : recurrenceDateForIndex(recurrence, occurrenceIndex);
      if (nextDate) slot.date = nextDate;
      applyRecurrenceDefaultsToSlot(slot, recurrence);
    });
    store.slots.sort(byDateTime);
    removeDuplicateEmptyGeneratedSlots(store);
  }

  function recurrenceOccurrenceIndex(rule, dateValue) {
    if (!rule || !dateValue) return null;
    var startDate = parseDate(rule.startDate);
    var date = parseDate(dateValue);
    if (dateKey(date) < rule.startDate) return null;
    if (rule.frequency === "weekly") {
      var diffDays = Math.round((date.getTime() - startDate.getTime()) / 86400000);
      var step = 7 * Math.max(1, Number(rule.interval || 1));
      return diffDays >= 0 && diffDays % step === 0 ? diffDays / step : null;
    }
    if (rule.frequency === "monthly") {
      var monthDiff = (date.getFullYear() - startDate.getFullYear()) * 12 + (date.getMonth() - startDate.getMonth());
      var interval = Math.max(1, Number(rule.interval || 1));
      if (monthDiff < 0 || monthDiff % interval !== 0) return null;
      return recurrenceMatchesDate(rule, date) ? monthDiff / interval : null;
    }
    return null;
  }

  function recurrenceDateForIndex(rule, occurrenceIndex) {
    if (!rule || occurrenceIndex == null || occurrenceIndex < 0) return "";
    var startDate = parseDate(rule.startDate);
    var interval = Math.max(1, Number(rule.interval || 1));
    if (rule.frequency === "weekly") {
      return dateKey(addDays(startDate, occurrenceIndex * 7 * interval));
    }
    var targetMonth = startDate.getMonth() + occurrenceIndex * interval;
    if (rule.monthlyMode === MONTHLY_MODE_MONTH_DAY) {
      return dateKey(new Date(startDate.getFullYear(), targetMonth, Math.min(startDate.getDate(), lastDayOfMonth(startDate.getFullYear(), targetMonth))));
    }
    return monthlyWeekdayDateForIndex(startDate, targetMonth);
  }

  function monthlyWeekdayDateForIndex(startDate, targetMonth) {
    var firstOfMonth = new Date(startDate.getFullYear(), targetMonth, 1);
    var desiredWeekday = startDate.getDay();
    var nth = nthWeekdayOfMonth(startDate);
    var firstMatchingDay = 1 + ((desiredWeekday - firstOfMonth.getDay() + 7) % 7);
    var targetDay = firstMatchingDay + (nth - 1) * 7;
    var lastDay = lastDayOfMonth(firstOfMonth.getFullYear(), firstOfMonth.getMonth());
    if (targetDay > lastDay) return "";
    return dateKey(new Date(firstOfMonth.getFullYear(), firstOfMonth.getMonth(), targetDay));
  }

  function applyRecurrenceDefaultsToSlot(slot, recurrence) {
    var overrides = {};
    uniqueStrings(slot.occurrenceOverrides).forEach(function (field) { overrides[field] = true; });
    slot.itemType = recurrence.itemType;
    if (!overrides.startTime) slot.startTime = recurrence.startTime;
    if (!overrides.endTime) slot.endTime = recurrence.endTime;
    if (!overrides.title) slot.title = recurrence.title;
    if (!overrides.description) slot.description = recurrence.description;
    if (!overrides.usePhysicalLocation) slot.usePhysicalLocation = recurrence.usePhysicalLocation !== false;
    if (!overrides.useDefaultLocation) slot.useDefaultLocation = recurrence.useDefaultLocation !== false;
    if (!overrides.location) slot.location = recurrence.location;
    if (!overrides.useZoom) slot.useZoom = Boolean(recurrence.useZoom);
  }

  function removeDuplicateEmptyGeneratedSlots(store) {
    var seen = {};
    store.slots = store.slots.filter(function (slot) {
      if (!slot.recurrenceId) return true;
      var key = slot.recurrenceId + ":" + slot.date;
      if (!seen[key]) {
        seen[key] = slot;
        return true;
      }
      return !isEmptyGeneratedSlot(slot);
    });
  }

  function detachSlotsFromRecurrence(store, recurrenceId) {
    store.slots.forEach(function (slot) {
      if (slot.recurrenceId !== recurrenceId) return;
      slot.recurrenceId = "";
      slot.generatedFromRecurrence = false;
      slot.occurrenceOverrides = [];
    });
  }

  function renderAdminAssignmentForm(id, title, buttonLabel, revision) {
    return '<form id="' + id + '" data-slot-revision="' + Number(revision || 0) + '" class="mt-3 rounded-xl border border-gray-200 bg-white p-3">' +
      '<p class="mb-3 text-xs uppercase tracking-widest font-bold text-sangha-navy">' + escapeHtml(title) + '</p>' +
      fieldMarkup("Name", "name", "text", true, "") +
      fieldMarkup("Email", "email", "email", false, "") +
      '<button type="submit" class="w-full rounded-lg border border-sangha-gold bg-yellow-50 px-3 py-2 text-[10px] uppercase tracking-widest font-bold text-sangha-navy hover:bg-yellow-100">' + escapeHtml(buttonLabel) + '</button>' +
    '</form>';
  }

  function renderAdminPeopleDetails(sectionName, title, countText, rows, emptyText, assignmentForm) {
    return '<details data-admin-section="' + escapeHtml(sectionName) + '" class="rounded-xl border border-gray-200 bg-gray-50">' +
      '<summary class="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 text-xs uppercase tracking-widest font-bold text-sangha-navy hover:bg-sangha-light">' +
        '<span>' + escapeHtml(title) + '</span>' +
        '<span class="rounded-full bg-white px-3 py-1 text-[10px] text-gray-500">' + escapeHtml(countText) + '</span>' +
      '</summary>' +
      '<div class="border-t border-gray-200 p-3">' +
        (rows ? '<ul class="grid gap-2">' + rows + '</ul>' : '<p class="rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-500">' + escapeHtml(emptyText) + '</p>') +
        assignmentForm +
      '</div>' +
    '</details>';
  }

  function renderAdminTalkPeopleBlock(slot, speakerRow, backupRows, attendeeRows) {
    return '<div class="grid gap-3 rounded-2xl border border-sangha-gold/30 bg-yellow-50/40 p-4">' +
      '<div>' +
        '<p class="text-xs uppercase tracking-widest font-bold text-gray-400 mb-2">Who Is Bringing The Talk</p>' +
        speakerRow +
        renderAdminAssignmentForm("admin-speaker-form", slot.speaker ? "Replace Person Bringing The Talk" : "Assign Person Bringing The Talk", slot.speaker ? "Replace Speaker" : "Assign Speaker", slot.revision) +
      '</div>' +
      renderAdminPeopleDetails("backups", "Backup Volunteers", String((slot.backups || []).length) + " backup" + ((slot.backups || []).length === 1 ? "" : "s"), backupRows, "No backups yet.", renderAdminAssignmentForm("admin-backup-form", "Add Backup Volunteer", "Add Backup", slot.revision)) +
      renderAdminPeopleDetails("attending", "Attending", attendanceCountLabel(slot), attendeeRows, "No additional attendees yet.", renderAdminAssignmentForm("admin-attendee-form", "Add Attendee", "Add Attendee", slot.revision)) +
    '</div>';
  }

  function renderAdminMeetingPeopleBlock(slot, attendeeRows) {
    return '<div class="grid gap-3 rounded-2xl border border-sangha-gold/30 bg-yellow-50/40 p-4">' +
      renderAdminPeopleDetails("attending", "Attending", attendanceCountLabel(slot), attendeeRows, "No attendees yet.", renderAdminAssignmentForm("admin-attendee-form", "Add Attendee", "Add Attendee", slot.revision)) +
    '</div>';
  }

  function renderAdminPersonEmail(person) {
    return person && person.email ? '<p class="text-xs text-gray-500">' + escapeHtml(person.email) + '</p>' : '';
  }

  function renderAdminPanel(slot, isDraft, settings) {
    settings = normalizeCalendarSettings(settings);
    if (isMeetingSlot(slot)) return renderMeetingAdminPanel(slot, isDraft, settings);
    var signupUrl = appUrl("calendar-item/", { slot: slot.id });
    var exportUrl = icsDataUrl(slot, settings);
    var past = isPastSlot(slot);
    var closed = past || slot.canceled;
    var speakerRow = slot.speaker
      ? '<div class="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-sangha-light p-3">' +
          '<div><p class="text-sm font-bold text-sangha-navy">' + escapeHtml(publicName(slot.speaker.name)) + '</p>' + renderAdminPersonEmail(slot.speaker) + '</div>' +
          '<button type="button" data-clear-speaker class="shrink-0 rounded-lg border border-red-200 px-3 py-2 text-[10px] uppercase tracking-widest font-bold text-red-700 hover:bg-red-50">Cancel</button>' +
        '</div>'
      : '<p class="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-500">No one is currently bringing the talk.</p>';
    var backupRows = slot.backups.map(function (backup, index) {
      return '<li class="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-3">' +
        '<div><p class="text-sm font-bold text-sangha-navy">' + escapeHtml(publicName(backup.name)) + '</p>' + renderAdminPersonEmail(backup) + '</div>' +
        '<button type="button" data-clear-backup="' + index + '" class="shrink-0 rounded-lg border border-red-200 px-3 py-2 text-[10px] uppercase tracking-widest font-bold text-red-700 hover:bg-red-50">Cancel</button>' +
      '</li>';
    }).join("");
    var attendeeRows = (slot.attendees || []).map(function (attendee, index) {
      return '<li class="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-3">' +
        '<div><p class="text-sm font-bold text-sangha-navy">' + escapeHtml(publicName(attendee.name)) + '</p>' + renderAdminPersonEmail(attendee) + '</div>' +
        '<button type="button" data-clear-attendee="' + index + '" class="shrink-0 rounded-lg border border-red-200 px-3 py-2 text-[10px] uppercase tracking-widest font-bold text-red-700 hover:bg-red-50">Cancel</button>' +
      '</li>';
    }).join("");
    return '<div data-calendar-modal class="fixed inset-0 z-50 overflow-y-auto bg-sangha-navy/50 px-4 py-6 md:py-10" style="overscroll-behavior: contain;">' +
      '<section role="dialog" aria-modal="true" aria-label="Edit talk" class="mx-auto max-w-3xl rounded-2xl bg-white shadow-xl border border-gray-200">' +
        '<div class="flex items-start justify-between gap-4 border-b border-gray-100 p-5">' +
          '<div>' +
            '<p class="text-[10px] uppercase tracking-widest font-bold text-sangha-gold mb-2">' + displayDate(slot.date) + '</p>' +
            '<h2 class="font-serif text-xl font-bold text-sangha-navy">Talk</h2>' +
            (slot.canceled ? '<p class="mt-2 inline-flex rounded-full bg-red-50 px-3 py-1 text-[10px] uppercase tracking-widest font-bold text-red-700">Canceled</p>' : '') +
          '</div>' +
          '<button type="button" data-close-admin-modal class="rounded-full border border-gray-200 px-3 py-2 text-xs font-bold text-sangha-navy hover:bg-sangha-light" aria-label="Close talk editor">Close</button>' +
        '</div>' +
        '<div class="grid gap-5 p-5">' +
          '<form id="talk-slot-form" data-slot-revision="' + Number(slot.revision || 0) + '" class="grid gap-0">' +
            adminDateTimeRowMarkup("Date", "date", slot.date, slot.startTime || DEFAULT_START_TIME, slot.endTime || DEFAULT_END_TIME) +
            fieldMarkup("Title", "title", "text", true, slot.title || DEFAULT_TITLE) +
            textareaMarkup("Description", "description", false, slot.description || "") +
            adminCollapsedLocationMarkup(slot.location || settings.defaultLocation, slot.useDefaultLocation !== false, settings, slot.usePhysicalLocation !== false) +
            checkboxMarkup("useZoom", "Use Zoom", Boolean(slot.useZoom), "Include the configured Zoom meeting link for this talk.") +
          '</form>' +
          renderAdminTalkPeopleBlock(slot, speakerRow, backupRows, attendeeRows) +
          '<div class="rounded-2xl border border-gray-200 bg-white p-4">' +
            '<p class="text-xs uppercase tracking-widest font-bold text-gray-400 mb-2">Signup Link</p>' +
            '<a href="' + signupUrl + '" class="block text-sm ' + (past || slot.canceled ? 'text-gray-500' : 'text-sangha-gold hover:text-yellow-600') + ' break-all">' + signupUrl + '</a>' +
            '<a href="' + exportUrl + '" download="talk-' + escapeHtml(slot.date) + '.ics" class="mt-3 inline-flex rounded-lg border border-gray-200 px-3 py-2 text-[10px] uppercase tracking-widest font-bold text-sangha-navy hover:bg-sangha-light">Add To Calendar</a>' +
            (slot.updatedAt ? '<p class="mt-2 text-xs text-gray-400">Last updated ' + escapeHtml(formatSignedUpAt(slot.updatedAt)) + '.</p>' : '') +
            (past ? '<p class="text-xs text-gray-500 mt-2">This meeting has already passed; the link is read-only for public visitors.</p>' : '') +
          '</div>' +
          renderAdminNotificationSummary(slot) +
        '</div>' +
        '<div class="grid gap-3 border-t border-gray-100 p-5">' +
          (isDraft ? '' : '<div class="grid gap-3' + (slot.recurrenceId && !slot.canceled ? ' md:grid-cols-2' : '') + '">' +
            (slot.canceled ? '<div class="grid gap-3"><div class="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-xs uppercase tracking-widest font-bold text-red-700">This Meeting Is Canceled</div><button type="button" data-remove-canceled-meeting class="rounded-lg border border-red-200 px-4 py-3 text-xs uppercase tracking-widest font-bold text-red-700 hover:bg-red-50">Remove From Calendar</button></div>' : '<button type="button" data-cancel-meeting class="rounded-lg border border-red-200 px-4 py-3 text-xs uppercase tracking-widest font-bold text-red-700 hover:bg-red-50">Cancel This Meeting</button>') +
            (slot.recurrenceId && !slot.canceled ? '<button type="button" data-push-week class="rounded-lg border border-sangha-gold/40 bg-yellow-50 px-4 py-3 text-xs uppercase tracking-widest font-bold text-sangha-navy hover:bg-yellow-100">Cancel And Push Forward One Week</button>' : '') +
          '</div>') +
          '<button type="submit" form="talk-slot-form" class="w-full rounded-lg bg-sangha-gold px-4 py-3 text-xs uppercase tracking-widest font-bold text-sangha-navy hover:bg-yellow-600">Save And Close</button>' +
        '</div>' +
      '</section>' +
    '</div>';
  }

  function renderMeetingAdminPanel(slot, isDraft, settings) {
    settings = normalizeCalendarSettings(settings);
    var signupUrl = appUrl("calendar-item/", { slot: slot.id });
    var exportUrl = icsDataUrl(slot, settings);
    var attendeeRows = (slot.attendees || []).map(function (attendee, index) {
      return '<li class="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-3">' +
        '<div><p class="text-sm font-bold text-sangha-navy">' + escapeHtml(publicName(attendee.name)) + '</p>' + renderAdminPersonEmail(attendee) + '</div>' +
        '<button type="button" data-clear-attendee="' + index + '" class="shrink-0 rounded-lg border border-red-200 px-3 py-2 text-[10px] uppercase tracking-widest font-bold text-red-700 hover:bg-red-50">Cancel</button>' +
      '</li>';
    }).join("");
    return '<div data-calendar-modal class="fixed inset-0 z-50 overflow-y-auto bg-sangha-navy/50 px-4 py-6 md:py-10" style="overscroll-behavior: contain;">' +
      '<section role="dialog" aria-modal="true" aria-label="Edit regular meeting" class="mx-auto max-w-3xl rounded-2xl bg-white shadow-xl border border-gray-200">' +
        '<div class="flex items-start justify-between gap-4 border-b border-gray-100 p-5">' +
          '<div>' +
            '<p class="text-[10px] uppercase tracking-widest font-bold text-sangha-gold mb-2">' + displayDate(slot.date) + '</p>' +
            '<h2 class="font-serif text-xl font-bold text-sangha-navy">Regular Meeting</h2>' +
            (slot.canceled ? '<p class="mt-2 inline-flex rounded-full bg-red-50 px-3 py-1 text-[10px] uppercase tracking-widest font-bold text-red-700">Canceled</p>' : '') +
          '</div>' +
          '<button type="button" data-close-admin-modal class="rounded-full border border-gray-200 px-3 py-2 text-xs font-bold text-sangha-navy hover:bg-sangha-light" aria-label="Close meeting editor">Close</button>' +
        '</div>' +
        '<div class="grid gap-5 p-5">' +
          '<form id="talk-slot-form" data-slot-revision="' + Number(slot.revision || 0) + '" class="grid gap-0">' +
            adminDateTimeRowMarkup("Date", "date", slot.date, slot.startTime || DEFAULT_START_TIME, slot.endTime || DEFAULT_END_TIME) +
            fieldMarkup("Title", "title", "text", true, slot.title || "Regular meeting") +
            textareaMarkup("Description", "description", false, slot.description || "") +
            adminCollapsedLocationMarkup(slot.location || settings.defaultLocation, slot.useDefaultLocation !== false, settings, slot.usePhysicalLocation !== false) +
            checkboxMarkup("useZoom", "Use Zoom", Boolean(slot.useZoom), "Include the configured Zoom meeting link for this meeting.") +
          '</form>' +
          renderAdminMeetingPeopleBlock(slot, attendeeRows) +
          '<div class="rounded-2xl border border-gray-200 bg-white p-4">' +
            '<p class="text-xs uppercase tracking-widest font-bold text-gray-400 mb-2">Attendance Link</p>' +
            '<a href="' + signupUrl + '" class="block text-sm ' + (isPastSlot(slot) || slot.canceled ? 'text-gray-500' : 'text-sangha-gold hover:text-yellow-600') + ' break-all">' + signupUrl + '</a>' +
            '<a href="' + exportUrl + '" download="meeting-' + escapeHtml(slot.date) + '.ics" class="mt-3 inline-flex rounded-lg border border-gray-200 px-3 py-2 text-[10px] uppercase tracking-widest font-bold text-sangha-navy hover:bg-sangha-light">Add To Calendar</a>' +
          '</div>' +
          renderAdminNotificationSummary(slot) +
        '</div>' +
        '<div class="grid gap-3 border-t border-gray-100 p-5">' +
          (isDraft ? '' : '<div class="grid gap-3' + (slot.recurrenceId && !slot.canceled ? ' md:grid-cols-2' : '') + '">' +
            (slot.canceled ? '<div class="grid gap-3"><div class="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-xs uppercase tracking-widest font-bold text-red-700">This Meeting Is Canceled</div><button type="button" data-remove-canceled-meeting class="rounded-lg border border-red-200 px-4 py-3 text-xs uppercase tracking-widest font-bold text-red-700 hover:bg-red-50">Remove From Calendar</button></div>' : '<button type="button" data-cancel-meeting class="rounded-lg border border-red-200 px-4 py-3 text-xs uppercase tracking-widest font-bold text-red-700 hover:bg-red-50">Cancel This Meeting</button>') +
            (slot.recurrenceId && !slot.canceled ? '<button type="button" data-push-week class="rounded-lg border border-sangha-gold/40 bg-yellow-50 px-4 py-3 text-xs uppercase tracking-widest font-bold text-sangha-navy hover:bg-yellow-100">Cancel And Push Forward One Week</button>' : '') +
          '</div>') +
          '<button type="submit" form="talk-slot-form" class="w-full rounded-lg bg-sangha-gold px-4 py-3 text-xs uppercase tracking-widest font-bold text-sangha-navy hover:bg-yellow-600">Save And Close</button>' +
        '</div>' +
      '</section>' +
    '</div>';
  }

  function renderAdminNotificationSummary(slot) {
    if ((!slot.notifications || !slot.notifications.length) && (!slot.reminders || !slot.reminders.length)) return "";
    var lastNotice = slot.notifications[slot.notifications.length - 1];
    var reminderText = slot.reminders && slot.reminders.length
      ? '<p class="text-xs text-gray-500 mt-2">' + slot.reminders.length + ' reminder preview' + (slot.reminders.length === 1 ? '' : 's') + ' scheduled.</p>'
      : '';
    return '<div class="rounded-xl border border-blue-100 bg-blue-50 p-4">' +
      '<p class="text-xs uppercase tracking-widest font-bold text-sangha-navy mb-1">Email Notices</p>' +
      (slot.notifications && slot.notifications.length ? '<p class="text-sm text-gray-600">' + slot.notifications.length + ' queued notice' + (slot.notifications.length === 1 ? '' : 's') + '.</p><p class="text-xs text-gray-500 mt-2">' + escapeHtml(lastNotice.subject) + '</p>' : '<p class="text-sm text-gray-600">No immediate notices queued.</p>') +
      reminderText +
    '</div>';
  }

  function renderCalendarHistory(store) {
    var entries = recentCalendarHistory(store.history).filter(function (entry) {
      return !isCalendarHistoryNoise(entry);
    });
    var rows = entries.map(function (entry) {
      return '<li class="border-b border-gray-100 py-3 last:border-b-0">' +
        '<div class="flex flex-wrap items-center justify-between gap-2">' +
          '<span class="text-sm font-bold text-sangha-navy">' + escapeHtml(calendarHistoryEntryHeadline(entry)) + '</span>' +
          '<span class="text-xs text-gray-400">' + escapeHtml(formatSignedUpAt(entry.at)) + '</span>' +
        '</div>' +
        '<p class="mt-1 text-xs text-gray-500">' + escapeHtml(calendarHistoryEntryDetail(entry, store)) + '</p>' +
      '</li>';
    }).join("");
    return '<details data-admin-section="calendar-history" class="mt-6 rounded-2xl border border-gray-200 bg-white shadow-sm">' +
      '<summary class="cursor-pointer list-none rounded-2xl p-5 hover:bg-sangha-light">' +
        '<h2 class="font-serif text-xl font-bold text-sangha-navy mb-2">Calendar History (30 Days)</h2>' +
        '<p class="text-sm text-gray-600 leading-relaxed">Recent signup, cancellation, assignment, and calendar-change activity from the last 30 days.</p>' +
      '</summary>' +
      '<ul class="border-t border-gray-100 px-5 pb-5">' + (rows || '<li class="pt-4 text-sm text-gray-500">No calendar history from the last 30 days.</li>') + '</ul>' +
    '</details>';
  }

  function isCalendarHistoryNoise(entry) {
    if (!entry) return true;
    if (entry.action === "Selected calendar item type") return true;
    if (entry.summary && entry.summary.indexOf("Started creating ") === 0) return true;
    return false;
  }

  function calendarHistoryEntryHeadline(entry) {
    var summary = entry && entry.summary ? entry.summary : entry.action || "Updated calendar.";
    var assignedSpeakerMatch = summary.match(/^(.+?) was assigned as the person bringing the talk for /);
    if (assignedSpeakerMatch) return assignedSpeakerMatch[1] + " was assigned to bring this talk.";
    var assignedBackupMatch = summary.match(/^(.+?) was assigned as a backup volunteer for /);
    if (assignedBackupMatch) return assignedBackupMatch[1] + " was added as a backup for this talk.";
    var assignedAttendeeMatch = summary.match(/^(.+?) was assigned as an attendee for /);
    if (assignedAttendeeMatch) return assignedAttendeeMatch[1] + " was added as attending this calendar item.";
    return summary;
  }

  function calendarHistoryEntryDetail(entry, store) {
    var parts = [];
    if (entry.slotDate) parts.push(displayDate(entry.slotDate));
    var slot = entry.slotId ? findSlotById(store, entry.slotId) : null;
    if (slot && slot.title) parts.push(slot.title);
    if (entry.action) parts.push(entry.action);
    return parts.join(" · ");
  }

  function adminActionPreview(action, store) {
    var slot = findSlotById(store, action.slotId);
    if (!slot) return { title: "Confirm Action", body: "This slot could not be found.", recipients: [] };
    var recipients = [];
    var title = "Confirm Action";
    var body = "";
    if (action.type === "clear-speaker") {
      title = "Cancel Speaker";
      body = (slot.speaker ? publicName(slot.speaker.name) : "The speaker") + " will be removed from " + displayDate(slot.date) + ". Backup volunteers can receive an email notice asking them to return to the calendar item link if they can bring the talk.";
      recipients = signedUpPeople(slot);
    }
    if (action.type === "clear-backup") {
      var backup = slot.backups[action.backupIndex];
      title = "Cancel Backup";
      body = (backup ? publicName(backup.name) : "This backup") + " will be removed from " + displayDate(slot.date) + ". Signed-up people can receive an email notice.";
      recipients = signedUpPeople(slot);
    }
    if (action.type === "clear-attendee") {
      var attendee = slot.attendees[action.attendeeIndex];
      title = "Cancel Attendee";
      body = (attendee ? publicName(attendee.name) : "This attendee") + " will be removed from " + displayDate(slot.date) + ". Signed-up people can receive an email notice.";
      recipients = signedUpPeople(slot);
    }
    if (action.type === "cancel-meeting") {
      title = "Cancel Meeting";
      body = "Choose whether to leave this item visible as canceled or remove it from the calendar. Signed-up people can receive an email notice.";
      recipients = signedUpPeople(slot);
    }
    if (action.type === "remove-meeting") {
      title = "Remove From Calendar";
      body = "This canceled item will be removed from the calendar. Signed-up people can receive an email notice.";
      recipients = signedUpPeople(slot);
    }
    if (action.type === "push-week") {
      if (!slot.recurrenceId) {
        title = "Series Required";
        body = "Only items that belong to a recurring meeting can be canceled and pushed forward. Use Cancel This Meeting for one-time calendar items.";
        return { title: title, body: body, recipients: recipients };
      }
      var affected = store.slots.filter(function (item) { return shouldShiftSlot(item, slot.date, slot.recurrenceId, slot.id); }).sort(byDateTime);
      title = "Cancel And Push Forward";
      body = affected.length + " calendar item" + (affected.length === 1 ? "" : "s") + " in this recurring group will move forward by one week. Original dates will show a moved marker.";
      var seen = {};
      affected.forEach(function (item) {
        signedUpPeople(item).forEach(function (person) {
          var key = person.email.toLowerCase();
          if (!seen[key]) {
            seen[key] = true;
            recipients.push(person);
          }
        });
      });
    }
    return { title: title, body: body, recipients: recipients };
  }

  function renderAdminConfirmModal(action, store) {
    var preview = adminActionPreview(action, store);
    var recipientRows = preview.recipients.map(function (person) {
      return '<li class="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs"><span class="font-bold text-sangha-navy">' + escapeHtml(publicName(person.name)) + '</span><br><span class="text-gray-500">' + escapeHtml(person.email) + '</span></li>';
    }).join("");
    var emailOption = preview.recipients.length
      ? '<label class="mt-4 flex items-start gap-3 rounded-xl border border-blue-100 bg-white p-3 text-sm text-gray-600"><input type="checkbox" data-send-email-notice class="mt-0.5 accent-sangha-gold" checked /><span><span class="font-bold text-sangha-navy">Send email notice</span><span class="mt-1 block text-xs text-gray-500">Signed-up people listed here will receive an email notice when email sending is connected.</span></span></label>'
      : '';
    var cancelModeOptions = action.type === "cancel-meeting"
      ? '<div class="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-4">' +
          '<p class="mb-3 text-xs uppercase tracking-widest font-bold text-sangha-navy">Calendar Display</p>' +
          '<label class="mb-3 flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-600">' +
            '<input type="radio" name="cancelMode" value="mark" class="mt-0.5 accent-sangha-gold" checked />' +
            '<span><span class="font-bold text-sangha-navy">Mark as canceled</span><span class="mt-1 block text-xs text-gray-500">Keep the item visible on the calendar with signups closed.</span></span>' +
          '</label>' +
          '<label class="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-600">' +
            '<input type="radio" name="cancelMode" value="remove" class="mt-0.5 accent-sangha-gold" />' +
            '<span><span class="font-bold text-sangha-navy">Remove from calendar</span><span class="mt-1 block text-xs text-gray-500">Delete this item from the calendar. Recurring items will skip this date.</span></span>' +
          '</label>' +
        '</div>'
      : '';
    return '<div data-calendar-modal class="fixed inset-0 overflow-y-auto bg-sangha-navy/50 px-4 py-10" style="overscroll-behavior: contain; z-index: 60;">' +
      '<section role="dialog" aria-modal="true" aria-label="' + escapeHtml(preview.title) + '" class="mx-auto max-w-xl rounded-2xl border border-gray-200 bg-white p-6 shadow-xl">' +
        '<h2 class="font-serif text-2xl font-bold text-sangha-navy">' + escapeHtml(preview.title) + '</h2>' +
        '<p class="mt-3 text-sm leading-relaxed text-gray-600">' + escapeHtml(preview.body) + '</p>' +
        cancelModeOptions +
        '<div class="mt-5 rounded-xl border border-blue-100 bg-blue-50 p-4">' +
          '<p class="text-xs uppercase tracking-widest font-bold text-sangha-navy mb-3">Email Notice Recipients</p>' +
          '<ul class="grid gap-2">' + (recipientRows || '<li class="text-sm text-gray-500">No one is signed up or attending, so no email notice is needed.</li>') + '</ul>' +
          emailOption +
        '</div>' +
        '<div class="mt-6 grid gap-3 md:grid-cols-2">' +
          '<button type="button" data-cancel-admin-action class="rounded-lg border border-gray-200 px-4 py-3 text-xs uppercase tracking-widest font-bold text-sangha-navy hover:bg-sangha-light">Keep Editing</button>' +
          '<button type="button" data-confirm-admin-action class="rounded-lg bg-sangha-navy px-4 py-3 text-xs uppercase tracking-widest font-bold text-white hover:bg-blue-900">Confirm</button>' +
        '</div>' +
      '</section>' +
    '</div>';
  }

  function performConfirmedAdminAction(root, action, year, month, selectedDate, options) {
    options = options || {};
    var sendEmail = options.sendEmail !== false;
    var fresh = freshSlotForAction(action.slotId, action.expectedRevision, year, month);
    if (fresh.conflict) {
      renderAdmin(root, { year: year, month: month, selectedDate: fresh.slot ? fresh.slot.date : selectedDate, selectedSlotId: fresh.slot ? fresh.slot.id : "", notice: fresh.conflict });
      return;
    }
    var slot = fresh.slot;
    var nextSelectedDate = slot.date;
    var notice = "";
    if (action.type === "clear-speaker") {
      var speaker = slot.speaker;
      if (sendEmail) {
        queueBackupCancellationEmails(slot);
        queuePersonCancellationNotifications(slot, speaker, "speaker");
      }
      slot.speaker = null;
      touchSlot(slot);
      addCalendarHistory(fresh.store, "Canceled speaker", slot, calendarHistoryPersonName(speaker) + " canceled bringing this talk.");
      notice = sendEmail ? "Speaker canceled and email notices were queued." : "Speaker canceled. No email notice was queued.";
    }
    if (action.type === "clear-backup") {
      var backup = slot.backups[action.backupIndex];
      if (backup) {
        if (sendEmail) queuePersonCancellationNotifications(slot, backup, "backup");
        slot.backups.splice(action.backupIndex, 1);
        touchSlot(slot);
        addCalendarHistory(fresh.store, "Canceled backup", slot, calendarHistoryPersonName(backup) + " canceled as a backup for this talk.");
        notice = sendEmail ? "Backup canceled and email notices were queued." : "Backup canceled. No email notice was queued.";
      }
    }
    if (action.type === "clear-attendee") {
      var attendee = slot.attendees[action.attendeeIndex];
      if (attendee) {
        if (sendEmail) queuePersonCancellationNotifications(slot, attendee, "attendee");
        slot.attendees.splice(action.attendeeIndex, 1);
        touchSlot(slot);
        addCalendarHistory(fresh.store, "Canceled attendee", slot, calendarHistoryPersonName(attendee) + " canceled attending this " + (isTalkSlot(slot) ? "talk" : "meeting") + ".");
        notice = sendEmail ? "Attendee canceled and email notices were queued." : "Attendee canceled. No email notice was queued.";
      }
    }
    if (action.type === "cancel-meeting") {
      if (options.cancelMode === "remove") {
        removeCalendarItemFromAdmin(root, fresh.store, slot, year, month, sendEmail);
        return;
      }
      if (cancelCalendarItem(slot, sendEmail)) {
        addCalendarHistory(fresh.store, "Canceled meeting", slot, "Canceled " + calendarHistoryItemLabel(slot) + ".");
        notice = sendEmail ? "Meeting canceled and email notices were queued." : "Meeting canceled. No email notice was queued.";
      } else {
        notice = "This meeting was already canceled.";
      }
    }
    if (action.type === "remove-meeting") {
      removeCalendarItemFromAdmin(root, fresh.store, slot, year, month, sendEmail);
      return;
    }
    if (action.type === "push-week") {
      if (!slot.recurrenceId) {
        renderAdmin(root, { year: year, month: month, selectedDate: selectedDate, selectedSlotId: slot.id, notice: "Only recurring meeting items can be pushed forward." });
        return;
      }
      var startDate = slot.date;
      var affectedIds = fresh.store.slots.filter(function (item) {
        return shouldShiftSlot(item, startDate, slot.recurrenceId, slot.id);
      }).map(function (item) {
        return item.id;
      });
      queuePushForwardNotifications(fresh.store, startDate, slot.recurrenceId, slot.id, sendEmail);
      fresh.store.slots.forEach(function (item) {
        if (affectedIds.indexOf(item.id) !== -1) touchSlot(item);
      });
      addCalendarHistory(fresh.store, "Pushed schedule forward", slot, "Pushed this recurring group forward one week.");
      nextSelectedDate = shiftDateByDays(startDate, 7);
      notice = sendEmail ? "Schedule moved forward one week and email notices were queued." : "Schedule moved forward one week. No email notice was queued.";
    }
    fresh.store.slots.sort(byDateTime);
    saveStore(fresh.store);
    renderAdmin(root, { year: parseDate(nextSelectedDate).getFullYear(), month: parseDate(nextSelectedDate).getMonth(), selectedDate: nextSelectedDate, selectedSlotId: slot.id, notice: notice });
  }

  function removeCalendarItemFromAdmin(root, store, slot, year, month, sendEmail) {
    if (sendEmail) queueMeetingCancellationNotifications(slot);
    skipRecurringDateForSlot(store, slot);
    addCalendarHistory(store, "Removed calendar item", slot, "Removed " + calendarHistoryItemLabel(slot) + " from the calendar.");
    store.slots = store.slots.filter(function (item) { return item.id !== slot.id; });
    saveStore(store);
    renderAdmin(root, { year: year, month: month, notice: sendEmail ? "Calendar item removed and email notices were queued." : "Calendar item removed. No email notice was queued." });
  }

  function skipRecurringDateForSlot(store, slot) {
    if (!slot || !slot.recurrenceId) return;
    var recurrence = store.recurrences.find(function (rule) { return rule.id === slot.recurrenceId; });
    if (!recurrence) return;
    recurrence.skippedDates = uniqueStrings((recurrence.skippedDates || []).concat([slot.date]));
    recurrence.updatedAt = new Date().toISOString();
  }

  function fieldMarkup(label, name, type, required, value) {
    return '<label class="block mb-4">' +
      '<span class="block text-xs uppercase tracking-widest font-bold text-sangha-navy mb-2">' + label + (required ? '' : ' <span class="text-gray-400 font-bold">(optional)</span>') + '</span>' +
      '<input class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sangha-gold" type="' + type + '" name="' + name + '" value="' + escapeHtml(value || "") + '"' + (required ? " required" : "") + ' />' +
    '</label>';
  }

  function numberFieldMarkup(label, name, value, min, max, description) {
    return '<label class="block mb-4">' +
      '<span class="block text-xs uppercase tracking-widest font-bold text-sangha-navy mb-2">' + escapeHtml(label) + '</span>' +
      '<input class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sangha-gold" type="number" name="' + escapeHtml(name) + '" min="' + escapeHtml(min) + '" max="' + escapeHtml(max) + '" step="1" value="' + escapeHtml(value) + '" required />' +
      (description ? '<span class="mt-2 block text-xs leading-relaxed text-gray-500">' + escapeHtml(description) + '</span>' : '') +
    '</label>';
  }

  function textareaMarkup(label, name, required, value) {
    return '<label class="block mb-4">' +
      '<span class="block text-xs uppercase tracking-widest font-bold text-sangha-navy mb-2">' + label + (required ? '' : ' <span class="text-gray-400 font-bold">(optional)</span>') + '</span>' +
      '<textarea class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm min-h-28 focus:outline-none focus:ring-2 focus:ring-sangha-gold" name="' + name + '"' + (required ? " required" : "") + '>' + escapeHtml(value || "") + '</textarea>' +
    '</label>';
  }

  function checkboxMarkup(name, label, checked, description) {
    return '<label class="mb-4 flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-600">' +
      '<input type="checkbox" name="' + escapeHtml(name) + '" class="mt-0.5 accent-sangha-gold"' + (checked ? ' checked' : '') + ' />' +
      '<span><span class="font-bold text-sangha-navy">' + escapeHtml(label) + '</span>' +
      (description ? '<span class="mt-1 block text-xs text-gray-500">' + escapeHtml(description) + '</span>' : '') +
      '</span>' +
    '</label>';
  }

  function adminDateTimeRowMarkup(dateLabel, dateName, dateValue, startValue, endValue) {
    return '<div data-admin-date-time-row class="grid gap-3 md:grid-cols-3">' +
      fieldMarkup(dateLabel, dateName, "date", true, dateValue) +
      fieldMarkup("Start Time", "startTime", "time", true, startValue) +
      fieldMarkup("End Time", "endTime", "time", true, endValue) +
    '</div>';
  }

  function locationControlMarkup(value, useDefault, settings, usePhysical) {
    settings = normalizeCalendarSettings(settings);
    var physicalChecked = usePhysical !== false;
    var checked = useDefault !== false;
    return '<div data-location-control class="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-4">' +
      '<label class="flex items-start gap-3 text-sm text-gray-600">' +
        '<input type="checkbox" name="usePhysicalLocation" class="mt-0.5 accent-sangha-gold"' + (physicalChecked ? ' checked' : '') + ' />' +
        '<span><span class="font-bold text-sangha-navy">Use physical location</span><span class="mt-1 block text-xs text-gray-500">Keep this checked for in-person or hybrid meetings.</span></span>' +
      '</label>' +
      '<div data-physical-location-fields class="' + (physicalChecked ? '' : 'hidden ') + 'mt-4">' +
      '<label class="flex items-start gap-3 text-sm text-gray-600">' +
        '<input type="checkbox" name="useDefaultLocation" class="mt-0.5 accent-sangha-gold"' + (checked ? ' checked' : '') + ' />' +
        '<span><span class="font-bold text-sangha-navy">Use default location</span><span class="mt-1 block text-xs text-gray-500">Future items checked here will follow changes to the default location.</span></span>' +
      '</label>' +
      '<div data-default-location-preview class="' + (checked ? '' : 'hidden ') + 'mt-3 rounded-lg border border-gray-200 bg-white p-3 text-sm font-bold leading-relaxed text-sangha-navy" style="white-space: pre-line;">' + escapeHtml(settings.defaultLocation) + '</div>' +
      '<div data-custom-location class="' + (checked ? 'hidden ' : '') + 'mt-3">' +
        '<span class="mb-2 block text-xs uppercase tracking-widest font-bold text-sangha-navy">Custom Location</span>' +
        '<textarea class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm min-h-28 focus:outline-none focus:ring-2 focus:ring-sangha-gold" name="location">' + escapeHtml(value || settings.defaultLocation) + '</textarea>' +
      '</div>' +
      '</div>' +
    '</div>';
  }

  function adminCollapsedLocationMarkup(value, useDefault, settings, usePhysical) {
    return '<details data-admin-section="item-location" class="mb-4 rounded-xl border border-gray-200 bg-gray-50">' +
      '<summary class="cursor-pointer list-none rounded-xl px-4 py-3 text-xs uppercase tracking-widest font-bold text-sangha-navy hover:bg-sangha-light">Location</summary>' +
      '<div class="border-t border-gray-200 p-4">' +
        locationControlMarkup(value, useDefault, settings, usePhysical) +
      '</div>' +
    '</details>';
  }

  function wireLocationControls(root) {
    root.querySelectorAll("[data-location-control]").forEach(function (control) {
      var physicalCheckbox = control.querySelector('[name="usePhysicalLocation"]');
      var checkbox = control.querySelector('[name="useDefaultLocation"]');
      var physicalFields = control.querySelector("[data-physical-location-fields]");
      var preview = control.querySelector("[data-default-location-preview]");
      var custom = control.querySelector("[data-custom-location]");
      if (!physicalCheckbox || !checkbox || !physicalFields || !preview || !custom) return;
      var sync = function () {
        physicalFields.classList.toggle("hidden", !physicalCheckbox.checked);
        preview.classList.toggle("hidden", !physicalCheckbox.checked || !checkbox.checked);
        custom.classList.toggle("hidden", !physicalCheckbox.checked || checkbox.checked);
      };
      physicalCheckbox.addEventListener("change", sync);
      checkbox.addEventListener("change", sync);
      sync();
    });
  }

  function wirePersonalReminderForm(root, slotId, renderFn) {
    var form = root.querySelector("#personal-reminder-form");
    if (!form) return;
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var freshStore = loadStore();
      var freshSlot = findSlotById(freshStore, slotId);
      if (!freshSlot) {
        renderFn(root);
        return;
      }
      var person = updateCurrentUserReminders(freshSlot, selectedPersonalReminders(event.currentTarget));
      if (!person) {
        renderFn(root);
        return;
      }
      touchSlot(freshSlot);
      addCalendarHistory(freshStore, "Reminder preferences updated", freshSlot, calendarHistoryPersonName(person) + " updated reminder preferences.");
      saveStore(freshStore);
      renderFn(root);
    });
  }

  function renderSchedule(root) {
    var store = loadStore();
    var params = new URLSearchParams(window.location.search);
    var slotId = params.get("slot");
    var slot = store.slots.find(function (item) { return item.id === slotId; });
    if (!slot) {
      renderScheduleList(root, store);
      return;
    }
    if (isMeetingSlot(slot)) {
      renderMeetingSchedule(root, store, slot);
      return;
    }

    var backupRows = orderedBackups(slot, store).map(function (backup, index) {
      return '<li class="flex items-start justify-between gap-3 py-3 border-b border-gray-100 last:border-b-0">' +
        '<div>' +
          '<span class="text-sm text-sangha-navy font-bold">' + (index + 1) + '. ' + escapeHtml(publicName(backup.name)) + '</span>' +
          '<p class="text-xs text-gray-400 mt-0.5">Signed up ' + escapeHtml(formatSignedUpAt(backup.signedUpAt)) + '</p>' +
          renderVolunteerMeta(backup, isPastSlot(slot)) +
        '</div>' +
      '</li>';
    }).join("");
    var past = isPastSlot(slot);
    var closed = past || slot.canceled;
    var exportUrl = icsDataUrl(slot, store.settings);
    var calendarUrl = appUrl("calendar/", { month: slot.date.slice(0, 7) });
    var currentAttendee = currentUserAttendee(slot);
    var currentReminderPerson = currentUserCalendarPerson(slot);
    var topReminderControls = renderTopReminderControls(currentReminderPerson);

    renderShell(root,
      '<div class="grid gap-6">' +
        '<div>' +
          '<a href="' + escapeHtml(calendarUrl) + '" class="inline-flex rounded-lg border border-gray-200 bg-white px-4 py-3 text-xs uppercase tracking-widest font-bold text-sangha-navy shadow-sm hover:bg-sangha-light">Back To Calendar</a>' +
        '</div>' +
        '<article class="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 md:p-8">' +
          '<div class="flex flex-wrap items-center gap-2 mb-3">' +
            '<span class="text-[10px] uppercase tracking-widest font-bold ' + (past ? 'text-gray-500' : slot.canceled ? 'text-red-700' : slot.speaker ? 'text-sangha-navy' : 'text-sangha-gold') + '">' + slotStatus(slot) + '</span>' +
            '<span class="text-xs text-gray-400">' + displayDate(slot.date) + ' at ' + displayTimeRange(slot) + '</span>' +
          '</div>' +
          '<h2 class="font-serif text-2xl font-bold text-sangha-navy">' + escapeHtml(slot.title || "Talk offering") + '</h2>' +
          '<p class="text-gray-600 mt-3 leading-relaxed" style="white-space: pre-line;">' + escapeHtml(slot.description || "") + '</p>' +
          renderLocationSummary(slot) +
          renderZoomSummary(slot, store) +
          '<div class="mt-5 flex flex-wrap items-start gap-3">' +
            '<a href="' + exportUrl + '" download="talk-' + escapeHtml(slot.date) + '.ics" class="inline-flex items-center rounded-lg border border-gray-200 px-3 py-2 text-[10px] uppercase tracking-widest font-bold text-sangha-navy hover:bg-sangha-light">Add To Calendar</a>' +
            topReminderControls +
          '</div>' +
        '</article>' +
        '<div class="' + (closed ? 'grid' : 'grid md:grid-cols-2') + ' gap-6">' +
          (past ? renderPastMeetingPanel(slot) : slot.canceled ? renderCanceledMeetingPanel(slot) : renderPrimaryPanel(slot, store.settings)) +
          (closed ? '' : '<div class="grid gap-2">' +
            renderTalkAttendancePanel(slot, currentAttendee, store.settings) +
            renderBackupPanel(slot, backupRows, store.settings) +
          '</div>') +
        '</div>' +
      '</div>');

    wirePersonalReminderForm(root, slot.id, renderSchedule);

    var cancelButton = root.querySelector("[data-cancel-primary]");
    if (cancelButton) {
      cancelButton.addEventListener("click", function () {
        var freshStore = loadStore();
        var freshSlot = findSlotById(freshStore, slot.id);
        if (!freshSlot || !freshSlot.speaker) {
          renderSchedule(root);
          return;
        }
        var speaker = freshSlot.speaker;
        queueBackupCancellationEmails(freshSlot);
        freshSlot.speaker = null;
        touchSlot(freshSlot);
        addCalendarHistory(freshStore, "Speaker canceled signup", freshSlot, calendarHistoryPersonName(speaker) + " canceled bringing this talk.");
        saveStore(freshStore);
        renderSchedule(root);
      });
    }

    var promoteBackupButton = root.querySelector("[data-promote-backup]");
    if (promoteBackupButton) {
      promoteBackupButton.addEventListener("click", function () {
        var freshStore = loadStore();
        var freshSlot = findSlotById(freshStore, slot.id);
        if (!freshSlot || freshSlot.speaker) {
          window.alert("Someone else is already bringing this talk. The page will refresh with the latest schedule.");
          renderSchedule(root);
          return;
        }
        var backup = currentUserBackup(freshSlot);
        promoteBackupToSpeaker(freshSlot, backup);
        touchSlot(freshSlot);
        addCalendarHistory(freshStore, "Backup promoted", freshSlot, calendarHistoryPersonName(backup) + " moved from backup to bringing this talk.");
        saveStore(freshStore);
        renderSchedule(root);
      });
    }

    var primaryForm = root.querySelector("#talk-primary-form");
    if (primaryForm) {
      primaryForm.addEventListener("submit", function (event) {
        event.preventDefault();
        var freshStore = loadStore();
        var freshSlot = findSlotById(freshStore, slot.id);
        if (!freshSlot || freshSlot.speaker) {
          window.alert("Someone else just signed up to bring this talk. The page will refresh with the latest schedule.");
          renderSchedule(root);
          return;
        }
        freshSlot.speaker = formVolunteer(event.currentTarget);
        removeDirectAttendanceForPerson(freshSlot, freshSlot.speaker);
        touchSlot(freshSlot);
        addCalendarHistory(freshStore, "Speaker signed up", freshSlot, calendarHistoryPersonName(freshSlot.speaker) + " signed up to bring this talk.");
        saveStore(freshStore);
        renderSchedule(root);
      });
    }

    var speakerDetailsForm = root.querySelector("#talk-speaker-details-form");
    if (speakerDetailsForm) {
      speakerDetailsForm.addEventListener("submit", function (event) {
        event.preventDefault();
        var freshStore = loadStore();
        var freshSlot = findSlotById(freshStore, slot.id);
        if (!freshSlot || !freshSlot.speaker || personKey(freshSlot.speaker.name) !== personKey(currentUserName())) {
          window.alert("This talk assignment changed. The page will refresh with the latest schedule.");
          renderSchedule(root);
          return;
        }
        freshSlot.speaker.link = fieldValue(event.currentTarget, "link");
        freshSlot.speaker.notes = fieldValue(event.currentTarget, "notes");
        touchSlot(freshSlot);
        addCalendarHistory(freshStore, "Speaker updated details", freshSlot, calendarHistoryPersonName(freshSlot.speaker) + " updated their talk link or notes.");
        saveStore(freshStore);
        renderSchedule(root);
      });
    }

    var talkAttendanceForm = root.querySelector("#talk-attendance-form");
    if (talkAttendanceForm) {
      talkAttendanceForm.addEventListener("submit", function (event) {
        event.preventDefault();
        var freshStore = loadStore();
        var freshSlot = findSlotById(freshStore, slot.id);
        if (!freshSlot) {
          renderSchedule(root);
          return;
        }
        var attendee = formVolunteer(event.currentTarget);
        var existingAttendee = currentUserAttendee(freshSlot);
        if (existingAttendee) {
          existingAttendee.email = attendee.email;
          existingAttendee.reminders = attendee.reminders;
        } else {
          freshSlot.attendees.push(attendee);
        }
        touchSlot(freshSlot);
        addCalendarHistory(freshStore, existingAttendee ? "Attendee updated signup" : "Attendee signed up", freshSlot, existingAttendee ? calendarHistoryPersonName(attendee) + " updated their attendance for this talk." : calendarHistoryPersonName(attendee) + " signed up to attend this talk.");
        saveStore(freshStore);
        renderSchedule(root);
      });
    }

    var cancelTalkAttendanceButton = root.querySelector("[data-cancel-talk-attendance]");
    if (cancelTalkAttendanceButton) {
      cancelTalkAttendanceButton.addEventListener("click", function () {
        var freshStore = loadStore();
        var freshSlot = findSlotById(freshStore, slot.id);
        if (!freshSlot) {
          renderSchedule(root);
          return;
        }
        var attendee = currentUserAttendee(freshSlot);
        if (!attendee) {
          renderSchedule(root);
          return;
        }
        freshSlot.attendees = freshSlot.attendees.filter(function (item) {
          return personKey(item.name) !== personKey(attendee.name);
        });
        touchSlot(freshSlot);
        addCalendarHistory(freshStore, "Attendee canceled signup", freshSlot, calendarHistoryPersonName(attendee) + " canceled attending this talk.");
        saveStore(freshStore);
        renderSchedule(root);
      });
    }

    var backupForm = root.querySelector("#talk-backup-form");
    if (backupForm) {
      backupForm.addEventListener("submit", function (event) {
        event.preventDefault();
        var volunteer = formVolunteer(event.currentTarget);
        var freshStore = loadStore();
        var freshSlot = findSlotById(freshStore, slot.id);
        if (!freshSlot) {
          renderSchedule(root);
          return;
        }
        var existingBackup = freshSlot.backups.find(function (backup) {
          return personKey(backup.name) === personKey(volunteer.name);
        });
        if (existingBackup) {
          existingBackup.link = volunteer.link;
          existingBackup.notes = volunteer.notes;
          existingBackup.reminders = volunteer.reminders;
        } else {
          freshSlot.backups.push(volunteer);
        }
        removeDirectAttendanceForPerson(freshSlot, volunteer);
        touchSlot(freshSlot);
        addCalendarHistory(freshStore, existingBackup ? "Backup updated signup" : "Backup signed up", freshSlot, existingBackup ? calendarHistoryPersonName(volunteer) + " updated their backup details for this talk." : calendarHistoryPersonName(volunteer) + " signed up as a backup for this talk.");
        saveStore(freshStore);
        renderSchedule(root);
      });
    }

    var backupDetailsForm = root.querySelector("#talk-backup-details-form");
    if (backupDetailsForm) {
      backupDetailsForm.addEventListener("submit", function (event) {
        event.preventDefault();
        var freshStore = loadStore();
        var freshSlot = findSlotById(freshStore, slot.id);
        if (!freshSlot) {
          renderSchedule(root);
          return;
        }
        var backup = currentUserBackup(freshSlot);
        if (!backup) {
          window.alert("This backup signup changed. The page will refresh with the latest schedule.");
          renderSchedule(root);
          return;
        }
        backup.link = fieldValue(event.currentTarget, "link");
        backup.notes = fieldValue(event.currentTarget, "notes");
        touchSlot(freshSlot);
        addCalendarHistory(freshStore, "Backup updated signup", freshSlot, calendarHistoryPersonName(backup) + " updated their backup details for this talk.");
        saveStore(freshStore);
        renderSchedule(root);
      });
    }

    var cancelBackupButton = root.querySelector("[data-cancel-current-backup]");
    if (cancelBackupButton) {
      cancelBackupButton.addEventListener("click", function () {
        var freshStore = loadStore();
        var freshSlot = findSlotById(freshStore, slot.id);
        if (!freshSlot) {
          renderSchedule(root);
          return;
        }
        var backup = cancelCurrentBackupSignup(freshSlot);
        if (!backup) {
          renderSchedule(root);
          return;
        }
        touchSlot(freshSlot);
        addCalendarHistory(freshStore, "Backup canceled signup", freshSlot, calendarHistoryPersonName(backup) + " canceled as a backup for this talk.");
        saveStore(freshStore);
        renderSchedule(root);
      });
    }
  }

  function formVolunteer(form) {
    return {
      name: fieldValue(form, "name"),
      email: fieldValue(form, "email") || currentUserEmail(),
      link: fieldValue(form, "link"),
      notes: fieldValue(form, "notes"),
      reminders: selectedPersonalReminders(form),
      signedUpAt: new Date().toISOString()
    };
  }

  function selectedPersonalReminders(form) {
    if (!form || !form.querySelectorAll) return [];
    return uniqueStrings(Array.prototype.slice.call(form.querySelectorAll('[name="personalReminders"]:checked')).map(function (checkbox) {
      return checkbox.value;
    }));
  }

  function formatSignedUpAt(value) {
    if (!value) return "just now";
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return "just now";
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " at " + date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  function renderPastMeetingPanel(slot) {
    return '<aside class="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 h-fit">' +
      '<h3 class="font-serif text-xl font-bold text-sangha-navy mb-3">Already Passed</h3>' +
      '<p class="text-sm text-gray-600 leading-relaxed">This meeting has already passed, so new primary and backup signups are closed.</p>' +
      '<div class="mt-5 rounded-xl bg-gray-50 border border-gray-200 p-4">' +
        '<p class="text-xs uppercase tracking-widest font-bold text-gray-400 mb-1">Talk Brought By</p>' +
        '<p class="text-sangha-navy font-bold">' + escapeHtml(slot.speaker && slot.speaker.name ? publicName(slot.speaker.name) : "No speaker recorded") + '</p>' +
        (slot.speaker ? renderVolunteerMeta(slot.speaker, true) : '') +
      '</div>' +
    '</aside>';
  }

  function renderCanceledMeetingPanel(slot) {
    return '<aside class="bg-white rounded-2xl border border-red-200 shadow-sm p-6 h-fit">' +
      '<h3 class="font-serif text-xl font-bold text-red-700 mb-3">Meeting Canceled</h3>' +
      '<p class="text-sm text-gray-600 leading-relaxed">This meeting has been canceled, so primary and backup signups are closed.</p>' +
      '<div class="mt-5 rounded-xl bg-red-50 border border-red-100 p-4">' +
        '<p class="text-xs uppercase tracking-widest font-bold text-gray-400 mb-1">Talk Was Assigned To</p>' +
        '<p class="text-sangha-navy font-bold">' + escapeHtml(slot.speaker && slot.speaker.name ? publicName(slot.speaker.name) : "No speaker recorded") + '</p>' +
        (slot.speaker ? renderVolunteerMeta(slot.speaker, true) : '') +
      '</div>' +
    '</aside>';
  }

  function renderMeetingSchedule(root, store, slot) {
    var params = new URLSearchParams(window.location.search);
    if (params.get("attend") === "1" && isLoggedIn() && !isPastSlot(slot) && !slot.canceled && signupWindowOpen(slot, store.settings) && !currentUserAttendee(slot)) {
      addCurrentUserAttendance(store, slot);
      saveStore(store);
      store = loadStore();
      slot = findSlotById(store, slot.id) || slot;
    }
    var past = isPastSlot(slot);
    var closed = past || slot.canceled;
    var exportUrl = icsDataUrl(slot, store.settings);
    var calendarUrl = appUrl("calendar/", { month: slot.date.slice(0, 7) });
    var currentAttendee = currentUserAttendee(slot);
    var topReminderControls = renderTopReminderControls(currentAttendee);
    renderShell(root,
      '<div class="grid gap-6">' +
        '<div>' +
          '<a href="' + escapeHtml(calendarUrl) + '" class="inline-flex rounded-lg border border-gray-200 bg-white px-4 py-3 text-xs uppercase tracking-widest font-bold text-sangha-navy shadow-sm hover:bg-sangha-light">Back To Calendar</a>' +
        '</div>' +
        '<article class="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 md:p-8">' +
          '<div class="flex flex-wrap items-center gap-2 mb-3">' +
            '<span class="text-[10px] uppercase tracking-widest font-bold ' + (past ? 'text-gray-500' : slot.canceled ? 'text-red-700' : 'text-sangha-navy') + '">' + slotStatus(slot) + '</span>' +
            '<span class="text-xs text-gray-400">' + displayDate(slot.date) + ' at ' + displayTimeRange(slot) + '</span>' +
          '</div>' +
          '<h2 class="font-serif text-2xl font-bold text-sangha-navy">' + escapeHtml(slot.title || "Regular meeting") + '</h2>' +
          '<p class="text-gray-600 mt-3 leading-relaxed" style="white-space: pre-line;">' + escapeHtml(slot.description || "") + '</p>' +
          renderLocationSummary(slot) +
          renderZoomSummary(slot, store) +
          '<div class="mt-5 flex flex-wrap items-start gap-3">' +
            '<a href="' + exportUrl + '" download="meeting-' + escapeHtml(slot.date) + '.ics" class="inline-flex items-center rounded-lg border border-gray-200 px-3 py-2 text-[10px] uppercase tracking-widest font-bold text-sangha-navy hover:bg-sangha-light">Add To Calendar</a>' +
            topReminderControls +
          '</div>' +
        '</article>' +
        '<div class="' + (closed ? 'grid' : 'grid md:grid-cols-2') + ' gap-6">' +
          (closed ? renderMeetingClosedPanel(slot) : renderAttendancePanel(slot, currentAttendee, store.settings)) +
          (closed ? '' : renderAttendeeListPanel(slot)) +
        '</div>' +
      '</div>');

    wirePersonalReminderForm(root, slot.id, renderSchedule);

    var attendanceForm = root.querySelector("#meeting-attendance-form");
    if (attendanceForm) {
      attendanceForm.addEventListener("submit", function (event) {
        event.preventDefault();
        var freshStore = loadStore();
        var freshSlot = findSlotById(freshStore, slot.id);
        if (!freshSlot) {
          renderSchedule(root);
          return;
        }
        var attendee = formVolunteer(event.currentTarget);
        var existingAttendee = currentUserAttendee(freshSlot);
        if (existingAttendee) {
          existingAttendee.email = attendee.email;
          existingAttendee.reminders = attendee.reminders;
        } else {
          freshSlot.attendees.push(attendee);
        }
        touchSlot(freshSlot);
        addCalendarHistory(freshStore, existingAttendee ? "Attendee updated signup" : "Attendee signed up", freshSlot, existingAttendee ? calendarHistoryPersonName(attendee) + " updated their attendance for this meeting." : calendarHistoryPersonName(attendee) + " signed up to attend this meeting.");
        saveStore(freshStore);
        renderSchedule(root);
      });
    }

    var cancelAttendanceButton = root.querySelector("[data-cancel-attendance]");
    if (cancelAttendanceButton) {
      cancelAttendanceButton.addEventListener("click", function () {
        var freshStore = loadStore();
        var freshSlot = findSlotById(freshStore, slot.id);
        if (!freshSlot) {
          renderSchedule(root);
          return;
        }
        var attendee = currentUserAttendee(freshSlot);
        if (!attendee) {
          renderSchedule(root);
          return;
        }
        freshSlot.attendees = freshSlot.attendees.filter(function (item) {
          return personKey(item.name) !== personKey(attendee.name);
        });
        touchSlot(freshSlot);
        addCalendarHistory(freshStore, "Attendee canceled signup", freshSlot, calendarHistoryPersonName(attendee) + " canceled attending this meeting.");
        saveStore(freshStore);
        renderSchedule(root);
      });
    }
  }

  function renderMeetingClosedPanel(slot) {
    return '<aside class="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 h-fit">' +
      '<h3 class="font-serif text-xl font-bold text-sangha-navy mb-3">' + (slot.canceled ? "Meeting Canceled" : "Already Passed") + '</h3>' +
      '<p class="text-sm text-gray-600 leading-relaxed">Attendance signups are closed for this meeting.</p>' +
      '<p class="mt-5 rounded-xl bg-gray-50 border border-gray-200 p-4 text-sm text-gray-600">' + escapeHtml(attendanceCountLabel(slot)) + ' recorded.</p>' +
    '</aside>';
  }

  function renderSignupWindowNotice(slot, settings, label) {
    return '<div class="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm leading-relaxed text-gray-600">' +
      '<p class="font-bold text-sangha-navy">' + escapeHtml(label) + '</p>' +
      '<p class="mt-1">' + escapeHtml(signupWindowMessage(slot, settings, label)) + '</p>' +
    '</div>';
  }

  function renderVolunteerWindowPanel(slot, settings) {
    return '<aside class="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 h-fit">' +
      '<h3 class="font-serif text-xl font-bold text-sangha-navy mb-3">Will Open For Volunteers</h3>' +
      '<p class="text-sm text-gray-600 leading-relaxed">This will open for volunteers ' + escapeHtml(signupWindowLabel(settings)) + ' before the meeting, on ' + escapeHtml(displayDate(signupOpenDate(slot, settings))) + '.</p>' +
    '</aside>';
  }

  function renderAttendanceIntentNote(extraClass) {
    return '<p class="' + (extraClass || "mt-3") + ' py-2 text-xs leading-relaxed text-gray-500">This is not an RSVP. Everyone is welcome whether or not they click.</p>';
  }

  function renderAttendancePanel(slot, currentAttendee, settings) {
    settings = normalizeCalendarSettings(settings);
    if (currentAttendee) {
      return '<aside class="bg-white rounded-2xl border border-green-200 bg-green-50 shadow-sm p-6 h-fit">' +
        '<h3 class="font-serif text-xl font-bold text-sangha-navy mb-3">You Are Attending</h3>' +
        renderAttendanceIntentNote("mb-4") +
        renderSignupConfirmation(slot, "You are signed up to attend", "", currentAttendee, settings, "") +
        '<button type="button" data-cancel-attendance class="w-full mt-5 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-xs uppercase tracking-widest font-bold hover:bg-red-50">Cancel Attendance</button>' +
      '</aside>';
    }
    if (!signupWindowOpen(slot, settings)) {
      return '<aside class="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 h-fit">' +
        '<h3 class="font-serif text-xl font-bold text-sangha-navy mb-3">Attendance Not Open Yet</h3>' +
        renderSignupWindowNotice(slot, settings, "Attendance signups") +
      '</aside>';
    }
    if (!isLoggedIn()) {
      return renderLoginRequiredPanel("attend this meeting");
    }
    return '<form id="meeting-attendance-form" class="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">' +
      '<h3 class="font-serif text-xl font-bold text-sangha-navy mb-3">Attend Meeting</h3>' +
      renderAttendanceIntentNote("mb-5") +
      renderUserNameField(currentUserName()) +
      '<button type="submit" class="w-full mt-2 bg-sangha-gold text-sangha-navy rounded-lg px-4 py-3 text-xs uppercase tracking-widest font-bold hover:bg-yellow-600">Click To Attend</button>' +
    '</form>';
  }

  function renderTalkAttendancePanel(slot, currentAttendee, settings) {
    settings = normalizeCalendarSettings(settings);
    var role = currentUserAttendanceRole(slot);
    var countText = attendanceCountLabel(slot);
    if (role) {
      return '<aside class="bg-white rounded-2xl border border-green-200 bg-green-50 shadow-sm p-6 h-fit">' +
        '<h3 class="font-serif text-xl font-bold text-sangha-navy mb-3">Attending</h3>' +
        '<p class="rounded-xl border border-green-100 bg-white p-4 text-sm font-bold text-sangha-navy">' + escapeHtml(countText) + '</p>' +
        renderAttendanceIntentNote() +
        (currentAttendee ?
          '<form id="talk-attendance-form" class="mt-5">' +
            confirmationHiddenUserFields() +
            renderSignupConfirmation(slot, "You are signed up to attend", "You are listed as attending this talk.", currentAttendee, settings, "") +
          '</form>' :
          '<p class="mt-4 text-sm text-gray-600 leading-relaxed">You are counted as attending because you are ' + escapeHtml(role) + '.</p>') +
        (currentAttendee ? '<button type="button" data-cancel-talk-attendance class="w-full mt-5 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-xs uppercase tracking-widest font-bold hover:bg-red-50">Cancel Attendance</button>' : '') +
      '</aside>';
    }
    if (!signupWindowOpen(slot, settings)) {
      return '<aside class="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 h-fit">' +
        '<h3 class="font-serif text-xl font-bold text-sangha-navy mb-3">Attending</h3>' +
        '<p class="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm font-bold text-sangha-navy">' + escapeHtml(countText) + '</p>' +
        renderAttendanceIntentNote("my-5") +
        renderSignupWindowNotice(slot, settings, "Attendance signups") +
      '</aside>';
    }
    if (!isLoggedIn()) {
      return '<aside class="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 h-fit">' +
        '<h3 class="font-serif text-xl font-bold text-sangha-navy mb-3">Attending</h3>' +
        '<p class="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm font-bold text-sangha-navy">' + escapeHtml(countText) + '</p>' +
        renderAttendanceIntentNote() +
        '<div class="mt-5">' + renderLoginRequiredInline("mark yourself as attending") + '</div>' +
      '</aside>';
    }
    return '<form id="talk-attendance-form" class="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 h-fit">' +
      '<h3 class="font-serif text-xl font-bold text-sangha-navy mb-3">Attending</h3>' +
      '<p class="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm font-bold text-sangha-navy">' + escapeHtml(countText) + '</p>' +
      renderAttendanceIntentNote("my-5") +
      '<input type="hidden" name="name" value="' + escapeHtml(currentUserName()) + '" />' +
      '<input type="hidden" name="email" value="' + escapeHtml(currentUserEmail()) + '" />' +
      '<button type="submit" class="w-full bg-sangha-gold text-sangha-navy rounded-lg px-4 py-3 text-xs uppercase tracking-widest font-bold hover:bg-yellow-600">Click To Attend</button>' +
    '</form>';
  }

  function renderAttendeeListPanel(slot) {
    var countText = attendanceCountLabel(slot);
    return '<aside class="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 h-fit">' +
      '<h3 class="font-serif text-xl font-bold text-sangha-navy mb-2">Attending</h3>' +
      '<p class="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm font-bold text-sangha-navy">' + escapeHtml(countText) + '</p>' +
      renderAttendanceIntentNote() +
      '<p class="mt-3 text-xs text-gray-500 leading-relaxed">Names are only visible to calendar admins.</p>' +
    '</aside>';
  }

  function renderVolunteerMeta(volunteer) {
    if (!volunteer || (!volunteer.link && !volunteer.notes)) return "";
    return '<div class="mt-3 space-y-2">' +
      (volunteer.link ? '<p class="text-xs text-gray-600"><span class="font-bold text-sangha-navy">Link:</span> <a class="text-sangha-gold hover:text-yellow-600 break-all" href="' + escapeHtml(volunteer.link) + '" target="_blank" rel="noopener">' + escapeHtml(volunteer.link) + '</a></p>' : '') +
      (volunteer.notes ? '<p class="text-xs text-gray-600"><span class="font-bold text-sangha-navy">Notes:</span> ' + escapeHtml(volunteer.notes) + '</p>' : '') +
    '</div>';
  }

  function reminderSummary(volunteer) {
    var selected = uniqueStrings(volunteer && volunteer.reminders);
    if (!selected.length) return "No email reminders selected.";
    var labels = REMINDER_OPTIONS.filter(function (option) {
      return selected.indexOf(option.id) !== -1;
    }).map(function (option) {
      return option.label;
    });
    return labels.length ? labels.join(", ") : "No email reminders selected.";
  }

  function confirmationHiddenUserFields() {
    return '<input type="hidden" name="name" value="' + escapeHtml(currentUserName()) + '" />' +
      '<input type="hidden" name="email" value="' + escapeHtml(currentUserEmail()) + '" />';
  }

  function renderTopReminderControls(person) {
    if (!person) return "";
    return '<form id="personal-reminder-form" class="min-w-64">' +
      confirmationHiddenUserFields() +
      renderPersonalReminderFields(person, "Save Reminder Preferences") +
    '</form>';
  }

  function renderSignupConfirmation(slot, title, body, person, settings, reminderControls) {
    return '<div class="mb-5 rounded-xl border border-green-200 bg-green-50 p-4">' +
      '<p class="text-[10px] uppercase tracking-widest font-bold text-green-700">Confirmed</p>' +
      '<h4 class="mt-1 font-serif text-lg font-bold text-sangha-navy">' + escapeHtml(title) + '</h4>' +
      (body ? '<p class="mt-2 text-sm leading-relaxed text-gray-600">' + escapeHtml(body) + '</p>' : '') +
      '<div class="mt-4 rounded-lg border border-green-100 bg-white p-3 text-xs leading-relaxed text-gray-600">' +
        '<p><span class="font-bold text-sangha-navy">Date:</span> ' + escapeHtml(displayDate(slot.date)) + '</p>' +
        '<p class="mt-1"><span class="font-bold text-sangha-navy">Time:</span> ' + escapeHtml(displayTimeRange(slot)) + '</p>' +
        (reminderControls ? '<div class="mt-3">' + reminderControls + '</div>' : '') +
      '</div>' +
    '</div>';
  }

  function renderLocationSummary(slot) {
    if (slot.usePhysicalLocation === false) return "";
    var location = slot.location || DEFAULT_LOCATION;
    if (!location) return "";
    return '<div class="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-4">' +
      '<p class="text-xs uppercase tracking-widest font-bold text-gray-400 mb-1">Location</p>' +
      '<p class="text-sm font-bold leading-relaxed text-sangha-navy" style="white-space: pre-line;">' + escapeHtml(location) + '</p>' +
    '</div>';
  }

  function renderPrimaryPanel(slot, settings) {
    settings = normalizeCalendarSettings(settings);
    var userName = currentUserName();
    var currentUserIsSpeaker = slot.speaker && personKey(slot.speaker.name) === personKey(userName);
    var userBackup = currentUserBackup(slot);

    if (currentUserIsSpeaker) {
      return '<aside class="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 h-fit">' +
        '<h3 class="font-serif text-xl font-bold text-sangha-navy mb-3">You Are Bringing This Talk</h3>' +
        '<form id="talk-speaker-details-form" class="mt-5">' +
          renderSignupConfirmation(slot, "You are signed up to bring this talk", "Thank you for volunteering.", slot.speaker, settings, "") +
          renderSpeakerClaimBlock(slot.speaker, isPastSlot(slot) || slot.canceled) +
          renderVolunteerLinkNotesFields(slot.speaker) +
          '<button type="submit" class="w-full mt-2 bg-sangha-navy text-white rounded-lg px-4 py-3 text-xs uppercase tracking-widest font-bold hover:bg-blue-900">Update Talk Details</button>' +
        '</form>' +
        '<button type="button" data-cancel-primary class="w-full mt-5 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-xs uppercase tracking-widest font-bold hover:bg-red-50">Cancel As Volunteer</button>' +
        '<p class="mt-3 text-sm text-gray-600 leading-relaxed">If you need to step back, that is okay. Thanks for letting us know.</p>' +
      '</aside>';
    }

    if (slot.speaker) {
      return '<aside class="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 h-fit">' +
        '<h3 class="font-serif text-xl font-bold text-sangha-navy mb-3">Volunteer Info</h3>' +
        renderSpeakerClaimBlock(slot.speaker, false) +
        '<p class="mt-4 text-sm text-gray-600 leading-relaxed">' + (signupWindowOpen(slot, settings) ? 'Backup volunteers are still welcome in case plans change.' : 'Backup volunteer signups are not open yet.') + '</p>' +
      '</aside>';
    }

    if (userBackup) {
      return '<aside class="bg-white rounded-2xl border border-green-200 bg-green-50 shadow-sm p-6 h-fit">' +
        '<h3 class="font-serif text-xl font-bold text-sangha-navy mb-3">You Are A Backup</h3>' +
        '<p class="text-sm text-gray-600 leading-relaxed">If the person bringing the talk has stepped back and you are able to offer it, you can move from backup to bringing the talk.</p>' +
        renderVolunteerMeta(userBackup, false) +
        '<button type="button" data-promote-backup class="w-full mt-5 bg-green-600 text-white rounded-lg px-4 py-3 text-xs uppercase tracking-widest font-bold hover:bg-green-700">Volunteer</button>' +
      '</aside>';
    }

    if (!signupWindowOpen(slot, settings)) {
      return renderVolunteerWindowPanel(slot, settings);
    }

    if (!isLoggedIn()) {
      return renderLoginRequiredPanel("volunteer to bring the talk");
    }

    return '<form id="talk-primary-form" class="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">' +
      '<h3 class="font-serif text-xl font-bold text-sangha-navy mb-3">Volunteer</h3>' +
      '<p class="mb-5 py-2 text-xs leading-relaxed text-gray-500">If you would like to volunteer to bring the 30 minute recorded Dharma talk on <span class="font-bold text-sangha-navy">' + escapeHtml(slot.title || "this topic") + '</span> this week, please sign up to volunteer here.</p>' +
      renderUserNameField(userName) +
      renderVolunteerDetailFields(null) +
      '<button type="submit" class="w-full mt-2 bg-sangha-gold text-sangha-navy rounded-lg px-4 py-3 text-xs uppercase tracking-widest font-bold hover:bg-yellow-600">Volunteer</button>' +
    '</form>';
  }

  function renderSpeakerClaimBlock(speaker, closed) {
    if (!speaker) return "";
    return '<div class="mb-4 rounded-xl bg-sangha-light border border-gray-100 p-4">' +
      '<p class="text-xs uppercase tracking-widest font-bold text-gray-400 mb-1">Who Is Bringing The Talk</p>' +
      '<p class="text-sangha-navy font-bold">' + escapeHtml(publicName(speaker.name)) + '</p>' +
      renderVolunteerMeta(speaker, closed) +
    '</div>';
  }

  function renderBackupPanel(slot, backupRows, settings) {
    settings = normalizeCalendarSettings(settings);
    var userName = currentUserName();
    var currentUserIsSpeaker = slot.speaker && personKey(slot.speaker.name) === personKey(userName);
    var userBackup = currentUserBackup(slot);
    return '<aside class="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 h-fit">' +
      '<h3 class="font-serif text-xl font-bold text-sangha-navy mb-2">Backup Volunteers</h3>' +
      '<p class="text-xs text-gray-500 mb-3">If you plan to attend and would be willing to bring the talk if needed, your backup signup is appreciated.</p>' +
      (currentUserIsSpeaker ? '<div class="rounded-xl border border-gray-200 bg-sangha-light p-4 text-sm text-gray-600 mb-5">You are already bringing this talk.</div>' :
        userBackup ? '<form id="talk-backup-details-form" class="mb-5">' +
          '<h4 class="text-sm font-bold text-sangha-navy mb-3">Your Backup Details</h4>' +
          renderSignupConfirmation(slot, "You are signed up as a backup", "Thank you for being willing to bring the talk if needed.", userBackup, settings, "") +
          '<p class="mb-4 text-xs leading-relaxed text-gray-500">Update the optional link or notes you would use if asked to bring the talk.</p>' +
          renderVolunteerLinkNotesFields(userBackup) +
          '<button type="submit" class="w-full mt-2 bg-sangha-navy text-white rounded-lg px-4 py-3 text-xs uppercase tracking-widest font-bold hover:bg-blue-900">Update Backup Details</button>' +
          '<button type="button" data-cancel-current-backup class="w-full mt-3 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-xs uppercase tracking-widest font-bold hover:bg-red-50">Cancel As Backup</button>' +
        '</form>' :
        !signupWindowOpen(slot, settings) ? '<div class="mb-5">' + renderSignupWindowNotice(slot, settings, "Backup volunteer signups") + '</div>' :
        !isLoggedIn() ? renderLoginRequiredInline("volunteer as a backup") :
        '<form id="talk-backup-form" class="mb-5">' +
          renderUserNameField(userName) +
          renderVolunteerDetailFields(null) +
          '<button type="submit" class="w-full mt-2 bg-sangha-gold text-sangha-navy rounded-lg px-4 py-3 text-xs uppercase tracking-widest font-bold hover:bg-yellow-600">Sign Up As Backup</button>' +
        '</form>') +
      (backupRows ? '<ul>' + backupRows + '</ul>' : '<p class="text-sm text-gray-500">No backups yet.</p>') +
    '</aside>';
  }

  function renderLoginRequiredPanel(actionLabel) {
    return '<aside class="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 h-fit">' +
      '<h3 class="font-serif text-xl font-bold text-sangha-navy mb-3">Sign In Required</h3>' +
      '<p class="text-sm text-gray-600 leading-relaxed">Please sign in before you ' + escapeHtml(actionLabel) + '. You can still view the calendar and event details without signing in.</p>' +
      '<p class="mt-4 rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-xs text-gray-600">Prototype note: the backend login is not connected yet. For preview, use <span class="font-bold text-sangha-navy">?as=Your%20Name&amp;email=you@example.com</span> on this page to simulate a signed-in member.</p>' +
    '</aside>';
  }

  function renderLoginRequiredInline(actionLabel) {
    return '<div class="mb-5 rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-sm text-gray-600">' +
      '<p class="font-bold text-sangha-navy">Sign in required</p>' +
      '<p class="mt-1 text-xs">Please sign in before you ' + escapeHtml(actionLabel) + '.</p>' +
    '</div>';
  }

  function renderUserNameField(userName) {
    return '<input type="hidden" name="name" value="' + escapeHtml(userName) + '" />' +
      '<input type="hidden" name="email" value="' + escapeHtml(currentUserEmail()) + '" />';
  }

  function renderVolunteerDetailFields(volunteer) {
    volunteer = volunteer || {};
    return renderVolunteerLinkNotesFields(volunteer);
  }

  function renderVolunteerLinkNotesFields(volunteer) {
    volunteer = volunteer || {};
    return fieldMarkup("Talk Link", "link", "url", false, volunteer.link || "") +
      textareaMarkup("Notes", "notes", false, volunteer.notes || "");
  }

  function renderPersonalReminderFields(volunteer, submitLabel) {
    var selected = {};
    uniqueStrings(volunteer && volunteer.reminders).forEach(function (optionId) {
      selected[optionId] = true;
    });
    var options = REMINDER_OPTIONS.map(function (option) {
      return '<label class="flex items-start gap-2 rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-600">' +
        '<input type="checkbox" name="personalReminders" value="' + escapeHtml(option.id) + '" class="mt-0.5" ' + (selected[option.id] ? 'checked' : '') + ' />' +
        '<span class="font-bold text-sangha-navy">' + escapeHtml(option.label) + '</span>' +
      '</label>';
    }).join("");
    return '<details class="rounded-lg border border-gray-200 bg-gray-50">' +
      '<summary class="inline-flex w-full cursor-pointer list-none items-center rounded-lg px-3 py-2 text-[10px] uppercase tracking-widest font-bold text-sangha-navy hover:bg-sangha-light" style="min-height: 33px;">Email Reminder Preferences</summary>' +
      '<div class="grid gap-2 border-t border-gray-200 p-3">' + options +
        (submitLabel ? '<button type="submit" class="w-full mt-2 bg-sangha-navy text-white rounded-lg px-4 py-3 text-xs uppercase tracking-widest font-bold hover:bg-blue-900">' + escapeHtml(submitLabel) + '</button>' : '') +
      '</div>' +
    '</details>';
  }

  function renderScheduleList(root, store) {
    var today = dateKey(new Date());
    var upcoming = store.slots.filter(function (slot) { return slot.date >= today; }).sort(byDateTime);
    var rows = upcoming.map(function (slot) {
      return '<a href="' + appUrl("calendar-item/", { slot: slot.id }) + '" class="block bg-white rounded-xl border border-gray-200 shadow-sm p-5 hover:border-sangha-gold transition-colors">' +
        '<div class="flex items-center justify-between gap-4">' +
          '<div>' +
            '<div class="text-xs text-gray-400 mb-1">' + displayDate(slot.date) + ' at ' + displayTimeRange(slot) + '</div>' +
            '<h2 class="font-serif text-lg font-bold text-sangha-navy">' + escapeHtml(slot.title || "Talk offering") + '</h2>' +
          '</div>' +
          '<span class="text-[10px] uppercase tracking-widest font-bold ' + (slot.speaker ? 'text-sangha-navy' : 'text-sangha-gold') + '">' + slotStatus(slot) + '</span>' +
        '</div>' +
      '</a>';
    }).join("");

    renderShell(root, '<div class="grid gap-4">' + (rows || '<div class="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">No calendar items yet.</div>') + '</div>');
  }

  function boot() {
    var root = document.getElementById("calendar-app");
    if (!root) return;
    try {
      appBaseUrl = root.getAttribute("data-calendar-base") || window.location.href;
      localDevelopmentPage = root.getAttribute("data-calendar-local-dev") === "true";
      if (new URLSearchParams(window.location.search).get("demo") === "1") {
        seedDemoStore();
      }
      applyUserFromQuery();
      var view = root.getAttribute("data-calendar-view");
      if (view === "calendar") renderCalendar(root, {});
      if (view === "admin") {
        if (hasCalendarAdminAccess()) renderAdmin(root, {});
        else renderAdminAccessGate(root);
      }
      if (view === "schedule") renderSchedule(root);
    } catch (error) {
      root.innerHTML = '<div class="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-800">' +
        '<p class="font-bold">Calendar could not load.</p>' +
        '<p class="mt-2 text-sm">' + escapeHtml(error && error.message ? error.message : String(error)) + '</p>' +
      '</div>';
      if (window.console && window.console.error) {
        window.console.error(error);
      }
    }
  }

  function memberRoleOnSlot(slot, email) {
    if (!slot) return null;
    var lc = String(email || "").toLowerCase();
    if (slot.speaker && String(slot.speaker.email || "").toLowerCase() === lc) return "speaker";
    if ((slot.backups || []).some(function (b) { return String(b.email || "").toLowerCase() === lc; })) return "backup";
    if ((slot.attendees || []).some(function (a) { return String(a.email || "").toLowerCase() === lc; })) return "attendee";
    return null;
  }

  function memberEntryOnSlot(slot, email, role) {
    var lc = String(email || "").toLowerCase();
    if (role === "speaker") return slot.speaker;
    var list = role === "backup" ? slot.backups : slot.attendees;
    return (list || []).filter(function (p) { return String(p.email || "").toLowerCase() === lc; })[0] || null;
  }

  function entriesDiffer(a, b) {
    if (!a || !b) return Boolean(a) !== Boolean(b);
    if ((a.link || "") !== (b.link || "")) return true;
    if ((a.notes || "") !== (b.notes || "")) return true;
    return (a.reminders || []).join(",") !== (b.reminders || []).join(",");
  }

  // Returns the changes to THIS member's own participation between two stores.
  function diffMemberSignups(prevStore, nextStore, email) {
    var deltas = [];
    var prevById = {};
    (prevStore.slots || []).forEach(function (slot) { prevById[slot.id] = slot; });
    (nextStore.slots || []).forEach(function (slot) {
      var prevSlot = prevById[slot.id];
      var before = memberRoleOnSlot(prevSlot, email);
      var after = memberRoleOnSlot(slot, email);
      if (!before && !after) return;
      if (before && !after) {
        deltas.push({ itemId: slot.id, action: "remove" });
        return;
      }
      if (after && before === after && !entriesDiffer(memberEntryOnSlot(prevSlot, email, before), memberEntryOnSlot(slot, email, after))) {
        return; // unchanged
      }
      var entry = memberEntryOnSlot(slot, email, after) || {};
      deltas.push({
        itemId: slot.id,
        action: "add",
        role: after,
        link: entry.link || "",
        notes: entry.notes || "",
        reminders: entry.reminders || []
      });
    });
    return deltas;
  }

  if (typeof window !== "undefined") {
    window.ECBSCalendarTest = {
      normalizeStore: normalizeStore,
      normalizeSlot: normalizeSlot,
      normalizeRecurrence: normalizeRecurrence,
      defaultCalendarStore: defaultCalendarStore,
      applyCalendarSettingsUpdate: applyCalendarSettingsUpdate,
      ensureRecurringSlots: ensureRecurringSlots,
      updateEmptyGeneratedSlotsForRecurrence: updateEmptyGeneratedSlotsForRecurrence,
      applyRecurrenceEditToGeneratedSlots: applyRecurrenceEditToGeneratedSlots,
      updateOccurrenceOverrides: updateOccurrenceOverrides,
      detachSlotsFromRecurrence: detachSlotsFromRecurrence,
      assignPersonToSlot: assignPersonToSlot,
      normalizeVolunteer: normalizeVolunteer,
      makeVolunteer: makeVolunteer,
      signedUpPeople: signedUpPeople,
      attendanceCount: attendanceCount,
      removeDirectAttendanceForPerson: removeDirectAttendanceForPerson,
      cancelCalendarItem: cancelCalendarItem,
      cancelCurrentBackupSignup: cancelCurrentBackupSignup,
      promoteBackupToSpeaker: promoteBackupToSpeaker,
      queuePushForwardNotifications: queuePushForwardNotifications,
      removeDuplicateDefaultSlots: removeDuplicateDefaultSlots,
      scheduleReminders: scheduleReminders,
      icsForSlot: icsForSlot,
      zoomLinkForSlot: zoomLinkForSlot,
      isSlotOccurringNow: isSlotOccurringNow,
      upcomingCalendarEmailText: upcomingCalendarEmailText,
      upcomingCalendarEmailHtml: upcomingCalendarEmailHtml,
      isLoggedIn: isLoggedIn,
      renderPrimaryPanel: renderPrimaryPanel,
      renderBackupPanel: renderBackupPanel,
      renderAttendancePanel: renderAttendancePanel,
      renderTalkAttendancePanel: renderTalkAttendancePanel,
      renderAttendeeListPanel: renderAttendeeListPanel,
      renderCalendar: renderCalendar,
      renderAdmin: renderAdmin,
      hasCalendarAdminAccess: hasCalendarAdminAccess,
      renderSchedule: renderSchedule,
      touchSlot: touchSlot,
      addCalendarHistory: addCalendarHistory,
      shiftDateByDays: shiftDateByDays,
      diffMemberSignups: diffMemberSignups,
      memberRoleOnSlot: memberRoleOnSlot
    };
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot);
    } else {
      boot();
    }
  }

  function applyUserFromQuery() {
    var params = new URLSearchParams(window.location.search);
    var name = params.get("as");
    if (!name || !window.localStorage) return;
    window.localStorage.setItem("ecbs-calendar-current-user-name", name);
    window.localStorage.setItem("ecbs-calendar-current-user-email", params.get("email") || emailFromName(name));
  }

  function initialMonthFromQuery() {
    var params = new URLSearchParams(window.location.search);
    var monthParam = params.get("month");
    if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
      var parts = monthParam.split("-");
      return { year: Number(parts[0]), month: Number(parts[1]) - 1 };
    }
    return { year: new Date().getFullYear(), month: new Date().getMonth() };
  }
})();
