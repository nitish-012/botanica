// End-to-end tests: drive the real web app in a phone-sized browser.
// Every request to anything other than the local test server is blocked and recorded;
// each test fails if the app tried to reach the internet.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { serve } = require("../helpers/server.js");

let playwright;
try { playwright = require("playwright"); } catch {
  if (process.env.CI) throw new Error("Playwright must be installed in CI");
}
const skip = !playwright && "Playwright not installed locally";

const WEB = path.join(__dirname, "../../web");
const PHOTO = path.join(__dirname, "../fixtures/plant.jpg");
const XSS = `<img src=x onerror="window.__xss=1">"><svg onload=window.__xss=2>`;

let browser, srv, base, external;

test.before(async () => {
  if (skip) return;
  srv = await serve(WEB, { "/framed.html": "<!doctype html><title>t</title>" });
  base = `http://127.0.0.1:${srv.port}`;
  browser = await playwright.chromium.launch();
});
test.after(async () => { if (browser) await browser.close(); if (srv) srv.server.close(); });

// weather: optional handler for api.weather.gov requests (only in tests that tap "Check weather").
// Without it, ANY request to the weather service counts as an unwanted outside connection.
async function phone({ weather, geo } = {}) {
  const ctx = await browser.newContext({ ...playwright.devices["iPhone 13"], acceptDownloads: true,
    ...(geo ? { permissions: ["geolocation"], geolocation: geo } : {}) });
  external = [];
  const isWeather = (u) => weather && u.protocol === "https:" && u.hostname === "api.weather.gov";
  await ctx.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === "127.0.0.1" || u.protocol === "blob:" || u.protocol === "data:") return route.continue();
    if (isWeather(u)) return weather(route);
    external.push(route.request().url());
    return route.abort();
  });
  ctx.on("request", (r) => { const u = new URL(r.url()); if (u.hostname !== "127.0.0.1" && /^https?:/.test(u.protocol) && !isWeather(u)) external.push(r.url()); });
  await ctx.addInitScript(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") page.errors.push(m.text()); });
  return { ctx, page };
}

async function clean(page) {
  assert.deepEqual(await page.evaluate(() => window.__csp), [], "Content-Security-Policy violations");
  assert.equal(await page.evaluate(() => window.__xss), undefined, "script injection ran");
  assert.deepEqual(page.errors, [], "browser errors");
  assert.deepEqual([...new Set(external)], [], "the app tried to contact the internet");
}

async function addPlant(page, { nickname, species = "epipremnum-aureum", room = "Kitchen", pot = "15", notes = "" }) {
  await page.goto(base + "/#/edit");
  await page.waitForSelector("#plantForm");
  if (species) await page.selectOption("#species", species);
  await page.fill("#nick", nickname);
  await page.fill("#room", room);
  await page.fill("#pot", pot);
  if (notes) await page.fill("#notes", notes);
  await page.setInputFiles("input[name=lib]", PHOTO);
  await page.click("button[type=submit]");
  await page.waitForSelector(".detail-head h2");
}

test("first launch: empty garden, offline-ready, no outside requests", { skip }, async () => {
  const { ctx, page } = await phone();
  await page.goto(base + "/");
  await page.waitForSelector(".empty h2");
  assert.equal(await page.textContent(".empty h2"), "Your garden is empty");
  assert.equal(await page.evaluate(async () => !!(await navigator.serviceWorker.ready).active), true);
  await clean(page);
  await ctx.close();
});

test("add, water and journal a plant; data survives a reload", { skip }, async () => {
  const { ctx, page } = await phone();
  await addPlant(page, { nickname: "Kitchen Pothos" });
  assert.equal(await page.textContent(".detail-head h2"), "Kitchen Pothos");
  assert.ok(await page.$(".hero img"), "photo shown");
  assert.match(await page.textContent('[data-act="water"]'), /~\d+ ml/);
  assert.match(await page.textContent(".detail-head .badge"), /Needs water today/);

  await page.click('[data-act="water"]');
  await page.waitForFunction(() => /Healthy/.test(document.querySelector(".detail-head .badge").textContent));
  await page.click('[data-act="note"]');
  await page.fill("textarea[name=text]", "First new leaf!");
  await page.click("#noteForm button[type=submit]");
  await page.waitForFunction(() => document.querySelectorAll(".timeline li").length === 2);
  const timeline = await page.textContent(".timeline");
  assert.match(timeline, /Watered · \d+ ml/);
  assert.match(timeline, /First new leaf!/);

  await page.reload();
  await page.waitForSelector(".detail-head h2");
  await page.click('.tabbar a[data-tab="garden"]');
  await page.waitForSelector("#okTiles .tile");
  assert.equal(await page.textContent(".tile .tile-name"), "Kitchen Pothos");
  assert.equal(await page.$("#needTiles"), null, "nothing needs attention after watering");
  await clean(page);
  await ctx.close();
});

