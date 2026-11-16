// End-to-end regression tests from the independent review. Same style as app.e2e.test.js.
// BROWSER=webkit runs the same tests in WebKit (closest engine to iOS Safari).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { serve } = require("../helpers/server.js");

let playwright;
try { playwright = require("playwright"); } catch { if (process.env.CI) throw new Error("Playwright must be installed in CI"); }
const skip = !playwright && "Playwright not installed locally";
const ENGINE = process.env.BROWSER || "chromium";
const WEB = path.join(__dirname, "../../web");
const PHOTO = path.join(__dirname, "../fixtures/plant.jpg");
const GUIDE = JSON.parse(fs.readFileSync(path.join(WEB, "plants_database.json"), "utf8")).plants;
const XSS = `"><img src=x onerror="window.__xss=1"><svg onload=window.__xss=2>`;

let browser, srv, base;
test.before(async () => { if (skip) return; srv = await serve(WEB); base = `http://127.0.0.1:${srv.port}`; browser = await playwright[ENGINE].launch(); });
test.after(async () => { if (browser) await browser.close(); if (srv) srv.server.close(); });

async function phone({ weather } = {}) {
  const { defaultBrowserType, ...iphone } = playwright.devices["iPhone 13"];
  const ctx = await browser.newContext({ ...iphone, acceptDownloads: true });
  const external = [];
  await ctx.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === "127.0.0.1" || u.protocol === "blob:" || u.protocol === "data:") return route.continue();
    if (weather && u.hostname === "api.weather.gov") return weather(route);
    external.push(u.href); return route.abort();
  });
  const page = await ctx.newPage();
  page.errors = []; page.external = external;
  page.on("pageerror", (e) => page.errors.push(e.message));
  return { ctx, page };
}
const tmpFile = (name, data) => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "botanica-")), name); fs.writeFileSync(f, typeof data === "string" ? data : JSON.stringify(data)); return f; };
async function restore(page, data) {
  await page.goto(base + "/#/settings");
  await page.waitForSelector("#importInput", { state: "attached" });
  await page.setInputFiles("#importInput", tmpFile("backup.json", { app: "botanica", version: 1, ...data }));
  await page.waitForFunction(() => /Restored|backup/i.test(document.querySelector("#toast").textContent));
}
async function addPlant(page, nickname, species = "epipremnum-aureum") {
  await page.goto(base + "/#/edit"); await page.waitForSelector("#plantForm");
  if (species) await page.selectOption("#species", species);
  await page.fill("#nick", nickname); await page.fill("#pot", "15");
  await page.setInputFiles("input[name=lib]", PHOTO);
  await page.click("button[type=submit]"); await page.waitForSelector(".detail-head h2");
}
const injected = (page) => page.evaluate(() => ({ ran: window.__xss, nodes: document.querySelectorAll("img[src='x'], svg[onload]").length }));

test("every plant restored from a backup can be opened and deleted (no ghost records)", { skip }, async () => {
  const { ctx, page } = await phone();
  await restore(page, { plants: [{ id: ["ghost-1"], nickname: "Ghost A" }, { id: 777, nickname: "Ghost B" }, { id: "real-1", nickname: "Real" }] });
  await page.goto(base + "/#/garden"); await page.waitForSelector(".tiles .tile");
  assert.deepEqual(await page.$$eval(".tile .tile-name", (els) => els.map((e) => e.textContent)), ["Real"]);
  await page.click(".tile"); await page.waitForSelector(".detail-head h2");
  await page.click("#actionBtn"); await page.waitForSelector("#delBtn"); await page.click("#delBtn"); await page.click("#d");
  await page.waitForSelector(".empty h2");
  assert.equal(await page.evaluate(async () => (await DB.all("plants")).length), 0);
  await ctx.close();
});

