// D1-backed calendar store with optimistic locking, privacy-safe projections,
// deterministic recurring occurrences, and server-authoritative signups.
import { authenticate, jsonResponse } from "./middleware.js";
import { resolveRole } from "./members.js";

const CALENDAR_TIME_ZONE = "America/Chicago";
const MAX_ADMIN_BODY_BYTES = 1024 * 1024;
const MAX_SIGNUP_BODY_BYTES = 16 * 1024;
const MAX_LINK_LENGTH = 2048;
const MAX_NOTES_LENGTH = 2000;
const REMINDER_IDS = new Set(["one-week", "one-day", "morning-of"]);

export function publicName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] || "";
  return parts[0] + " " + parts[parts.length - 1].charAt(0).toUpperCase() + ".";
}

export function deterministicOccurrenceId(recurrenceId, date) {
  return "occ-" + String(recurrenceId || "") + "-" + String(date || "");
}

export function makeServerVolunteer(name, email, body, nowIso) {
  const lcEmail = String(email || "").toLowerCase();
  return {
    name: name || lcEmail,
    email: lcEmail,
    link: typeof body.link === "string" ? body.link.trim() : "",
    notes: typeof body.notes === "string" ? body.notes.trim() : "",
    reminders: Array.isArray(body.reminders) ? body.reminders.filter((r) => REMINDER_IDS.has(r)) : [],
    signedUpAt: nowIso
  };
}

function personKey(person) {
  return String((person && (person.email || person.name)) || "").trim().toLowerCase();
}

function removeEmailFromSlot(slot, email) {
  const lc = String(email || "").toLowerCase();
  if (slot.speaker && String(slot.speaker.email || "").toLowerCase() === lc) slot.speaker = null;
  slot.backups = (slot.backups || []).filter((b) => String(b.email || "").toLowerCase() !== lc);
  slot.attendees = (slot.attendees || []).filter((a) => String(a.email || "").toLowerCase() !== lc);
}

function parseDate(date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ""));
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function dateToUtc(parts) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

function dateKey(date) {
  return date.getUTCFullYear() + "-" + String(date.getUTCMonth() + 1).padStart(2, "0") + "-" + String(date.getUTCDate()).padStart(2, "0");
}

function recurrenceMatchesDate(rule, dateValue) {
  const date = parseDate(dateValue);
  const start = parseDate(rule && rule.startDate);
  if (!date || !start || dateValue < rule.startDate) return false;
  const interval = Math.max(1, Number(rule.interval || 1));
  const dateUtc = dateToUtc(date);
  const startUtc = dateToUtc(start);
  if (rule.frequency === "weekly") {
    const diffDays = Math.round((dateUtc.getTime() - startUtc.getTime()) / 86400000);
    return diffDays >= 0 && diffDays % (7 * interval) === 0;
  }
  if (rule.frequency !== "monthly") return false;
  const monthDiff = (date.year - start.year) * 12 + date.month - start.month;
  if (monthDiff < 0 || monthDiff % interval !== 0) return false;
  if (rule.monthlyMode === "month-day") return date.day === start.day;
  const nth = Math.ceil(date.day / 7);
  const startNth = Math.ceil(start.day / 7);
  return dateUtc.getUTCDay() === startUtc.getUTCDay() && nth === startNth;
}

function slotFromRecurrence(rule, date) {
  return {
    id: deterministicOccurrenceId(rule.id, date),
    date,
    startTime: rule.startTime || "19:00",
    endTime: rule.endTime || "20:30",
    itemType: rule.itemType === "meeting" ? "meeting" : "talk",
    recurrenceId: rule.id,
    generatedFromRecurrence: true,
    occurrenceOverrides: [],
    isDraft: false,
    title: rule.title || "Sangha Meeting",
    description: typeof rule.description === "string" ? rule.description : "",
    usePhysicalLocation: rule.usePhysicalLocation !== false,
    useDefaultLocation: rule.useDefaultLocation !== false,
    location: rule.usePhysicalLocation === false ? "" : String(rule.location || ""),
    useZoom: Boolean(rule.useZoom),
    canceled: false,
    movedToDate: "",
    movedFromDate: "",
    speaker: null,
    backups: [],
    attendees: [],
    notifications: [],
    reminders: [],
    revision: 0,
    updatedAt: ""
  };
}