test("script injection in every text field is shown as plain text", { skip }, async () => {
  const { ctx, page } = await phone();
  await addPlant(page, { nickname: XSS, room: XSS, notes: XSS, species: "" });
  await page.click('[data-act="note"]');
  await page.fill("textarea[name=text]", XSS);
  await page.click("#noteForm button[type=submit]");
  await page.waitForSelector(".timeline .note");
  await page.waitForSelector(".sheet-backdrop", { state: "detached" });
  assert.equal(await page.textContent(".detail-head h2"), XSS);
  assert.equal(await page.textContent(".timeline .note"), XSS);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "long text widened the page");
  await page.goto(base + "/#/garden");
  await page.waitForSelector(".tiles .tile");
  assert.equal(await page.textContent(".tile .tile-name"), XSS);
  assert.equal(await page.$("main img[src=x]"), null);
  assert.equal(await page.$("main svg[onload]"), null);
  await page.waitForTimeout(300);
  await clean(page);
  await ctx.close();
});

test("backup export → restore on a fresh phone", { skip }, async () => {
  const a = await phone();
  await addPlant(a.page, { nickname: "Backup Fern", room: "Office" });
  await a.page.goto(base + "/#/settings");
  const [download] = await Promise.all([a.page.waitForEvent("download"), a.page.click("#exportBtn")]);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "botanica-")), "backup.json");
  await download.saveAs(file);
  await clean(a.page);
  await a.ctx.close();

  const b = await phone();
  await b.page.goto(base + "/#/settings");
  await b.page.waitForSelector("#importInput", { state: "attached" });
  await b.page.setInputFiles("#importInput", file);
  await b.page.waitForSelector(".tiles .tile");
  assert.equal(await b.page.textContent(".tile .tile-name"), "Backup Fern");
  assert.ok(await b.page.$(".tile .tile-photo img"), "photo restored");
  await clean(b.page);
  await b.ctx.close();
});

test("a hostile backup file can't inject code or bad data", { skip }, async () => {
  const { ctx, page } = await phone();
  const evil = {
    app: "botanica", version: 1,
    plants: [
      { id: "ok-1", nickname: XSS, room: XSS, light: "javascript:alert(1)", photoId: "evil", schedules: { water: { on: true, every: 1e9 } } },
      { id: "<script>", nickname: "bad id" }
    ],
    events: [{ id: "e1", plantId: "ok-1", type: "journal", at: Date.now(), text: XSS, photoId: "evil" }],
    photos: [{ id: "evil", full: "data:text/html;base64,PHNjcmlwdD53aW5kb3cuX194c3M9Mzwvc2NyaXB0Pg==", thumb: "data:text/html;base64,AA==" }]
  };
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "botanica-")), "evil.json");
  fs.writeFileSync(file, JSON.stringify(evil));
  await page.goto(base + "/#/settings");
  await page.waitForSelector("#importInput", { state: "attached" });
  await page.setInputFiles("#importInput", file);
  await page.waitForSelector(".tiles .tile");
  assert.equal(await page.$$eval(".tiles .tile", (els) => els.length), 1, "plant with a hostile id was dropped");
  assert.equal(await page.textContent(".tile .tile-name"), XSS);
  await page.click(".tile");
  await page.waitForSelector(".timeline .note");
  assert.equal(await page.textContent(".timeline .note"), XSS);
  await page.waitForTimeout(300);
  await clean(page);
  await ctx.close();
});

