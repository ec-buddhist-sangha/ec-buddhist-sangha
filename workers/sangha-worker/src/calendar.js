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

export async function readState(env) {
  const row = await env.DB.prepare("SELECT store_json, revision FROM calendar_state WHERE id = 1").first();
  if (!row) return { store: null, revision: 0 };
  return { store: JSON.parse(row.store_json), revision: Number(row.revision) };
}

export async function writeState(env, store, expectedRevision, nowIso) {
  const expected = Number(expectedRevision) || 0;
  const nextRevision = expected + 1;
  const json = JSON.stringify(store);
  if (expected === 0) {
    const result = await env.DB
      .prepare("INSERT INTO calendar_state (id, store_json, revision, updated_at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO NOTHING")
      .bind(json, nextRevision, nowIso).run();
    if (result.meta.changes === 1) return { revision: nextRevision };
    return { conflict: true, current: await readState(env) };
  }
  const result = await env.DB
    .prepare("UPDATE calendar_state SET store_json = ?, revision = ?, updated_at = ? WHERE id = 1 AND revision = ?")
    .bind(json, nextRevision, nowIso, expected).run();
  if (result.meta.changes === 0) return { conflict: true, current: await readState(env) };
  return { revision: nextRevision };
}

// Read-modify-write with bounded retry on optimistic-lock conflict.
async function mutateState(env, mutator, options = {}) {
  const maxAttempts = options.maxAttempts || 4;
  const nowIso = options.nowIso || new Date().toISOString();
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { store, revision } = await readState(env);
    if (!store) throw { status: 404, error: "calendar_not_initialized" };
    mutator(store);
    const write = await writeState(env, store, revision, nowIso);
    if (!write.conflict) return { revision: write.revision, store };
  }
  throw { status: 409, error: "write_conflict" };
}

async function readJsonBody(request) {
  try {
    return await request.json();
  } catch (error) {
    return null;
  }
}

export async function handleGetCalendar(request, env) {
  const { store, revision } = await readState(env);
  return jsonResponse(env, { store, revision });
}

export async function handlePutCalendar(request, env) {
  const body = await readJsonBody(request);
  if (!body || typeof body.store !== "object" || body.store === null) {
    return jsonResponse(env, { error: "missing_store" }, 400);
  }
  const write = await writeState(env, body.store, Number(body.revision || 0), new Date().toISOString());
  if (write.conflict) {
    return jsonResponse(env, { error: "revision_conflict", store: write.current.store, revision: write.current.revision }, 409);
  }
  return jsonResponse(env, { revision: write.revision });
}

export async function handlePostSignup(request, env) {
  const body = await readJsonBody(request);
  if (!body || !body.itemId || !["speaker", "backup", "attendee"].includes(body.role)) {
    return jsonResponse(env, { error: "bad_request" }, 400);
  }
  const nowIso = new Date().toISOString();
  const person = makeServerVolunteer(request.user.name, request.user.sub, body, nowIso);
  try {
    const { revision, store } = await mutateState(env, (store) => addSignup(store, body.itemId, body.role, person), { nowIso });
    return jsonResponse(env, { revision, store });
  } catch (error) {
    if (error && error.status) return jsonResponse(env, { error: error.error }, error.status);
    throw error;
  }
}

export async function handleDeleteSignup(request, env) {
  const body = await readJsonBody(request);
  if (!body || !body.itemId) return jsonResponse(env, { error: "bad_request" }, 400);
  const email = request.user.sub;
  try {
    const { revision, store } = await mutateState(env, (store) => removeSignup(store, body.itemId, email));
    return jsonResponse(env, { revision, store });
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