export function materializeOccurrence(store, itemId) {
  const existing = (store.slots || []).find((slot) => slot.id === itemId);
  if (existing) return existing;
  const dateMatch = /(\d{4}-\d{2}-\d{2})$/.exec(String(itemId || ""));
  if (!dateMatch) return null;
  const date = dateMatch[1];
  const rule = (store.recurrences || []).find((candidate) => (
    candidate.active !== false &&
    deterministicOccurrenceId(candidate.id, date) === itemId &&
    !(candidate.skippedDates || []).includes(date) &&
    recurrenceMatchesDate(candidate, date)
  ));
  if (!rule) return null;
  const slot = slotFromRecurrence(rule, date);
  store.slots = store.slots || [];
  store.slots.push(slot);
  store.slots.sort((a, b) => (a.date + "T" + (a.startTime || "")).localeCompare(b.date + "T" + (b.startTime || "")));
  return slot;
}

function findSlot(store, itemId, options = {}) {
  const slot = options.materialize ? materializeOccurrence(store, itemId) : (store.slots || []).find((s) => s.id === itemId);
  if (!slot) throw { status: 404, error: "item_not_found" };
  return slot;
}

function chicagoNow(nowIso) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CALENDAR_TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date(nowIso));
  const values = {};
  parts.forEach((part) => { values[part.type] = part.value; });
  return { date: values.year + "-" + values.month + "-" + values.day, time: values.hour + ":" + values.minute };
}

