// Unit tests for web/core.js — pure logic, no browser, no network.
process.env.TZ = "America/Los_Angeles";
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../../web/core.js");
const DB = require("../../web/plants_database.json");

const prof = (id) => DB.plants.find((p) => p.id === id);
const POTHOS = prof("epipremnum-aureum");
const SNAKE = prof("dracaena-trifasciata");
const JULY = new Date(2026, 6, 15, 10, 0).getTime();   // growing season
const DEC = new Date(2026, 11, 15, 10, 0).getTime();   // dormant season

function plant(extra = {}) {
  return { id: "p1", nickname: "Test", speciesId: POTHOS.id, potDiameterCm: 15, potMaterial: "plastic",
           schedules: C.newSchedules(POTHOS, JULY), ...extra };
}

test("esc() neutralises every HTML-significant character", () => {
  assert.equal(C.esc(`<img src=x onerror="a('b')">&\``), "&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;&#96;");
  assert.equal(C.esc(null), "");
  assert.equal(C.esc(undefined), "");
  assert.equal(C.esc(42), "42");
});

test("dates: startOfDay, addDays and daysUntil", () => {
  const t = new Date(2026, 6, 15, 23, 59).getTime();
  assert.equal(C.startOfDay(t), new Date(2026, 6, 15).getTime());
  assert.equal(C.addDays(t, 1), new Date(2026, 6, 16).getTime());
  assert.equal(C.daysUntil(C.addDays(t, 5), t), 5);
  assert.equal(C.daysUntil(C.addDays(t, -3), t), -3);
});

test("dates: addDays stays on local midnight across daylight-saving changes", () => {
  const beforeSpring = new Date(2026, 2, 7, 12).getTime();  // DST starts Mar 8
  const beforeFall = new Date(2026, 9, 31, 12).getTime();   // DST ends Nov 1
  for (const t of [beforeSpring, beforeFall]) {
    const next = new Date(C.addDays(t, 2));
    assert.equal(next.getHours(), 0);
    assert.equal(C.daysUntil(next.getTime(), t), 2);
  }
});

test("isDormant() covers Nov–Feb only", () => {
  const months = [...Array(12).keys()].map((m) => C.isDormant(new Date(2026, m, 10).getTime()));
  assert.deepEqual(months, [true, true, false, false, false, false, false, false, false, false, true, true]);
});

test("newSchedules() without a profile: water on and due today, long tasks in the future", () => {
  const s = C.newSchedules(null, JULY);
  assert.deepEqual(Object.keys(s).sort(), [...C.CARE_KINDS].sort());
  assert.equal(s.water.on, true);
  assert.equal(s.water.next, C.startOfDay(JULY));
  for (const k of ["repot", "prune", "rotate"]) assert.ok(s[k].next > C.startOfDay(JULY), `${k} should start in the future`);
});

test("newSchedules() with a profile copies the species' care rhythm", () => {
  const s = C.newSchedules(POTHOS, JULY);
  assert.equal(s.water.every, POTHOS.water.intervalDaysGrowing);
  assert.equal(s.water.winterEvery, POTHOS.water.intervalDaysDormant);
  assert.equal(s.fertilize.on, true);
  assert.equal(s.fertilize.every, POTHOS.fertilizer.intervalDaysGrowing);
  assert.equal(s.mist.on, POTHOS.humidity.misting);
  assert.equal(s.prune.on, POTHOS.pruning.needed);
  assert.ok(s.repot.next > C.addDays(JULY, 300));
});

test("interval() switches to the winter interval in dormant months", () => {
  const s = C.newSchedules(SNAKE, JULY).water;
  assert.equal(C.interval(s, JULY), SNAKE.water.intervalDaysGrowing);
  assert.equal(C.interval(s, DEC), SNAKE.water.intervalDaysDormant);
  assert.equal(C.interval({ every: 5, winterEvery: null }, DEC), 5);
});

test("markDone() moves the next due date and does not mutate its input", () => {
  const s = C.newSchedules(POTHOS, JULY).water;
  const copy = JSON.parse(JSON.stringify(s));
  const done = C.markDone(s, JULY);
  assert.deepEqual(s, copy);
  assert.equal(done.last, JULY);
  assert.equal(done.next, C.addDays(JULY, POTHOS.water.intervalDaysGrowing));
  assert.equal(C.markDone(s, DEC).next, C.addDays(DEC, POTHOS.water.intervalDaysDormant));
});

