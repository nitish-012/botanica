// Regression tests from the independent review: untrusted-input typing, calendar-day status,
// toxicity floor for private profiles, service-worker build stamp, and history hygiene.
process.env.TZ = "America/Los_Angeles";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const C = require("../../web/core.js");
const DB = require("../../web/plants_database.json");
const stamp = require("../helpers/stamp.js");

const ROOT = path.join(__dirname, "../..");
const POTHOS = DB.plants.find((p) => p.id === "epipremnum-aureum");
const JPEG = "data:image/jpeg;base64,/9j/AA==";
const backup = (extra) => C.validateBackup({ app: "botanica", ...extra });

test("validateBackup(): ids must be real strings (arrays and numbers are not coerced)", () => {
  const out = backup({
    plants: [{ id: ["ghost-1"], nickname: "array id" }, { id: 777, nickname: "number id" }, { id: "ok-1", speciesId: ["epipremnum-aureum"], acquired: ["2024-01-01"] }],
    events: [{ id: ["e"], plantId: "ok-1", type: "journal", text: "x" }, { id: 5, plantId: "ok-1", type: "journal", text: "y" }],
    photos: [{ id: ["ph"], full: JPEG, thumb: JPEG }, { id: "ph-2", full: [JPEG], thumb: JPEG }]
  });
  assert.deepEqual(out.plants.map((p) => p.id), ["ok-1"]);
  assert.equal(out.plants[0].speciesId, "");
  assert.equal(out.plants[0].acquired, "");
  assert.deepEqual(out.events, []);
  assert.deepEqual(out.photos, []);
  for (const p of out.plants) for (const [k, v] of Object.entries(p)) {
    if (k !== "schedules") assert.ok(v === null || ["string", "number", "boolean"].includes(typeof v), `${k} must be a primitive`);
  }
});

test("status(): 'due today' is decided by calendar day, not by an exact midnight timestamp", () => {
  const now = new Date(2026, 6, 15, 10).getTime();
  const plant = (next) => ({ schedules: { water: { on: true, every: 7, next } } });
  assert.equal(C.status(plant(new Date(2026, 6, 15, 12).getTime()), null, now).level, "due", "noon today");
  assert.equal(C.status(plant(new Date(2026, 6, 15, 23, 59).getTime()), null, now).level, "due", "late tonight");
  assert.equal(C.status(plant(new Date(2026, 6, 14, 23, 59).getTime()), null, now).level, "late", "yesterday");
  assert.equal(C.status(plant(new Date(2026, 6, 16, 0, 0).getTime()), null, now).level, "ok", "tomorrow");
});

test("status(): a due date saved in Pacific time is still 'due' after flying east", () => {
  const savedPT = Date.parse("2026-07-15T07:00:00Z"); // local midnight in Los Angeles
  process.env.TZ = "America/New_York";
  try {
    assert.equal(C.status({ schedules: { water: { on: true, every: 7, next: savedPT } } }, null, Date.parse("2026-07-15T14:00:00Z")).level, "due");
  } finally { process.env.TZ = "America/Los_Angeles"; }
});

test("status(): one day overdue is 'late' (kills the off-by-one mutant)", () => {
  const now = new Date(2026, 6, 15, 10).getTime();
  assert.equal(C.status({ schedules: { water: { on: true, every: 7, next: C.addDays(now, -1) } } }, null, now).level, "late");
});

test("mergeProfiles(): a private profile can replace a public one but never lower its toxicity", () => {
  const safeLooking = { ...POTHOS, summary: "mine", toxicity: { children: "none", pets: "none", compound: "", notes: "" } };
  const merged = C.mergeProfiles(DB.plants, [safeLooking]);
  const p = merged.find((x) => x.id === POTHOS.id);
  assert.equal(merged.length, DB.plants.length, "no duplicates");
  assert.equal(p.summary, "mine", "private text wins");
  assert.equal(p.toxicity.children, POTHOS.toxicity.children);
  assert.equal(p.toxicity.pets, POTHOS.toxicity.pets);
  assert.match(p.toxicity.notes, /Poison Control/);
  // Raising toxicity, and brand-new species, pass through untouched.
  const stricter = { ...POTHOS, toxicity: { ...POTHOS.toxicity, children: "severe" } };
  assert.equal(C.mergeProfiles(DB.plants, [stricter]).find((x) => x.id === POTHOS.id).toxicity.children, "severe");
  const fresh = { ...POTHOS, id: "new-fern", commonName: "Aaa Fern" };
  assert.equal(C.mergeProfiles(DB.plants, [fresh])[0].id, "new-fern");
  assert.equal(DB.plants.find((x) => x.id === POTHOS.id).toxicity.children, "moderate", "inputs are not mutated");
});

test("service worker BUILD stamp matches the files it caches (run: node tests/helpers/stamp.js)", () => {
  assert.equal(stamp.current(), stamp.expected(), "an app file changed without re-stamping web/sw.js; phones would keep the old version");
  assert.match(fs.readFileSync(path.join(ROOT, "web/sw.js"), "utf8"), /const VERSION = "botanica-" \+ BUILD;/);
});

test("weather URL never contains trailing zeros (the weather service answers those with a redirect)", () => {
  for (const v of [37.3, -121.9, 40, 40.1234, -100.4567, 37.30000001]) {
    const s = String(C.roundCoord(v));
    assert.equal(/\.\d*0$/.test(s), false, s);
    assert.ok((s.split(".")[1] || "").length <= 2, s);
  }
  const app = fs.readFileSync(path.join(ROOT, "web/app.js"), "utf8");
  assert.equal(/toFixed\(\d\)\}[,`]/.test(app.split("\n").filter((l) => l.includes("/points/")).join("\n")), false, "don't build the /points/ URL with toFixed()");
});

test("public care guide contains no references to features that don't exist in the web app", () => {
  assert.equal(/gateway/i.test(JSON.stringify(DB)), false);
});

// Built from pieces so this file does not match its own scan.
const AI = new RegExp(["anth" + "ropic", "cla" + "ude", "open" + "ai", "co-authored-by:.*\\bai\\b"].join("|"), "i");
test("git history (messages, authors) contains no AI-service references", (t) => {
  let log;
  try { log = execFileSync("git", ["log", "--all", "--format=%H%x09%an <%ae>%x09%cn <%ce>%x09%B%x00"], { cwd: ROOT, maxBuffer: 64 << 20 }).toString(); }
  catch { return t.skip("not a git checkout"); }
  if (/\(grafted|shallow\)/.test(log) || fs.existsSync(path.join(ROOT, ".git/shallow"))) t.diagnostic("shallow clone: only the fetched commits were checked");
  const bad = log.split("\0").filter((c) => AI.test(c)).map((c) => c.trim().slice(0, 12));
  assert.deepEqual(bad, [], "rewrite these commits before publishing");
});