test("works with no connection after the first visit", { skip }, async () => {
  const { ctx, page } = await phone();
  await page.goto(base + "/");
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload(); // let the service worker take control
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await ctx.setOffline(true);
  await page.goto(base + "/#/guide");
  await page.waitForSelector("#results .row");
  assert.ok((await page.$$("#results .row")).length >= 3);
  await clean(page);
  await ctx.close();
});

test("refuses to run inside another page's frame", { skip }, async () => {
  const { ctx, page } = await phone();
  await page.goto(base + "/framed.html");
  await page.evaluate((src) => { const f = document.createElement("iframe"); f.src = src; document.body.appendChild(f); }, base + "/");
  const frame = await (await page.waitForSelector("iframe")).contentFrame();
  await frame.waitForFunction(() => /can only be opened directly/.test(document.body.textContent));
  assert.equal(await frame.$(".tiles, .empty"), null);
  assert.deepEqual([...new Set(external)], []);
  await ctx.close();
});

/* ---------- Weather ---------- */
function nwsHourly(days) {
  const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() + 1);
  const periods = [];
  days.forEach((d, i) => {
    for (let h = 0; h < 24; h++) {
      const t = new Date(start); t.setDate(start.getDate() + i); t.setHours(h);
      const isDay = h >= 7 && h < 18;
      periods.push({ startTime: t.toISOString(), isDaytime: isDay, temperatureUnit: "F", temperature: isDay ? d.hiF : d.loF,
        relativeHumidity: { value: d.rh }, probabilityOfPrecipitation: { value: 0 }, windSpeed: "5 mph", shortForecast: "Sunny" });
    }
  });
  return { properties: { periods } };
}

async function setLocationManually(page, lat, lon) {
  await page.goto(base + "/#/settings");
  await page.click("#locManual");
  await page.fill("#locLat", String(lat));
  await page.fill("#locLon", String(lon));
  await page.click("#locForm button[type=submit]");
  await page.waitForFunction(() => /,/.test(document.querySelector("#locText").textContent));
}

test("weather is never fetched on its own", { skip }, async () => {
  const { ctx, page } = await phone(); // no weather handler: any weather request = failure
  await addPlant(page, { nickname: "Pothy" });
  await setLocationManually(page, 40.1234, -100.4567);
  assert.equal(await page.textContent("#locText"), "40.12, -100.46 (rounded to about 1 km)");
  await page.goto(base + "/#/garden");
  await page.waitForSelector("#wxBtn");
  await page.reload();
  await page.waitForSelector("#outlook");
  await page.waitForTimeout(800);
  await clean(page);
  await ctx.close();
});

test("Check weather: only the weather service, rounded location, no cookies or referrer, advice on the phone", { skip }, async () => {
  const calls = [];
  const { ctx, page } = await phone({
    weather: async (route) => {
      const req = route.request();
      calls.push({ url: req.url(), method: req.method(), headers: await req.allHeaders() });
      const u = new URL(req.url());
      const body = u.pathname.startsWith("/points/")
        ? { properties: { forecastHourly: "https://api.weather.gov/gridpoints/TST/10,20/forecast/hourly" } }
        : nwsHourly([{ hiF: 95, loF: 60, rh: 15 }, { hiF: 80, loF: 55, rh: 40 }]);
      return route.fulfill({ status: 200, contentType: "application/geo+json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(body) });
    }
  });
  await addPlant(page, { nickname: "Monty", species: "monstera-deliciosa" });
  await setLocationManually(page, 40.1234, -100.4567);
  await page.goto(base + "/#/garden");
  await page.click("#wxBtn");
  await page.waitForFunction(() => /Forecast: U\.S\. National Weather Service/.test(document.querySelector("#outlook").textContent));
  const text = await page.textContent("#outlook");
  assert.match(text, /Hot .*up to 35°C/);
  assert.match(text, /Very dry air .*15%/);
  assert.deepEqual(calls.map((c) => c.url), [
    "https://api.weather.gov/points/40.12,-100.46",
    "https://api.weather.gov/gridpoints/TST/10,20/forecast/hourly"
  ]);
  for (const c of calls) {
    assert.equal(c.method, "GET");
    assert.equal(c.headers.cookie, undefined, "no cookies");
    assert.equal(c.headers.referer, undefined, "no referrer");
    assert.equal(c.headers.authorization, undefined);
  }
  await clean(page);
  await ctx.close();
});

test("a tampered weather response can't send the app anywhere else", { skip }, async () => {
  const { ctx, page } = await phone({
    weather: (route) => route.fulfill({ status: 200, contentType: "application/geo+json", headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ properties: { forecastHourly: "https://evil.example/steal" } }) })
  });
  await addPlant(page, { nickname: "Pothy" });
  await setLocationManually(page, 40.1, -100.4);
  await page.goto(base + "/#/garden");
  await page.click("#wxBtn");
  await page.waitForFunction(() => /Blocked/.test(document.querySelector("#toast").textContent));
  await page.waitForTimeout(300);
  await clean(page); // evil.example would show up here if contacted
  await ctx.close();
});

