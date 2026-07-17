const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function load() {
  const metas = {
    'meta[name="ecbs:worker-base"]': { getAttribute: () => "https://worker.test" },
    'meta[name="ecbs:site-base"]': { getAttribute: () => "/" }
  };
  const context = {
    URLSearchParams, console, JSON, Math, Date, Object, Array, String, Number,
    window: { fetch: undefined },
    document: { readyState: "complete", addEventListener: () => {}, getElementById: () => null, querySelector: (sel) => metas[sel] || null }
  };
  context.window.window = context.window;
  vm.createContext(context);
  const p = path.join(__dirname, "..", "static", "js", "next-gathering.js");
  vm.runInContext(fs.readFileSync(p, "utf8"), context, { filename: p });
  return context.window.ECBS.NextGathering;
}

// Weekly recurrence starting Tue 2026-07-21, 7:00-8:30 PM.
const weekly = {
  id: "r1", active: true, frequency: "weekly", interval: 1,
  startDate: "2026-07-21", startTime: "19:00", endTime: "20:30",
  title: "Sangha Meeting", location: "Unity of Eau Claire\n1808 Folsom Street", skippedDates: []
};

test("weekly recurrence: next occurrence on/after today", () => {
  const NG = load();
  assert.equal(NG.nextGathering({ recurrences: [weekly], slots: [] }, "2026-07-17").date, "2026-07-21", "Friday before -> that Tuesday");
  assert.equal(NG.nextGathering({ recurrences: [weekly], slots: [] }, "2026-07-21").date, "2026-07-21", "the day itself counts");
  assert.equal(NG.nextGathering({ recurrences: [weekly], slots: [] }, "2026-07-22").date, "2026-07-28", "day after -> next week");
});

test("skippedDates are excluded", () => {
  const NG = load();
  const skip = Object.assign({}, weekly, { skippedDates: ["2026-07-21"] });
  assert.equal(NG.nextGathering({ recurrences: [skip], slots: [] }, "2026-07-17").date, "2026-07-28");
});

test("explicit slot earlier than the recurrence wins", () => {
  const NG = load();
  const g = NG.nextGathering({
    recurrences: [weekly],
    slots: [{ date: "2026-07-19", startTime: "10:00", title: "Half-day Retreat", location: "Hall" }]
  }, "2026-07-17");
  assert.equal(g.date, "2026-07-19");
  assert.equal(g.title, "Half-day Retreat");
});

test("an explicit slot for a recurrence date is not double-counted", () => {
  const NG = load();
  const g = NG.nextGathering({
    recurrences: [weekly],
    slots: [{ date: "2026-07-21", recurrenceId: "r1", startTime: "19:00", title: "Sangha Meeting (guest speaker)" }]
  }, "2026-07-17");
  assert.equal(g.date, "2026-07-21");
  assert.equal(g.title, "Sangha Meeting (guest speaker)", "the concrete slot, not the recurrence, is shown");
});

test("inactive recurrence with no slots yields nothing", () => {
  const NG = load();
  assert.equal(NG.nextGathering({ recurrences: [Object.assign({}, weekly, { active: false })], slots: [] }, "2026-07-17"), null);
  assert.equal(NG.nextGathering({ recurrences: [], slots: [] }, "2026-07-17"), null);
  assert.equal(NG.nextGathering(null, "2026-07-17"), null);
});

test("cardHtml escapes title and location (no HTML injection)", () => {
  const NG = load();
  const html = NG.cardHtml({ date: "2026-07-21", startTime: "19:00", endTime: "20:30", title: "<script>x</script>", location: "<b>Hall</b>\nStreet" });
  assert.ok(!html.includes("<script>x") && !html.includes("<b>Hall</b>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("Next Gathering") && html.includes("See full calendar"));
});