test("status(): late beats due beats ok", () => {
  const p = plant();
  const today = C.startOfDay(JULY);
  for (const k of C.CARE_KINDS) p.schedules[k].next = C.addDays(JULY, 30);
  assert.deepEqual(C.status(p, POTHOS, JULY), { level: "ok", kind: null });
  p.schedules.water.next = today;
  assert.deepEqual(C.status(p, POTHOS, JULY), { level: "due", kind: "water" });
  p.schedules.fertilize.next = C.addDays(JULY, -2);
  assert.deepEqual(C.status(p, POTHOS, JULY), { level: "late", kind: "fertilize" });
});

test("status(): switched-off tasks never count", () => {
  const p = plant();
  for (const k of C.CARE_KINDS) { p.schedules[k].on = false; p.schedules[k].next = C.addDays(JULY, -10); }
  assert.equal(C.status(p, POTHOS, JULY).level, "ok");
});

test("status(): fertilizing is paused in the species' rest months", () => {
  const p = plant({ schedules: C.newSchedules(POTHOS, DEC) });
  for (const k of C.CARE_KINDS) p.schedules[k].next = C.addDays(DEC, 30);
  p.schedules.fertilize.next = C.addDays(DEC, -5);
  assert.ok(POTHOS.fertilizer.pauseMonths.includes(12));
  assert.equal(C.status(p, POTHOS, DEC).level, "ok");
  assert.equal(C.activeSchedules(p, POTHOS, DEC).some((s) => s.kind === "fertilize"), false);
});

test("waterML(): needs a pot size or a custom amount", () => {
  assert.equal(C.waterML(plant({ potDiameterCm: "" }), POTHOS, JULY), null);
  assert.equal(C.waterML(plant({ potDiameterCm: 0 }), POTHOS, JULY), null);
  assert.deepEqual(C.waterML(plant({ potDiameterCm: "", waterOverrideMl: 333 }), POTHOS, JULY), { ml: 333, source: "custom" });
});

test("waterML(): known values for a 15 cm plastic pothos pot", () => {
  assert.deepEqual(C.waterML(plant(), POTHOS, JULY), { ml: 500, source: "growing" });
  assert.deepEqual(C.waterML(plant(), POTHOS, DEC), { ml: 400, source: "winter" });
});

test("waterML(): terracotta needs more, bigger pots need more, always a multiple of 25 and at least 25", () => {
  const plastic = C.waterML(plant(), POTHOS, JULY).ml;
  const terracotta = C.waterML(plant({ potMaterial: "terracotta" }), POTHOS, JULY).ml;
  const big = C.waterML(plant({ potDiameterCm: 30 }), POTHOS, JULY).ml;
  assert.ok(terracotta > plastic);
  assert.ok(big > plastic * 4);
  for (const d of [1, 3, 7.5, 12, 18, 25, 40]) {
    const { ml } = C.waterML(plant({ potDiameterCm: d }), POTHOS, JULY);
    assert.equal(ml % 25, 0);
    assert.ok(ml >= 25);
  }
  // A dry-loving snake plant gets less than a pothos in the same pot.
  assert.ok(C.waterML(plant({ speciesId: SNAKE.id }), SNAKE, JULY).ml < plastic);
});

test("dataURLToBytes() decodes base64 without using the network", () => {
  const bytes = C.dataURLToBytes("data:image/jpeg;base64," + Buffer.from([255, 216, 255, 0, 1]).toString("base64"));
  assert.deepEqual([...bytes], [255, 216, 255, 0, 1]);
});

/* ---------- Backup validation: a restored file is treated as hostile ---------- */
const GOOD_PHOTO = "data:image/jpeg;base64,/9j/AA==";
function backup(extra = {}) {
  return {
    app: "botanica", version: 1,
    plants: [{ id: "abc-1", nickname: "Pothy", speciesId: POTHOS.id, light: "indirect", potDiameterCm: 15,
               potMaterial: "plastic", photoId: "ph-1", schedules: C.newSchedules(POTHOS, JULY) }],
    events: [{ id: "ev-1", plantId: "abc-1", type: "care", kind: "water", at: JULY, amountMl: 400 }],
    photos: [{ id: "ph-1", full: GOOD_PHOTO, thumb: GOOD_PHOTO }],
    ...extra
  };
}