function subtractMonthsClamped(dateValue, months) {
  const parts = parseDate(dateValue);
  if (!parts) return "";
  const first = new Date(Date.UTC(parts.year, parts.month - 1 - months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(parts.day, lastDay));
  return dateKey(first);
}

function validateSignupDetails(body) {
  const link = typeof body.link === "string" ? body.link.trim() : "";
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  if (link.length > MAX_LINK_LENGTH) throw { status: 400, error: "invalid_link" };
  if (link) {
    let parsed;
    try { parsed = new URL(link); } catch (error) { throw { status: 400, error: "invalid_link" }; }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw { status: 400, error: "invalid_link" };
  }
  if (notes.length > MAX_NOTES_LENGTH) throw { status: 400, error: "invalid_notes" };
  if (body.reminders !== undefined && (!Array.isArray(body.reminders) || body.reminders.some((id) => !REMINDER_IDS.has(id)))) {
    throw { status: 400, error: "invalid_reminders" };
  }
}

function validateSignupSlot(store, slot, role, nowIso) {
  if (slot.isDraft || slot.canceled || slot.movedToDate) throw { status: 409, error: "item_closed" };
  if (slot.itemType !== "meeting" && slot.itemType !== "talk") throw { status: 400, error: "invalid_item_type" };
  const itemType = slot.itemType;
  if (itemType === "meeting" && role !== "attendee") throw { status: 400, error: "role_not_allowed" };
  const now = chicagoNow(nowIso);
  if (!parseDate(slot.date) || slot.date + "T" + (slot.endTime || "23:59") <= now.date + "T" + now.time) {
    throw { status: 409, error: "item_closed" };
  }
  const windowMonths = Math.max(1, Number(store.settings && store.settings.signupWindowMonths || 1));
  if (now.date < subtractMonthsClamped(slot.date, windowMonths)) throw { status: 409, error: "signup_not_open" };
}

export function addSignup(store, itemId, role, person, options = {}) {
  const slot = findSlot(store, itemId, { materialize: options.materialize !== false });
  if (options.validate === true) validateSignupSlot(store, slot, role, options.nowIso || new Date().toISOString());
  if (role === "speaker" && slot.speaker && String(slot.speaker.email || "").toLowerCase() !== person.email) {
    throw { status: 409, error: "speaker_taken" };
  }
  removeEmailFromSlot(slot, person.email);
  if (role === "speaker") {
    slot.speaker = person;
  } else if (role === "backup") {
    slot.backups = slot.backups || [];
    slot.backups.push(person);
  } else if (role === "attendee") {
    slot.attendees = slot.attendees || [];
    slot.attendees.push(person);
  } else {
    throw { status: 400, error: "bad_role" };
  }
  return slot;
}

export function removeSignup(store, itemId, email, options = {}) {
  const slot = findSlot(store, itemId, { materialize: false });
  if (options.validate === true) validateSignupSlot(store, slot, "attendee", options.nowIso || new Date().toISOString());
  removeEmailFromSlot(slot, email);
  return slot;
}

export function findSignup(store, itemId, email) {
  const slot = (store.slots || []).find((s) => s.id === itemId);
  if (!slot) return null;
  const lc = String(email || "").toLowerCase();
  if (slot.speaker && String(slot.speaker.email || "").toLowerCase() === lc) return { role: "speaker", entry: slot.speaker };
  const backup = (slot.backups || []).find((b) => String(b.email || "").toLowerCase() === lc);
  if (backup) return { role: "backup", entry: backup };
  const attendee = (slot.attendees || []).find((a) => String(a.email || "").toLowerCase() === lc);
  if (attendee) return { role: "attendee", entry: attendee };
  return null;
}

function speakerHistory(store) {
  const history = {};
  (store.slots || []).forEach((slot) => {
    if (!slot.speaker || !slot.speaker.name) return;
    const key = String(slot.speaker.name).trim().toLowerCase();
    if (!history[key] || history[key] < slot.date) history[key] = slot.date;
  });
  return history;
}

function orderedBackups(slot, store) {
  const history = speakerHistory(store);
  return (slot.backups || []).slice().sort((a, b) => {
    const aDate = history[String(a.name || "").trim().toLowerCase()] || "";
    const bDate = history[String(b.name || "").trim().toLowerCase()] || "";
    if (aDate !== bDate) return aDate.localeCompare(bDate);
    return String(a.signedUpAt || "").localeCompare(String(b.signedUpAt || ""));
  });
}

function attendanceCount(slot) {
  const seen = new Set();
  [slot.speaker].concat(slot.backups || [], slot.attendees || []).forEach((person) => {
    const key = personKey(person);
    if (key) seen.add(key);
  });
  return seen.size;
}

function projectPerson(person, viewer, fairnessRank) {
  if (!person) return null;
  const own = viewer && viewer.role === "member" && viewer.sub && String(person.email || "").toLowerCase() === String(viewer.sub).toLowerCase();
  if (own) return { ...person, ...(fairnessRank ? { fairnessRank } : {}) };
  return {
    name: publicName(person.name),
    email: "",
    link: String(person.link || ""),
    notes: String(person.notes || ""),
    reminders: [],
    signedUpAt: "",
    ...(fairnessRank ? { fairnessRank } : {})
  };
}

export function projectStore(store, viewer, revision) {
  if (!store) return null;
  const clone = JSON.parse(JSON.stringify(store));
  clone.revision = Number(revision || clone.revision || 0);
  if (viewer && viewer.role === "admin") {
    clone.slots = (clone.slots || []).map((slot) => {
      const ranks = new Map(orderedBackups(slot, store).map((person, index) => [personKey(person), index + 1]));
      return {
        ...slot,
        backups: (slot.backups || []).map((person) => ({ ...person, fairnessRank: ranks.get(personKey(person)) })),
        attendanceCount: attendanceCount(slot)
      };
    });
    return clone;
  }
  clone.history = [];
  clone.settings = {
    defaultLocation: String(clone.settings && clone.settings.defaultLocation || ""),
    signupWindowMonths: Math.max(1, Number(clone.settings && clone.settings.signupWindowMonths || 1)),
    zoomName: "",
    zoomEmail: "",
    zoomLink: String(clone.settings && clone.settings.zoomLink || "")
  };
  clone.slots = (store.slots || []).map((slot) => {
    const backups = orderedBackups(slot, store).map((person, index) => projectPerson(person, viewer, index + 1));
    const ownAttendees = (slot.attendees || []).filter((person) => viewer && viewer.role === "member" && String(person.email || "").toLowerCase() === String(viewer.sub || "").toLowerCase());
    return {
      ...JSON.parse(JSON.stringify(slot)),
      speaker: projectPerson(slot.speaker, viewer),
      backups,
      attendees: ownAttendees.map((person) => projectPerson(person, viewer)),
      notifications: [],
      reminders: [],
      attendanceCount: attendanceCount(slot)
    };
  });
  return clone;
}

export async function readState(env) {
  const row = await env.DB.prepare("SELECT store_json, revision FROM calendar_state WHERE id = 1").first();
  if (!row) return { store: null, revision: 0 };
  const store = JSON.parse(row.store_json);
  store.revision = Number(row.revision);
  return { store, revision: Number(row.revision) };
}

function canonicalStore(store, revision) {
  const clone = JSON.parse(JSON.stringify(store));
  clone.revision = Number(revision);
  return clone;
}

export async function writeState(env, store, expectedRevision, nowIso) {
  const expected = Number(expectedRevision) || 0;
  const nextRevision = expected + 1;
  const canonical = canonicalStore(store, nextRevision);
  const json = JSON.stringify(canonical);
  if (expected === 0) {
    const result = await env.DB
      .prepare("INSERT INTO calendar_state (id, store_json, revision, updated_at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO NOTHING")
      .bind(json, nextRevision, nowIso).run();
    if (result.meta.changes === 1) return { revision: nextRevision, store: canonical };
    return { conflict: true, current: await readState(env) };
  }
  const result = await env.DB
    .prepare("UPDATE calendar_state SET store_json = ?, revision = ?, updated_at = ? WHERE id = 1 AND revision = ?")
    .bind(json, nextRevision, nowIso, expected).run();
  if (result.meta.changes === 0) return { conflict: true, current: await readState(env) };
  return { revision: nextRevision, store: canonical };
}

async function mutateState(env, mutator, options = {}) {
  const maxAttempts = options.maxAttempts || 4;
  const nowIso = options.nowIso || new Date().toISOString();
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { store, revision } = await readState(env);
    if (!store) throw { status: 404, error: "calendar_not_initialized" };
    mutator(store, nowIso);
    const write = await writeState(env, store, revision, nowIso);
    if (!write.conflict) return { revision: write.revision, store: write.store };
  }
  throw { status: 409, error: "write_conflict" };
}

