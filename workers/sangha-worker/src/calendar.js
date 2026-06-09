// workers/sangha-worker/src/calendar.js
// D1-backed calendar store (single JSON document, optimistic locking) plus
// server-authoritative member signup mutations. The helpers below are pure and
// only ever touch the caller's own entry (matched by email).
import { jsonResponse } from "./middleware.js";

export function makeServerVolunteer(name, email, body, nowIso) {
  const lcEmail = String(email || "").toLowerCase();
  return {
    name: name || lcEmail,
    email: lcEmail,
    link: typeof body.link === "string" ? body.link : "",
    notes: typeof body.notes === "string" ? body.notes : "",
    reminders: Array.isArray(body.reminders) ? body.reminders.filter((r) => typeof r === "string") : [],
    signedUpAt: nowIso
  };
}

function removeEmailFromSlot(slot, email) {
  const lc = String(email || "").toLowerCase();
  if (slot.speaker && String(slot.speaker.email || "").toLowerCase() === lc) slot.speaker = null;
  slot.backups = (slot.backups || []).filter((b) => String(b.email || "").toLowerCase() !== lc);
  slot.attendees = (slot.attendees || []).filter((a) => String(a.email || "").toLowerCase() !== lc);
}

function findSlot(store, itemId) {
  const slot = (store.slots || []).find((s) => s.id === itemId);
  if (!slot) throw { status: 404, error: "item_not_found" };
  return slot;
}

export function addSignup(store, itemId, role, person) {
  const slot = findSlot(store, itemId);
  removeEmailFromSlot(slot, person.email); // de-dupe the caller across all roles first
  if (role === "speaker") {
    if (slot.speaker && String(slot.speaker.email || "").toLowerCase() !== person.email) {
      throw { status: 409, error: "speaker_taken" };
    }
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

export function removeSignup(store, itemId, email) {
  const slot = findSlot(store, itemId);
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