test("a backup can't switch off the child-safety warning of a known toxic plant", { skip }, async () => {
  const { ctx, page } = await phone();
  const pothos = GUIDE.find((p) => p.id === "epipremnum-aureum");
  await restore(page, { plants: [{ id: "p-1", nickname: "Pothy", speciesId: pothos.id }], profiles: [{ ...pothos, toxicity: { children: "none", pets: "none" } }] });
  await page.goto(base + "/#/plant/p-1"); await page.waitForSelector(".detail-head h2");
  assert.match(await page.textContent(".callout.warn"), /Keep away from kids/);
  assert.match(await page.textContent(".callout.warn"), /1-800-222-1222/);
  assert.doesNotMatch(await page.textContent(".kv"), /Non-toxic/);
  await ctx.close();
});

test("hostile text in profile, climate and location fields is never parsed as HTML", { skip }, async () => {
  const { ctx, page } = await phone();
  const p0 = GUIDE[0];
  const evil = { ...p0, id: "evil-prof", commonName: "Evil " + XSS.slice(0, 60), aliases: [XSS.slice(0, 60)], family: XSS, summary: XSS,
    light: { ...p0.light, notes: XSS }, soil: { mix: XSS, drainage: XSS }, growthTips: [XSS], propagation: [XSS],
    toxicity: { children: "severe", pets: "severe", compound: XSS, notes: XSS }, companions: { ...p0.companions, goodWith: [], keepApartFrom: [], notes: XSS } };
  await restore(page, { profiles: [evil], plants: [{ id: "x-1", nickname: XSS, speciesId: "evil-prof", light: "direct", room: XSS }],
    settings: { location: { lat: 40.1, lon: -100.4, label: XSS }, climate: { label: XSS, months: Array(12).fill({ highC: 35, lowC: 2 }) } } });
  for (const hash of ["#/garden", "#/plant/x-1", "#/edit/x-1", "#/guide", "#/guide/evil-prof", "#/settings"]) {
    await page.goto(base + "/" + hash); await page.waitForTimeout(250);
    assert.deepEqual(await injected(page), { ran: undefined, nodes: 0 }, hash);
  }
  await page.goto(base + "/#/garden"); await page.waitForSelector("#outlook .tip");
  assert.match(await page.textContent("#outlook"), /<img src=x/, "the outlook shows the hostile nickname as text");
  await page.goto(base + "/#/settings"); await page.click("#locManual"); await page.waitForSelector(".sheet");
  assert.deepEqual(await injected(page), { ran: undefined, nodes: 0 }, "location sheet");
  assert.deepEqual(page.errors, []);
  await ctx.close();
});