async function readJsonBody(request, maxBytes) {
  try {
    const text = await request.text();
    if (text.length > maxBytes) return { tooLarge: true };
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

function validStoreShape(store) {
  if (!store || typeof store !== "object") return false;
  if (!Array.isArray(store.slots) || !Array.isArray(store.recurrences) || !Array.isArray(store.history)) return false;
  if (!store.settings || typeof store.settings !== "object") return false;
  const ids = new Set();
  for (const slot of store.slots) {
    if (!slot || typeof slot.id !== "string" || !slot.id || ids.has(slot.id)) return false;
    ids.add(slot.id);
  }
  return true;
}

async function optionalViewer(request, env) {
  const identity = await authenticate(request, env);
  if (!identity) return null;
  const role = await resolveRole(env, identity.sub);
  return { sub: identity.sub, name: identity.name, role };
}

export async function handleGetCalendar(request, env) {
  const { store, revision } = await readState(env);
  const viewer = await optionalViewer(request, env);
  return jsonResponse(env, { store: projectStore(store, viewer, revision), revision });
}

export async function handlePutCalendar(request, env) {
  const body = await readJsonBody(request, MAX_ADMIN_BODY_BYTES);
  if (body && body.tooLarge) return jsonResponse(env, { error: "request_too_large" }, 413);
  if (!body || !validStoreShape(body.store)) return jsonResponse(env, { error: "invalid_store" }, 400);
  const write = await writeState(env, body.store, Number(body.revision || 0), new Date().toISOString());
  if (write.conflict) {
    return jsonResponse(env, {
      error: "revision_conflict",
      store: projectStore(write.current.store, request.user, write.current.revision),
      revision: write.current.revision
    }, 409);
  }
  return jsonResponse(env, { store: projectStore(write.store, request.user, write.revision), revision: write.revision });
}

export async function handlePostSignup(request, env, options = {}) {
  const body = await readJsonBody(request, MAX_SIGNUP_BODY_BYTES);
  if (body && body.tooLarge) return jsonResponse(env, { error: "request_too_large" }, 413);
  if (!body || typeof body.itemId !== "string" || body.itemId.length > 200 || !["speaker", "backup", "attendee"].includes(body.role)) {
    return jsonResponse(env, { error: "bad_request" }, 400);
  }
  const nowIso = options.nowIso || new Date().toISOString();
  try {
    validateSignupDetails(body);
    const person = makeServerVolunteer(request.user.name, request.user.sub, body, nowIso);
    const { revision, store } = await mutateState(env, (current) => addSignup(current, body.itemId, body.role, person, { nowIso, validate: true }), { nowIso });
    return jsonResponse(env, { revision, store: projectStore(store, request.user, revision) });
  } catch (error) {
    if (error && error.status) return jsonResponse(env, { error: error.error }, error.status);
    throw error;
  }
}

export async function handleDeleteSignup(request, env, options = {}) {
  const body = await readJsonBody(request, MAX_SIGNUP_BODY_BYTES);
  if (!body || typeof body.itemId !== "string") return jsonResponse(env, { error: "bad_request" }, 400);
  const nowIso = options.nowIso || new Date().toISOString();
  try {
    const { revision, store } = await mutateState(env, (current) => removeSignup(current, body.itemId, request.user.sub, { nowIso, validate: true }), { nowIso });
    return jsonResponse(env, { revision, store: projectStore(store, request.user, revision) });
  } catch (error) {
    if (error && error.status) return jsonResponse(env, { error: error.error }, error.status);
    throw error;
  }
}

export async function handleGetSignup(request, env) {
  const itemId = new URL(request.url).searchParams.get("itemId");
  if (!itemId) return jsonResponse(env, { error: "bad_request" }, 400);
  const { store } = await readState(env);
  if (!store) return jsonResponse(env, { signup: null });
  return jsonResponse(env, { signup: findSignup(store, itemId, request.user.sub) });
}