test("validateBackup(): accepts a well-formed backup", () => {
  const out = C.validateBackup(backup(), JULY);
  assert.equal(out.plants.length, 1);
  assert.equal(out.plants[0].nickname, "Pothy");
  assert.equal(out.plants[0].photoId, "ph-1");
  assert.equal(out.events.length, 1);
  assert.equal(out.photos.length, 1);
});

test("validateBackup(): rejects files that aren't Botanica backups", () => {
  for (const bad of [null, 1, "x", [], {}, { app: "other" }]) {
    assert.throws(() => C.validateBackup(bad), /isn't a Botanica backup/);
  }
});

test("validateBackup(): drops unsafe ids, photos and orphan events", () => {
  const out = C.validateBackup(backup({
    plants: [
      { id: "../../etc", nickname: "bad id" },
      { id: "<img src=x>", nickname: "bad id 2" },
      { id: "ok-1", nickname: "fine", photoId: "missing-photo" }
    ],
    events: [
      { id: "e1", plantId: "nobody", type: "care", kind: "water", at: JULY },
      { id: "e2", plantId: "ok-1", type: "care", kind: "self-destruct", at: JULY },
      { id: "e3", plantId: "ok-1", type: "script", at: JULY },
      { id: "e4", plantId: "ok-1", type: "journal", at: JULY, text: "hello", photoId: "evil" }
    ],
    photos: [
      { id: "evil", full: "data:text/html;base64,PHNjcmlwdD4=", thumb: GOOD_PHOTO },
      { id: "js", full: "javascript:alert(1)", thumb: "javascript:alert(1)" }
    ]
  }), JULY);
  assert.deepEqual(out.plants.map((p) => p.id), ["ok-1"]);
  assert.equal(out.plants[0].photoId, null);
  assert.deepEqual(out.events.map((e) => e.id), ["e4"]);
  assert.equal(out.events[0].photoId, null);
  assert.equal(out.photos.length, 0);
});

test("validateBackup(): clamps and normalises every field", () => {
  const long = "x".repeat(50000);
  const out = C.validateBackup(backup({
    plants: [{ id: "p-1", nickname: long, room: long, notes: long, light: "laser", potMaterial: "gold",
               potDiameterCm: -5, waterOverrideMl: 1e9, speciesId: "<script>", acquired: "yesterday",
               schedules: { water: { on: "yes", every: 1e6, next: "soon" }, __proto__: { polluted: true } } }],
    events: [], photos: []
  }), JULY);
  const p = out.plants[0];
  assert.equal(p.nickname.length, 80);
  assert.equal(p.room.length, 60);
  assert.ok(p.notes.length <= 4000);
  assert.equal(p.light, "indirect");
  assert.equal(p.potMaterial, "other");
  assert.equal(p.potDiameterCm, "");
  assert.equal(p.waterOverrideMl, "");
  assert.equal(p.speciesId, "");
  assert.equal(p.acquired, "");
  assert.equal(p.schedules.water.on, false);
  assert.equal(p.schedules.water.every, C.DEFAULT_INTERVAL.water);
  assert.equal(typeof p.schedules.water.next, "number");
  assert.equal({}.polluted, undefined);
  assert.deepEqual(Object.keys(p.schedules).sort(), [...C.CARE_KINDS].sort());
});

test("validateBackup(): refuses absurdly large backups", () => {
  const plants = Array.from({ length: 501 }, (_, i) => ({ id: "p" + i, nickname: "n" }));
  assert.throws(() => C.validateBackup(backup({ plants })), /too many plants/);
});

/* ---- Undo / delete of care entries ---- */
test("undoing an accidental watering restores the exact schedule from its snapshot", () => {
  const before = { on: true, every: 7, winterEvery: 14, last: JULY - 5 * 86400000, next: C.addDays(JULY, 2) };
  const after = C.markDone(before, JULY);
  const ev = { id: "e1", type: "care", kind: "water", at: JULY, prevLast: before.last, prevNext: before.next };
  assert.deepEqual(C.undoCare(after, ev, []), before);
});

test("undo without a snapshot falls back to the latest remaining entry, or to today", () => {
  const sch = C.markDone({ on: true, every: 7, winterEvery: null, last: null, next: JULY }, JULY);
  const ev = { id: "e2", type: "care", kind: "water", at: JULY };
  const older = { id: "e0", type: "care", kind: "water", at: JULY - 3 * 86400000 };
  const r = C.undoCare(sch, ev, [older, { id: "x", type: "care", kind: "fertilize", at: JULY - 86400000 }]);
  assert.equal(r.last, older.at);
  assert.equal(r.next, C.addDays(older.at, 7));
  const none = C.undoCare(sch, ev, [], JULY);
  assert.equal(none.last, null);
  assert.equal(none.next, C.startOfDay(JULY));
});

test("deleting an older entry or a journal note leaves the schedule alone", () => {
  const sch = { on: true, every: 7, winterEvery: null, last: JULY, next: C.addDays(JULY, 7) };
  assert.equal(C.undoCare(sch, { id: "a", type: "care", kind: "water", at: JULY - 86400000 }, []), sch);
  assert.equal(C.undoCare(sch, { id: "b", type: "journal", at: JULY }, []), sch);
});

test("backups keep the undo snapshot on care events, cleaned", () => {
  const out = C.validateBackup({ app: "botanica", plants: [{ id: "p1", nickname: "P", schedules: {} }],
    events: [{ id: "e1", plantId: "p1", type: "care", kind: "water", at: JULY, prevLast: "<b>", prevNext: JULY - 1 }] }, JULY);
  assert.equal(out.events[0].prevLast, null);
  assert.equal(out.events[0].prevNext, JULY - 1);
});

/* ---- Fertilizer rest and care tiles ---- */
test("fertilizing resumes on the first day after the pause months", () => {
  const p = { fertilizer: { pauseMonths: [11, 12, 1, 2] } };
  assert.equal(C.fertilizeResumes(p, new Date(2026, 10, 15).getTime()), new Date(2027, 2, 1).getTime());
  assert.equal(C.fertilizeResumes(p, JULY), null);
  assert.equal(C.fertilizeResumes(null, DEC), null);
  const lav = { fertilizer: { pauseMonths: [9, 10, 11, 12, 1, 2] } };
  assert.equal(C.fertilizeResumes(lav, new Date(2026, 8, 3).getTime()), new Date(2027, 2, 1).getTime());
});

test("care items list due and upcoming care, most urgent first, skipping resting feeds", () => {
  const plant = { schedules: C.newSchedules(POTHOS, DEC) };
  plant.schedules.water.next = C.addDays(DEC, -2);
  const items = C.careItems(plant, POTHOS, DEC);
  assert.equal(items[0].kind, "water");
  assert.equal(items[0].days, -2);
  assert.ok(!items.some((i) => i.kind === "fertilize"), "fertilizing rests in December");
});

test("every care profile offers fertilizer options, homemade listed separately", () => {
  for (const p of DB.plants) {
    assert.ok(Array.isArray(p.fertilizer.homemade) && Array.isArray(p.fertilizer.storeBought), p.id);
    assert.ok(p.fertilizer.homemade.length + p.fertilizer.storeBought.length > 0, p.id);
  }
});

test("hostile fertilizer options are trimmed", () => {
  const bad = { ...POTHOS, fertilizer: { ...POTHOS.fertilizer,
    homemade: [{ name: "x".repeat(500), how: "ok" }, { name: "no how" }, "str", null, ...Array(10).fill({ name: "n", how: "h", evil: 1 })] } };
  const c = C.cleanProfile(bad);
  assert.ok(c.fertilizer.homemade.length <= 6);
  assert.equal(c.fertilizer.homemade[0].name.length, 80);
  assert.ok(c.fertilizer.homemade.every((x) => x.name && x.how && !("evil" in x)));
});

test("the app's version label matches the service worker cache version", () => {
  const fs = require("node:fs"), path = require("node:path");
  const app = fs.readFileSync(path.join(__dirname, "../../web/app.js"), "utf8");
  const sw = fs.readFileSync(path.join(__dirname, "../../web/sw.js"), "utf8");
  // The cache name is "botanica-" + a content hash enforced by hardening.test.js; Settings reads it at runtime.
  assert.match(sw, /const VERSION = "botanica-" \+ BUILD;/);
  assert.match(app, /caches\.keys\(\)\)\.find\(\(k\) => k\.startsWith\("botanica-"\)\)/);
  assert.match(sw, /self\.skipWaiting\(\)/, "new versions must take over without waiting for every tab to close");
});