test("Check weather works for coordinates that round to a trailing zero", { skip }, async () => {
  const urls = [];
  const { ctx, page } = await phone({ weather: (route) => {
    const u = new URL(route.request().url()); urls.push(u.pathname);
    // Like the real service: trailing zeros are answered with a redirect, which the app (correctly) refuses to follow.
    if (/\/points\/.*\d\.\d*0(,|$)/.test(u.pathname)) return route.fulfill({ status: 301, headers: { Location: "https://api.weather.gov/points/0,0", "Access-Control-Allow-Origin": "*" } });
    const body = u.pathname.startsWith("/points/") ? { properties: { forecastHourly: "https://api.weather.gov/gridpoints/TST/1,2/forecast/hourly" } }
      : { properties: { periods: [{ startTime: new Date(Date.now() + 864e5).toISOString(), isDaytime: true, temperatureUnit: "F", temperature: 70, shortForecast: "Sunny" }] } };
    return route.fulfill({ status: 200, contentType: "application/geo+json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(body) });
  } });
  await restore(page, { plants: [{ id: "p-1", nickname: "Pothy" }], settings: { location: { lat: 37.3, lon: -121.9, label: "Test" } } });
  await page.goto(base + "/#/garden"); await page.click("#wxBtn");
  await page.waitForFunction(() => /Forecast: U\.S\. National Weather Service/.test(document.querySelector("#outlook").textContent));
  assert.equal(urls[0], "/points/37.3,-121.9");
  assert.deepEqual(page.external, []);
  await ctx.close();
});

test("delete removes the plant's photos and events; export carries events and photos", { skip }, async () => {
  const { ctx, page } = await phone();
  await addPlant(page, "Keeper"); await page.click('[data-act="water"]');
  await page.waitForFunction(() => document.querySelectorAll(".timeline li .dot").length === 1);
  await addPlant(page, "Goner"); await page.click('[data-act="water"]');
  await page.waitForFunction(() => document.querySelectorAll(".timeline li .dot").length === 1);
  await page.goto(base + "/#/settings"); await page.waitForSelector("#exportBtn");
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#exportBtn")]);
  const file = tmpFile("export.json", ""); await download.saveAs(file);
  const out = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual([out.plants.length, out.events.length, out.photos.length], [2, 2, 2]);
  assert.ok(out.events.every((e) => e.type === "care" && e.kind === "water" && e.amountMl > 0));
  await page.goto(base + "/#/garden"); await page.click('.tile:has-text("Goner")'); await page.waitForSelector(".detail-head h2");
  await page.click("#actionBtn"); await page.waitForSelector("#delBtn"); await page.click("#delBtn"); await page.click("#d");
  await page.waitForSelector(".tiles .tile");
  assert.deepEqual(await page.evaluate(async () => [(await DB.all("plants")).length, (await DB.all("events")).length, (await DB.all("photos")).length]), [1, 1, 1]);
  await ctx.close();
});

test("editing a plant: switching a reminder on or off is saved", { skip }, async () => {
  const { ctx, page } = await phone();
  await addPlant(page, "Toggler");
  await page.click("#actionBtn"); await page.waitForSelector("#plantForm");
  await page.evaluate(() => { document.querySelector("[name=on_rotate]").click(); document.querySelector("[name=on_water]").click(); });
  await page.click("button[type=submit]"); await page.waitForSelector(".detail-head h2");
  const on = await page.evaluate(async () => { const p = (await DB.all("plants"))[0]; return [p.schedules.rotate.on, p.schedules.water.on]; });
  assert.deepEqual(on, [true, false]);
  await ctx.close();
});

test("toxic species show the child-safety warning on the plant page and in the guide", { skip }, async () => {
  const { ctx, page } = await phone();
  await addPlant(page, "Monty", "monstera-deliciosa");
  assert.match(await page.textContent(".callout.warn"), /Keep away from kids/);
  await page.goto(base + "/#/guide/monstera-deliciosa"); await page.waitForSelector(".detail-head h2");
  assert.match(await page.textContent(".callout.warn"), /Poison Control/);
  await ctx.close();
});

test("a garden of 100 plants restores and renders within a few seconds", { skip }, async () => {
  const { ctx, page } = await phone();
  const jpeg = "data:image/jpeg;base64," + fs.readFileSync(PHOTO).toString("base64");
  const big = { plants: [], events: [], photos: [] };
  for (let i = 0; i < 100; i++) {
    big.photos.push({ id: "ph" + i, full: jpeg, thumb: jpeg });
    big.plants.push({ id: "p" + i, nickname: "Plant " + String(i).padStart(3, "0"), speciesId: "epipremnum-aureum", photoId: "ph" + i, potDiameterCm: 15 });
    for (let k = 0; k < 10; k++) big.events.push({ id: `e${i}-${k}`, plantId: "p" + i, type: "care", kind: "water", at: Date.now() - k * 864e5 });
  }
  await restore(page, big);
  const t0 = Date.now();
  await page.goto(base + "/#/garden"); await page.reload();
  await page.waitForFunction(() => document.querySelectorAll(".tile .tile-photo img").length === 100);
  assert.ok(Date.now() - t0 < 5000, `garden took ${Date.now() - t0} ms`);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await ctx.close();
});

test("a slow weather check doesn't repaint the garden over another screen", { skip }, async () => {
  const { ctx, page } = await phone({ weather: async (route) => { await new Promise((r) => setTimeout(r, 800)); route.abort(); } });
  await restore(page, { plants: [{ id: "p-1", nickname: "Pothy" }], settings: { location: { lat: 40.12, lon: -100.46, label: "Test" } } });
  await page.goto(base + "/#/garden"); await page.click("#wxBtn");
  await page.click('.tabbar a[data-tab="settings"]'); await page.waitForSelector("#exportBtn");
  await page.waitForTimeout(1500);
  assert.ok(await page.$("#exportBtn"), "Settings is still on screen");
  await ctx.close();
});
