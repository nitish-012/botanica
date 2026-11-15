// Weather & climate logic: pure functions, synthetic data, no network.
process.env.TZ = "America/Los_Angeles";
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../../web/core.js");
const DB = require("../../web/plants_database.json");

const profileOf = (id) => DB.plants.find((p) => p.id === id);
const plant = (id, nickname, speciesId, extra = {}) => ({ id, nickname, speciesId, light: "indirect", room: "", ...extra });
const POTHOS = plant("a", "Pothy", "epipremnum-aureum");               // tropical (idealMinC 18), medium humidity
const MONSTERA = plant("b", "Monty", "monstera-deliciosa");            // tropical, high humidity
const SNAKE = plant("c", "Snakey", "dracaena-trifasciata", { light: "direct" }); // sits in the sunny window
const BALCONY = plant("d", "Basil", "", { room: "Balcony" });
const ALL = [POTHOS, MONSTERA, SNAKE, BALCONY];

function hourly(days) {
  // days: [{ hiF, loF, rh, pop, sky }] starting tomorrow at local midnight, 24 periods each
  const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() + 1);
  const periods = [];
  days.forEach((d, i) => {
    for (let h = 0; h < 24; h++) {
      const t = new Date(start); t.setDate(start.getDate() + i); t.setHours(h);
      const isDay = h >= 7 && h < 18;
      periods.push({
        startTime: t.toISOString(), isDaytime: isDay, temperatureUnit: "F",
        temperature: isDay ? d.hiF : d.loF,
        relativeHumidity: { unitCode: "wmoUnit:percent", value: d.rh },
        probabilityOfPrecipitation: { unitCode: "wmoUnit:percent", value: d.pop ?? 0 },
        windSpeed: "5 to 10 mph", shortForecast: d.sky || "Sunny"
      });
    }
  });
  return { properties: { periods } };
}
const advise = (days, plants = ALL) => C.weatherAdvice(C.summarizeDays(C.parseNwsHourly(hourly(days))), plants, profileOf);
const ids = (tips) => tips.map((t) => t.id);

test("roundCoord and cleanLocation keep only ~1 km precision and reject nonsense", () => {
  assert.equal(C.roundCoord(12.3456789), 12.35);
  assert.equal(C.roundCoord("-45.678"), -45.68);
  assert.deepEqual(C.cleanLocation({ lat: 40.1234, lon: -100.4567, label: "Home" }), { lat: 40.12, lon: -100.46, label: "Home" });
  for (const bad of [null, {}, { lat: "x", lon: 1 }, { lat: 91, lon: 0 }, { lat: 0, lon: 181 }]) assert.equal(C.cleanLocation(bad), null);
  assert.equal(C.cleanLocation({ lat: 1, lon: 2, label: "x".repeat(99) }).label.length, 40);
  assert.equal(C.cleanLocation({ lat: 1, lon: 2, label: "   " }).label, "Home");
});

test("cleanClimate needs 12 sane months", () => {
  const months = Array.from({ length: 12 }, () => ({ highC: 20, lowC: 8 }));
  assert.deepEqual(C.cleanClimate({ label: "Typical", months }).months.length, 12);
  assert.equal(C.cleanClimate({ months: months.slice(0, 11) }), null);
  assert.equal(C.cleanClimate({ months: [...months.slice(0, 11), { highC: 5, lowC: 9 }] }), null);
  assert.equal(C.cleanClimate({ months: [...months.slice(0, 11), { highC: "hot", lowC: 9 }] }), null);
});

test("dayLengthHours matches known values (±0.5 h)", () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) <= 0.5, `${a} vs ${b}`);
  near(C.dayLengthHours(37.3, new Date(2026, 5, 21).getTime()), 14.7);
  near(C.dayLengthHours(37.3, new Date(2026, 11, 21).getTime()), 9.6);
  near(C.dayLengthHours(37.3, new Date(2026, 2, 20).getTime()), 12.1);
  near(C.dayLengthHours(0, new Date(2026, 0, 1).getTime()), 12.1);
  assert.equal(C.dayLengthHours(80, new Date(2026, 11, 21).getTime()), 0);
  assert.equal(C.dayLengthHours(80, new Date(2026, 5, 21).getTime()), 24);
});

test("parseNwsHourly converts units, derives humidity from dew point, and rejects junk", () => {
  const hours = C.parseNwsHourly({ properties: { periods: [
    { startTime: "2026-07-01T14:00:00-07:00", temperature: 86, temperatureUnit: "F", relativeHumidity: { value: 25 }, isDaytime: true, shortForecast: "Sunny", windSpeed: "5 to 15 mph" },
    { startTime: "2026-07-01T15:00:00-07:00", temperature: 30, temperatureUnit: "C", dewpoint: { unitCode: "wmoUnit:degC", value: 10 }, isDaytime: true, shortForecast: "Mostly Cloudy" },
    { startTime: "not a date", temperature: 70 },
    { startTime: "2026-07-01T16:00:00-07:00", temperature: null },
    "<script>"
  ] } });
  assert.equal(hours.length, 2);
  assert.equal(hours[0].tempC, 30);
  assert.equal(hours[0].rh, 25);
  assert.equal(hours[0].windMph, 15);
  assert.equal(hours[0].sky, "clear");
  assert.equal(hours[1].rh, 29); // 30 °C with a 10 °C dew point ≈ 29 %
  assert.equal(hours[1].sky, "cloudy");
  for (const bad of [null, {}, { properties: {} }, { properties: { periods: "x" } }]) assert.throws(() => C.parseNwsHourly(bad));
});