test("'Use my current location' stores only a rounded position", { skip }, async () => {
  const { ctx, page } = await phone({ geo: { latitude: 40.123456, longitude: -100.456789 } });
  await page.goto(base + "/#/settings");
  await page.click("#geoBtn");
  await page.waitForFunction(() => /40\.12, -100\.46/.test(document.querySelector("#locText").textContent));
  const stored = await page.evaluate(() => DB.setting("location"));
  assert.deepEqual(stored, { lat: 40.12, lon: -100.46, label: "Home" });
  await clean(page);
  await ctx.close();
});

test("private care profiles restore from a backup and the guide shows only garden plants", { skip }, async () => {
  const { ctx, page } = await phone();
  const base_ = JSON.parse(fs.readFileSync(path.join(WEB, "plants_database.json"), "utf8")).plants[0];
  const privateProfile = { ...base_, id: "test-fern", commonName: "Test Fern", scientificName: "Testus fernus", aliases: [], summary: `Private profile ${XSS}` };
  const backupFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "botanica-")), "starter.json");
  fs.writeFileSync(backupFile, JSON.stringify({ app: "botanica", version: 1, profiles: [privateProfile], events: [], photos: [],
    plants: [{ id: "p-1", nickname: "Ferny", speciesId: "test-fern", speciesName: "Test Fern", schedules: {} }] }));
  await page.goto(base + "/#/settings");
  await page.waitForSelector("#importInput", { state: "attached" });
  await page.setInputFiles("#importInput", backupFile);
  await page.waitForSelector(".tiles .tile");
  await page.goto(base + "/#/guide");
  await page.waitForSelector("#results .row");
  const names = await page.$$eval("#results .row b", (els) => els.map((e) => e.textContent));
  assert.deepEqual(names, ["Test Fern"], "guide lists only the species in the garden");
  await page.click("#results .row");
  await page.waitForSelector(".detail-head h2");
  assert.match(await page.textContent("main"), /Private profile <img/);
  await page.reload(); // profiles persist on the phone
  await page.goto(base + "/#/plant/p-1");
  await page.waitForSelector(".detail-head h2");
  assert.match(await page.textContent("main"), /How to care for it/);
  await clean(page);
  await ctx.close();
});

