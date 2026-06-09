import { describe, it, expect } from "vitest";
import { makeServerVolunteer, addSignup, removeSignup, findSignup } from "../src/calendar.js";

function storeWith(slot) {
  return { revision: 1, slots: [slot], recurrences: [], settings: {}, history: [] };
}

describe("signup helpers", () => {
  it("makeServerVolunteer trusts only the caller identity + safe fields", () => {
    const v = makeServerVolunteer("Mara R", "Mara@Example.com", { link: "x", notes: "n", reminders: ["one-day", 5] }, "2026-06-01T00:00:00Z");
    expect(v).toEqual({ name: "Mara R", email: "mara@example.com", link: "x", notes: "n", reminders: ["one-day"], signedUpAt: "2026-06-01T00:00:00Z" });
  });

  it("addSignup as attendee appends the caller", () => {
    const store = storeWith({ id: "s1", itemType: "meeting", attendees: [], backups: [], speaker: null });
    const person = makeServerVolunteer("A", "a@x.com", {}, "t");
    addSignup(store, "s1", "attendee", person);
    expect(store.slots[0].attendees.map((p) => p.email)).toEqual(["a@x.com"]);
  });

  it("addSignup as speaker claims an open slot and removes prior duplicate attendance", () => {
    const store = storeWith({ id: "s1", attendees: [{ name: "A", email: "a@x.com" }], backups: [], speaker: null });
    addSignup(store, "s1", "speaker", makeServerVolunteer("A", "a@x.com", {}, "t"));
    expect(store.slots[0].speaker.email).toBe("a@x.com");
    expect(store.slots[0].attendees).toEqual([]);
  });

  it("addSignup as speaker rejects when another person holds the slot", () => {
    const store = storeWith({ id: "s1", attendees: [], backups: [], speaker: { name: "B", email: "b@x.com" } });
    expect(() => addSignup(store, "s1", "speaker", makeServerVolunteer("A", "a@x.com", {}, "t")))
      .toThrowError(expect.objectContaining({ status: 409, error: "speaker_taken" }));
  });

  it("addSignup throws 404 for an unknown item", () => {
    const store = storeWith({ id: "s1", attendees: [], backups: [], speaker: null });
    expect(() => addSignup(store, "missing", "attendee", makeServerVolunteer("A", "a@x.com", {}, "t")))
      .toThrowError(expect.objectContaining({ status: 404 }));
  });

  it("removeSignup removes the caller from every role", () => {
    const store = storeWith({ id: "s1", attendees: [], backups: [{ name: "A", email: "a@x.com" }], speaker: null });
    removeSignup(store, "s1", "a@x.com");
    expect(store.slots[0].backups).toEqual([]);
  });

  it("findSignup reports the caller's current role", () => {
    const store = storeWith({ id: "s1", attendees: [{ name: "A", email: "a@x.com" }], backups: [], speaker: null });
    expect(findSignup(store, "s1", "a@x.com")).toEqual({ role: "attendee", entry: { name: "A", email: "a@x.com" } });
    expect(findSignup(store, "s1", "nobody@x.com")).toBeNull();
  });
});