test("summarizeDays groups by local day", () => {
  const days = C.summarizeDays(C.parseNwsHourly(hourly([{ hiF: 86, loF: 50, rh: 40 }, { hiF: 68, loF: 41, rh: 60 }])));
  assert.equal(days.length, 2);
  assert.equal(days[0].maxC, 30);
  assert.equal(days[0].minC, 10);
  assert.equal(days[1].minC, 5);
  assert.equal(days[0].dayHours, 11);
});

test("heat: everyone gets 'check soil early'; sunny-window plants get 'pull back'", () => {
  const tips = advise([{ hiF: 95, loF: 60, rh: 45 }]);
  const heat = tips.find((t) => t.id === "heat");
  assert.ok(heat);
  assert.match(heat.title, /up to 35°C/);
  assert.match(heat.detail, /Pull Snakey back/);
  assert.equal(heat.plantIds.length, ALL.length);
});

test("cold nights warn only tropical plants; frost warns balcony plants", () => {
  const tips = advise([{ hiF: 55, loF: 30, rh: 50 }]);
  const cold = tips.find((t) => t.id === "cold");
  // Pothos (18 °C) and Monstera (18 °C) are tropical; Snake plant (16 °C) counts too; Balcony basil has no profile.
  assert.deepEqual(cold.plantIds.sort(), ["a", "b", "c"]);
  assert.ok(!cold.plantIds.includes("d"));
  const frost = tips.find((t) => t.id === "frost");
  assert.deepEqual(frost.plantIds, ["d"]);
});

test("very dry air warns humidity-loving plants only", () => {
  const dry = advise([{ hiF: 75, loF: 55, rh: 18 }]).find((t) => t.id === "dry");
  assert.deepEqual(dry.plantIds, ["b"]);
  assert.match(dry.title, /18%/);
  assert.match(dry.detail, /Keep Monty close to other plants/);
  assert.equal(advise([{ hiF: 75, loF: 55, rh: 18 }], [POTHOS]).some((t) => t.id === "dry"), false);
});

test("two or more grey days suggest less water and grow lights for sun-lovers", () => {
  const tips = advise([{ hiF: 60, loF: 50, rh: 80, pop: 80, sky: "Rain" }, { hiF: 60, loF: 50, rh: 80, sky: "Cloudy" }]);
  const g = tips.find((t) => t.id === "gloomy");
  assert.ok(g);
  assert.match(g.detail, /grow lights.*Snakey/);
  assert.equal(advise([{ hiF: 60, loF: 50, rh: 80, sky: "Rain", pop: 90 }]).some((t) => t.id === "gloomy"), false);
});

test("calm week says so", () => {
  assert.deepEqual(ids(advise([{ hiF: 72, loF: 55, rh: 50 }, { hiF: 74, loF: 56, rh: 50 }])), ["calm"]);
});

test("climate advice: short winter days, cool nights; long hot summer days", () => {
  const months = Array.from({ length: 12 }, (_, i) => ([0, 1, 10, 11].includes(i) ? { highC: 16, lowC: 6 } : i >= 5 && i <= 8 ? { highC: 28, lowC: 15 } : { highC: 21, lowC: 10 }));
  const climate = { label: "Test", months };
  const nov = C.climateAdvice({ month: 11, lat: 37.3, climate, plants: ALL, profileOf, now: new Date(2026, 10, 15).getTime() });
  assert.deepEqual(ids(nov), ["short-days", "cool-nights"]);
  assert.match(nov[0].detail, /Snakey need 12–14 hours/);
  const jul = C.climateAdvice({ month: 7, lat: 37.3, climate, plants: ALL, profileOf, now: new Date(2026, 6, 1).getTime() });
  assert.deepEqual(ids(jul), ["growing", "hot-season"]);
  // Without a location or climate data, nothing is guessed.
  assert.deepEqual(C.climateAdvice({ month: 11, lat: NaN, climate: null, plants: ALL, profileOf }), []);
});

test("backups carry location and climate through the same validation", () => {
  const months = Array.from({ length: 12 }, () => ({ highC: 20, lowC: 8 }));
  const out = C.validateBackup({ app: "botanica", plants: [], events: [], photos: [],
    settings: { location: { lat: 12.3456, lon: 65.4321, label: "<b>Home</b>" }, climate: { label: "x", months } } });
  assert.deepEqual(out.settings.location, { lat: 12.35, lon: 65.43, label: "<b>Home</b>" }); // escaped at render time
  assert.equal(out.settings.climate.months.length, 12);
  const bad = C.validateBackup({ app: "botanica", settings: { location: { lat: 999, lon: 0 }, climate: { months: [] } } });
  assert.deepEqual(bad.settings, {});
});