test("home shows plants needing attention first as tiles; an accidental watering can be deleted", { skip }, async () => {
  const { ctx, page } = await phone();
  await page.clock.setFixedTime(new Date(2026, 6, 15, 10, 0)); // July: growing season
  const day = 86400000, now = new Date(2026, 6, 15, 10, 0).getTime();
  const at = (d) => { const x = new Date(now); x.setHours(0, 0, 0, 0); return x.getTime() + d * day; };
  const sch = (next, extra = {}) => ({ water: { on: true, every: 7, winterEvery: 14, last: null, next }, fertilize: { on: true, every: 30, last: null, next: at(20) }, ...extra });
  const backupFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "botanica-")), "b.json");
  fs.writeFileSync(backupFile, JSON.stringify({ app: "botanica", version: 1, events: [], photos: [], plants: [
    { id: "p-late", nickname: "Thirsty", speciesId: "epipremnum-aureum", potDiameterCm: 15, schedules: sch(at(-2)) },
    { id: "p-ok", nickname: "Fine", speciesId: "epipremnum-aureum", potDiameterCm: 15, schedules: sch(at(3)) }] }));
  await page.goto(base + "/#/settings");
  await page.waitForSelector("#importInput", { state: "attached" });
  await page.setInputFiles("#importInput", backupFile);
  await page.waitForSelector("#needTiles .tile");
  assert.deepEqual(await page.$$eval("#needTiles .tile-name", (e) => e.map((x) => x.textContent)), ["Thirsty"]);
  assert.deepEqual(await page.$$eval("#okTiles .tile-name", (e) => e.map((x) => x.textContent)), ["Fine"]);
  assert.match(await page.textContent("#needTiles .chip.late"), /\d+ ml/);
  assert.match(await page.textContent("#okTiles .chip"), /3d/);

  // Accidental tap on "Water now", then delete it from the journal: the schedule goes back.
  await page.click("#needTiles .tile");
  await page.waitForSelector(".detail-head h2");
  await page.click('[data-act="water"]');
  await page.waitForFunction(() => /Healthy/.test(document.querySelector(".detail-head .badge").textContent));
  await page.click(".del-ev");
  await page.click("#evDel");
  await page.waitForFunction(() => /overdue/.test(document.querySelector(".detail-head .badge").textContent));
  assert.equal(await page.$$eval(".timeline .del-ev", (e) => e.length), 0);
  const plant = await page.evaluate(() => DB.get("plants", "p-late"));
  assert.equal(plant.schedules.water.next, at(-2));
  assert.equal(plant.schedules.water.last, null);

  // Fertilize asks which feed (homemade first) and the toast offers Undo.
  await page.click('[data-act="fertilize"]');
  await page.waitForSelector("#feedForm");
  const first = await page.$eval(".opt small", (e) => e.textContent);
  assert.equal(first, "Homemade");
  await page.click("#feedForm button[type=submit]");
  await page.waitForSelector(".toast.show .toast-btn");
  await page.click(".toast-btn");
  await page.waitForFunction(() => document.querySelectorAll(".timeline .del-ev").length === 0);
  assert.match(await page.textContent("main"), /Homemade \(preferred\)/);
  assert.match(await page.textContent("main"), /Store-bought/);
  await clean(page);
  await ctx.close();
});

test("fertilizing shows a winter rest instead of a far-off due date", { skip }, async () => {
  const { ctx, page } = await phone();
  await page.clock.setFixedTime(new Date(2026, 10, 15, 10, 0)); // November
  const backupFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "botanica-")), "b.json");
  fs.writeFileSync(backupFile, JSON.stringify({ app: "botanica", version: 1, events: [], photos: [], plants: [
    { id: "p-1", nickname: "Pothos", speciesId: "epipremnum-aureum", schedules: { fertilize: { on: true, every: 30, next: new Date(2027, 2, 1).getTime() } } }] }));
  await page.goto(base + "/#/settings");
  await page.waitForSelector("#importInput", { state: "attached" });
  await page.setInputFiles("#importInput", backupFile);
  await page.waitForSelector(".tiles .tile");
  await page.goto(base + "/#/plant/p-1");
  await page.waitForSelector(".detail-head h2");
  assert.match(await page.textContent(".section .panel"), /Winter rest: no feeding until Mar 1, 2027, then every 30 days/);
  await clean(page);
  await ctx.close();
});

test("a care-guide-only update file keeps the garden and its schedules untouched", { skip }, async () => {
  const { ctx, page } = await phone();
  await addPlant(page, { nickname: "Keep Me" });
  const before = await page.evaluate(async () => (await DB.all("plants"))[0]);
  const base_ = JSON.parse(fs.readFileSync(path.join(WEB, "plants_database.json"), "utf8")).plants[0];
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "botanica-")), "care.json");
  fs.writeFileSync(file, JSON.stringify({ app: "botanica", version: 1, plants: [], events: [], photos: [], profiles: [{ ...base_, id: "new-herb", commonName: "New Herb" }] }));
  await page.goto(base + "/#/settings");
  await page.waitForSelector("#importInput", { state: "attached" });
  await page.setInputFiles("#importInput", file);
  await page.waitForFunction(() => /Updated 1 care guide/.test(document.querySelector("#toast").textContent));
  const after = await page.evaluate(async () => (await DB.all("plants")));
  assert.equal(after.length, 1);
  assert.deepEqual(after[0], before);
  await clean(page);
  await ctx.close();
});
