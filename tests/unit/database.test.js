// Validates the bundled care guide (web/plants_database.json) so a bad edit can never ship.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const WEB = path.join(__dirname, "../../web/plants_database.json");
const NATIVE = path.join(__dirname, "../../Botanica/Resources/plants_database.json");
const DB = JSON.parse(fs.readFileSync(WEB, "utf8"));
const LIGHT = ["low", "indirect", "direct"];
const LEVEL = ["low", "medium", "high"];
const TOX = ["none", "mild", "moderate", "severe"];
const month = (m) => Number.isInteger(m) && m >= 1 && m <= 12;
const nonEmpty = (s) => typeof s === "string" && s.trim().length > 0;

test("database header is valid", () => {
  assert.equal(DB.schemaVersion, 1);
  assert.match(DB.databaseVersion, /^\d{4}\.\d{2}\.\d{2}-\d+$/);
  assert.ok(!Number.isNaN(Date.parse(DB.generatedAt)));
  assert.ok(Array.isArray(DB.plants) && DB.plants.length > 0);
});

test("plant ids are unique, lowercase slugs", () => {
  const ids = DB.plants.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
});

for (const p of DB.plants) {
  test(`profile "${p.id}" is complete and sensible`, () => {
    for (const k of ["commonName", "scientificName", "family", "summary"]) assert.ok(nonEmpty(p[k]), k);
    assert.ok(["easy", "moderate", "hard"].includes(p.difficulty));
    assert.ok(Array.isArray(p.aliases));

    assert.ok(LIGHT.includes(p.light.ideal));
    assert.ok(p.light.tolerates.every((l) => LIGHT.includes(l)));

    const w = p.water;
    assert.ok(w.intervalDaysGrowing >= 1 && w.intervalDaysGrowing <= 60);
    assert.ok(w.intervalDaysDormant >= w.intervalDaysGrowing, "winter watering should not be more frequent");
    assert.ok(w.fractionOfPotVolume >= 0.05 && w.fractionOfPotVolume <= 0.5);
    assert.ok(nonEmpty(w.checkBeforeWatering) && nonEmpty(w.method));
    assert.ok(w.signsOfOverwatering.length && w.signsOfUnderwatering.length);

    assert.ok(LEVEL.includes(p.humidity.level));
    assert.ok(p.humidity.idealMinPercent >= 10 && p.humidity.idealMinPercent <= 90);
    assert.equal(typeof p.humidity.misting, "boolean");

    const t = p.temperature;
    assert.ok(t.minC <= t.idealMinC && t.idealMinC < t.idealMaxC);

    assert.ok(nonEmpty(p.soil.mix) && nonEmpty(p.soil.drainage));

    assert.ok(p.fertilizer.intervalDaysGrowing >= 7);
    assert.ok(p.fertilizer.pauseMonths.every(month));
    assert.ok(p.repotting.everyMonths >= 6 && p.repotting.bestMonths.every(month));
    assert.ok(p.pruning.bestMonths.every(month) && nonEmpty(p.pruning.how));

    assert.ok(p.propagation.length && p.growthTips.length);
    const probIds = p.problems.map((x) => x.id);
    assert.equal(new Set(probIds).size, probIds.length, "problem ids unique");
    for (const x of p.problems) {
      assert.match(x.id, /^[a-z0-9-]+$/);
      assert.ok(nonEmpty(x.symptom) && nonEmpty(x.fix) && x.likelyCauses.length);
      assert.ok(["low", "medium", "high"].includes(x.severity));
    }
    for (const x of p.pests) {
      assert.match(x.id, /^[a-z0-9-]+$/);
      assert.ok(nonEmpty(x.name) && nonEmpty(x.signs) && nonEmpty(x.treatment));
      assert.equal(typeof x.detectableOnDevice, "boolean");
    }

    // Kids live in this home: toxicity must be stated, and toxic plants must say what to do.
    assert.ok(TOX.includes(p.toxicity.children) && TOX.includes(p.toxicity.pets));
    if (p.toxicity.children !== "none") {
      assert.ok(nonEmpty(p.toxicity.compound) && nonEmpty(p.toxicity.notes));
      if (["moderate", "severe"].includes(p.toxicity.children)) {
        assert.match(p.toxicity.notes, /Poison Control|1-800-222-1222/i, "moderate/severe toxicity must give Poison Control");
      }
    }
  });
}

test("companion links point to real plants and never to themselves", () => {
  const ids = new Set(DB.plants.map((p) => p.id));
  for (const p of DB.plants) {
    for (const ref of [...p.companions.goodWith, ...p.companions.keepApartFrom]) {
      assert.ok(ids.has(ref), `${p.id} → unknown ${ref}`);
      assert.notEqual(ref, p.id);
    }
    const overlap = p.companions.goodWith.filter((x) => p.companions.keepApartFrom.includes(x));
    assert.deepEqual(overlap, [], `${p.id} lists the same plant as good and bad`);
  }
});

test("web and native copies of the care guide are identical", () => {
  if (!fs.existsSync(NATIVE)) return;
  assert.deepEqual(JSON.parse(fs.readFileSync(NATIVE, "utf8")), DB);
});

test("every public profile passes the strict profile validator unchanged", () => {
  const C = require("../../web/core.js");
  for (const p of DB.plants) assert.deepEqual(C.cleanProfile(p), p, p.id);
});

test("hostile or broken profiles are rejected or trimmed", () => {
  const C = require("../../web/core.js");
  const good = DB.plants[0];
  assert.equal(C.cleanProfile({ ...good, id: "<script>" }), null);
  assert.equal(C.cleanProfile({ ...good, commonName: 42 }), null);
  assert.equal(C.cleanProfile({ ...good, light: { ideal: "laser" } }), null);
  assert.equal(C.cleanProfile({ ...good, water: { ...good.water, intervalDaysGrowing: 0 } }), null);
  assert.equal(C.cleanProfile({ ...good, temperature: { minC: 30, idealMinC: 10, idealMaxC: 20 } }), null);
  assert.equal(C.cleanProfile({ ...good, toxicity: { children: "unknown" } }), null);
  const trimmed = C.cleanProfile({ ...good, summary: "x".repeat(5000), aliases: Array(50).fill("a"), extraField: "<img onerror=1>",
    problems: [{ id: "bad id!", symptom: "s", fix: "f" }, ...good.problems], companions: { goodWith: ["ok-id", "../etc"] } });
  assert.equal(trimmed.summary.length, 600);
  assert.equal(trimmed.aliases.length, 8);
  assert.equal("extraField" in trimmed, false);
  assert.equal(trimmed.problems.length, good.problems.length);
  assert.deepEqual(trimmed.companions.goodWith, ["ok-id"]);
  const out = C.validateBackup({ app: "botanica", profiles: [good, { id: "x" }, null] });
  assert.deepEqual(out.profiles.map((p) => p.id), [good.id]);
});
