import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";

describe("calendar initialization migration", () => {
  it("seeds a clean weekly Tuesday calendar", async () => {
    const row = await env.DB.prepare("SELECT store_json, revision FROM calendar_state WHERE id = 1").first();
    const store = JSON.parse(row.store_json);
    expect(Number(row.revision)).toBe(1);
    expect(store.slots).toEqual([]);
    expect(store.history).toEqual([]);
    expect(store.recurrences).toHaveLength(1);
    expect(store.recurrences[0]).toMatchObject({
      id: "default-weekly-tuesday-talks",
      itemType: "talk",
      frequency: "weekly",
      startDate: "2026-07-21",
      startTime: "19:00",
      endTime: "20:30",
      title: "Sangha Meeting"
    });
  });
});
