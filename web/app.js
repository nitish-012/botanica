/* Botanica web app — offline plant care.
 * All data lives in this browser's IndexedDB on the phone. Nothing is sent anywhere.
 */
"use strict";

/* ---------- Icons ---------- */
const I = {
  leaf: '<svg viewBox="0 0 24 24"><path d="M12 21c0-6 0-9 0-12M12 9C12 5 9 3 5 3c0 4 3 6 7 6zM12 13c0-4 3-6 7-6 0 4-3 6-7 6z"/></svg>',
  drop: '<svg viewBox="0 0 24 24"><path d="M12 3s6 6.5 6 11a6 6 0 01-12 0c0-4.5 6-11 6-11z"/></svg>',
  feed: '<svg viewBox="0 0 24 24"><path d="M5 20c8 0 14-6 14-15C10 5 5 10 5 17v3zM5 20l7-7"/></svg>',
  mist: '<svg viewBox="0 0 24 24"><path d="M4 14h12M6 18h12M8 10h12M10 6h6"/></svg>',
  repot: '<svg viewBox="0 0 24 24"><path d="M5 10h14l-2 10H7L5 10zM8 10V7a4 4 0 018 0v3"/></svg>',
  note: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4"/></svg>',
  camera: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/></svg>',
  temp: '<svg viewBox="0 0 24 24"><path d="M14 14V5a2 2 0 00-4 0v9a4 4 0 104 0z"/></svg>',
  soil: '<svg viewBox="0 0 24 24"><path d="M3 18h18M5 14h14M8 10h8"/></svg>',
  alert: '<svg viewBox="0 0 24 24"><path d="M12 3l9 16H3L12 3zM12 10v4M12 17v.5"/></svg>',
  bug: '<svg viewBox="0 0 24 24"><rect x="8" y="7" width="8" height="12" rx="4"/><path d="M12 7V4M4 12h4M16 12h4M5 7l3 2M19 7l-3 2M5 18l3-2M19 18l-3-2"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" class="chev"><path d="M9 6l6 6-6 6"/></svg>',
  group: '<svg viewBox="0 0 24 24"><circle cx="8" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><path d="M3 19c1-3 3-4 5-4s4 1 5 4M11 19c1-3 3-4 5-4s4 1 5 4"/></svg>',
  scissors: '<svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.5 8.5L20 20M8.5 15.5L20 4"/></svg>',
  rotate: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>',
  home: '<svg viewBox="0 0 24 24"><path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/></svg>',
  shop: '<svg viewBox="0 0 24 24"><path d="M5 8h14l-1 12H6L5 8zM9 8a3 3 0 016 0"/></svg>'
};
const APP_VERSION = "0.2"; // the build id shown beside it is read from the service worker cache name

const CARE = {
  water:     { label: "Water",     short: "Water", past: "Watered",    icon: I.drop,  def: 7 },
  fertilize: { label: "Fertilize", short: "Feed",  past: "Fertilized", icon: I.feed,  def: 30 },
  mist:      { label: "Mist / humidity check", short: "Mist", past: "Misted", icon: I.mist, def: 3 },
  repot:     { label: "Repot",     short: "Repot", past: "Repotted",   icon: I.repot, def: 540 },
  prune:     { label: "Prune",     short: "Prune", past: "Pruned",     icon: I.scissors, def: 90 },
  rotate:    { label: "Rotate",    short: "Turn",  past: "Rotated",    icon: I.rotate, def: 14 }
};
const LIGHT = { low: "Low light", indirect: "Bright indirect", direct: "Direct sun" };
const POT = { plastic: "Plastic", terracotta: "Terracotta", glazedCeramic: "Glazed ceramic", selfWatering: "Self-watering", other: "Other" };

/* ---------- Small helpers ---------- */
const $ = (s, el = document) => el.querySelector(s);
const C = self.BotanicaCore;
const { esc, startOfDay, addDays, daysUntil, isDormant, interval } = C;
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const fmtDate = (t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: new Date(t).getFullYear() !== new Date().getFullYear() ? "numeric" : undefined });
const fmtWhen = (t) => {
  const d = daysUntil(t);
  if (d === 0) return "Today";
  if (d === -1) return "Yesterday";
  if (d === 1) return "Tomorrow";
  if (d < 0) return `${-d} days ago`;
  return `In ${d} days`;
};

/** Short message at the bottom. `action` adds a button (e.g. Undo) and keeps the toast up longer. */
function toast(msg, action) {
  const t = $("#toast");
  t.textContent = msg;
  if (action) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "toast-btn";
    b.textContent = action.label;
    b.onclick = () => { t.classList.remove("show"); action.fn(); };
    t.append(" ", b);
  }
  t.classList.add("show");
  clearTimeout(toast._h);
  toast._h = setTimeout(() => t.classList.remove("show"), action ? 6000 : 2200);
}

/* ---------- Storage (IndexedDB) ---------- */
const DB = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      let req;
      try { req = indexedDB.open("botanica", 2); } catch (e) { return rej(e); }
      req.onupgradeneeded = (e) => {
        const db = req.result;
        if (e.oldVersion < 1) {
          db.createObjectStore("plants", { keyPath: "id" });
          const ev = db.createObjectStore("events", { keyPath: "id" });
          ev.createIndex("plantId", "plantId");
          db.createObjectStore("photos", { keyPath: "id" });
        }
        if (e.oldVersion < 2) db.createObjectStore("settings", { keyPath: "key" });
      };
      req.onsuccess = () => { this.db = req.result; res(this.db); };
      req.onerror = () => rej(req.error);
    });
  },
  async tx(store, mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let out;
      Promise.resolve(fn(s)).then((v) => { out = v; });
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  },
  req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  all(store) { return this.tx(store, "readonly", (s) => this.req(s.getAll())); },
  get(store, id) { return this.tx(store, "readonly", (s) => this.req(s.get(id))); },
  put(store, v) { return this.tx(store, "readwrite", (s) => { s.put(v); }); },
  del(store, id) { return this.tx(store, "readwrite", (s) => { s.delete(id); }); },
  eventsFor(plantId) { return this.tx("events", "readonly", (s) => this.req(s.index("plantId").getAll(plantId))); },
  async setting(key) { const r = await this.get("settings", key); return r ? r.value : null; },
  saveSetting(key, value) { return value == null ? this.del("settings", key) : this.put("settings", { key, value }); }
};

/* ---------- Photos ---------- */
async function downscale(file, max, quality) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch { bmp = await createImageBitmap(file); }
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.getContext("2d").drawImage(bmp, 0, 0, w, h);
  bmp.close && bmp.close();
  // Re-encoding through a canvas drops EXIF metadata, including GPS location.
  return new Promise((res) => c.toBlob(res, "image/jpeg", quality));
}

async function savePhoto(file) {
  const id = uid();
  const [full, thumb] = await Promise.all([downscale(file, 1600, 0.82), downscale(file, 480, 0.75)]);
  await DB.put("photos", { id, full, thumb, createdAt: Date.now() });
  return id;
}

const urlCache = new Map();
async function photoURL(id, kind = "thumb") {
  if (!id) return null;
  const key = id + kind;
  if (urlCache.has(key)) return urlCache.get(key);
  const p = await DB.get("photos", id);
  if (!p) return null;
  const url = URL.createObjectURL(p[kind] || p.full);
  urlCache.set(key, url);
  return url;
}
async function deletePhoto(id) {
  if (!id) return;
  ["thumb", "full"].forEach((k) => { const u = urlCache.get(id + k); if (u) { URL.revokeObjectURL(u); urlCache.delete(id + k); } });
  await DB.del("photos", id);
}

/* ---------- Care guide ---------- */
// Public care guide (shipped with the app) + private profiles that arrive only in your own backup file.
let GUIDE = { plants: [], databaseVersion: "?" };
let PUBLIC_PROFILES = [];
async function loadGuide() {
  try {
    const r = await fetch("plants_database.json", { cache: "no-cache" });
    const db = await r.json();
    PUBLIC_PROFILES = Array.isArray(db.plants) ? db.plants : [];
    GUIDE = { ...db, plants: PUBLIC_PROFILES };
  } catch (e) {
    console.warn("Care guide unavailable", e);
  }
  await mergePrivateProfiles();
}
async function mergePrivateProfiles() {
  const mine = (await DB.setting("profiles")) || [];
  GUIDE.plants = C.mergeProfiles(PUBLIC_PROFILES, mine);
}
const profile = (id) => GUIDE.plants.find((p) => p.id === id);

/* ---------- Plant logic (pure rules live in core.js) ---------- */
const newSchedules = (prof) => C.newSchedules(prof);
const fertilizePaused = (plant) => C.fertilizePaused(profile(plant.speciesId));
const activeSchedules = (plant) => C.activeSchedules(plant, profile(plant.speciesId));

function status(plant) {
  const s = C.status(plant, profile(plant.speciesId));
  if (s.level === "late") return { level: "late", text: `${CARE[s.kind].label} overdue` };
  if (s.level === "due") return { level: "due", text: s.kind === "water" ? "Needs water today" : `${CARE[s.kind].label} today` };
  return { level: "ok", text: "Healthy" };
}

/** Water per session, in ml, from pot size, species and season. */
function waterML(plant) {
  const w = C.waterML(plant, profile(plant.speciesId));
  if (!w) return null;
  const how = { custom: "Your custom amount", winter: "Winter amount (plants drink less Nov–Feb)", growing: "Growing-season amount" }[w.source];
  return { ml: w.ml, how };
}

/* ---------- Data actions ---------- */
async function logCare(plant, kind, extra = {}) {
  const now = Date.now();
  const before = plant.schedules[kind];
  // Remember the schedule as it was, so an accidental tap can be undone exactly.
  const event = { id: uid(), plantId: plant.id, type: "care", kind, at: now, ...extra,
    prevLast: before ? before.last : null, prevNext: before ? before.next : null };
  if (before) plant.schedules[kind] = C.markDone(before, now);
  plant.updatedAt = now;
  await DB.put("plants", plant);
  await DB.put("events", event);
  return event;
}

/** Deletes one journal or care entry; a care entry also rolls its schedule back. */
async function deleteEvent(plantId, eventId) {
  const plant = await DB.get("plants", plantId);
  const event = await DB.get("events", eventId);
  if (!plant || !event || event.plantId !== plantId) return;
  if (event.type === "care" && plant.schedules[event.kind]) {
    const rest = (await DB.eventsFor(plantId)).filter((e) => e.id !== eventId);
    plant.schedules[event.kind] = C.undoCare(plant.schedules[event.kind], event, rest);
    plant.updatedAt = Date.now();
    await DB.put("plants", plant);
  }
  if (event.photoId) await deletePhoto(event.photoId);
  await DB.del("events", eventId);
}

async function deletePlant(plant) {
  const events = await DB.eventsFor(plant.id);
  for (const e of events) { if (e.photoId) await deletePhoto(e.photoId); await DB.del("events", e.id); }
  await deletePhoto(plant.photoId);
  await DB.del("plants", plant.id);
}

/* ---------- Router ---------- */
const view = () => $("#view");
const state = { filter: "all", query: "" };

function setChrome({ title, back = false, action = null, tab }) {
  $("#title").textContent = title;
  document.title = title === "My Garden" ? "Botanica" : `${title} · Botanica`;
  $("#backBtn").hidden = !back;
  const a = $("#actionBtn");
  a.hidden = !action;
  a.onclick = action ? action.fn : null;
  if (action) { a.innerHTML = action.icon; a.setAttribute("aria-label", action.label); a.classList.toggle("primary", !!action.primary); }
  document.querySelectorAll(".tabbar a").forEach((el) => el.classList.toggle("active", el.dataset.tab === tab));
}

const currentPage = () => (location.hash.replace(/^#\/?/, "") || "garden").split(/[/?]/)[0];

async function route() {
  const hash = location.hash.replace(/^#\/?/, "") || "garden";
  const [path, qs] = hash.split("?");
  const parts = path.split("/");
  const params = new URLSearchParams(qs || "");
  window.scrollTo(0, 0);
  try {
    if (parts[0] === "garden") await renderGarden();
    else if (parts[0] === "plant" && parts[1]) await renderPlant(parts[1]);
    else if (parts[0] === "edit") await renderEdit(parts[1], params.get("species"));
    else if (parts[0] === "guide" && parts[1]) await renderProfile(parts[1]);
    else if (parts[0] === "guide") await renderGuide();
    else if (parts[0] === "settings") await renderSettings();
    else location.hash = "#/garden";
  } catch (e) {
    console.error(e);
    view().innerHTML = `<div class="empty"><h2>Something went wrong</h2><p>${esc(e.message || e)}</p><a class="btn" href="#/garden">Back to garden</a></div>`;
  }
}

$("#backBtn").addEventListener("click", () => (history.length > 1 ? history.back() : (location.hash = "#/garden")));
window.addEventListener("hashchange", route);

/* ---------- Garden (home): what needs attention first, as dense tiles ---------- */
const KID_RISK = (prof) => prof && prof.toxicity.children !== "none";

function chipHTML(plant, item) {
  const water = item.kind === "water" ? waterML(plant) : null;
  const level = item.days < 0 ? "late" : item.days === 0 ? "due" : "soon";
  const text = item.days > 0 ? `${item.days}d` : water ? `${water.ml} ml` : CARE[item.kind].short;
  const say = item.days < 0 ? `${CARE[item.kind].label}, ${-item.days} days late` : item.days === 0 ? `${CARE[item.kind].label} today` : `${CARE[item.kind].label} in ${item.days} days`;
  return `<span class="chip ${level}" title="${esc(say)}" aria-label="${esc(say)}">${CARE[item.kind].icon}${esc(text)}</span>`;
}

function tileHTML({ p, s, items }) {
  const prof = profile(p.speciesId);
  const due = items.filter((x) => x.days <= 0);
  const chips = due.length ? due.slice(0, 3).map((x) => chipHTML(p, x)).join("") + (due.length > 3 ? `<span class="chip more">+${due.length - 3}</span>` : "")
    : items.length ? chipHTML(p, items[0]) : "";
  return `
    <a class="tile ${esc(s.level)}" href="#/plant/${esc(p.id)}" aria-label="${esc(p.nickname)}: ${esc(s.text)}">
      <div class="tile-photo" data-photo="${esc(p.photoId || "")}">${I.leaf}</div>
      ${KID_RISK(prof) ? `<span class="tile-kid" title="Keep away from kids">${I.alert}</span>` : ""}
      ${prof ? "" : `<span class="tile-kid nog" title="No care guide on this phone">?</span>`}
      <div class="tile-name">${esc(p.nickname)}</div>
      <div class="chips">${chips}</div>
    </a>`;
}

async function renderGarden() {
  setChrome({ title: "My Garden", tab: "garden", action: { icon: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>', label: "Add plant", primary: true, fn: () => (location.hash = "#/edit") } });
  const plants = (await DB.all("plants")).sort((a, b) => a.nickname.localeCompare(b.nickname, undefined, { numeric: true }));
  if (!plants.length) {
    view().innerHTML = `
      <div class="empty">
        <div class="art">${I.leaf}</div>
        <h2>Your garden is empty</h2>
        <p>Add your first plant from a photo, or pick one from the care guide.</p>
        <div class="stack narrow">
          <a class="btn primary" href="#/edit">${I.camera} Add a plant</a>
          <a class="btn" href="#/guide">Browse the care guide</a>
        </div>
      </div>`;
    return;
  }
  const all = plants.map((p) => ({ p, s: status(p), items: C.careItems(p, profile(p.speciesId)) }));
  const rooms = [...new Set(plants.map((p) => p.room).filter(Boolean))].sort();
  let list = all;
  if (state.filter.startsWith("room:")) list = all.filter((x) => x.p.room === state.filter.slice(5));
  const rank = { late: 0, due: 1, ok: 2 };
  const urgency = (x) => (x.items.length ? x.items[0].days : 999);
  list.sort((a, b) => rank[a.s.level] - rank[b.s.level] || urgency(a) - urgency(b));
  const need = list.filter((x) => x.s.level !== "ok");
  const fine = list.filter((x) => x.s.level === "ok");
  const lateN = need.filter((x) => x.s.level === "late").length;

  const pill = (key, label, n) => `<button class="pill ${state.filter === key ? "on" : ""}" data-f="${esc(key)}">${esc(label)}${n != null ? `<span class="n">${n}</span>` : ""}</button>`;
  const outlook = await outlookHTML(plants);
  view().innerHTML = `
    <div class="pills">
      ${pill("all", "All rooms", plants.length)}
      ${rooms.map((r) => pill("room:" + r, r)).join("")}
    </div>
    <h3 class="sec-h" id="needH">Needs attention <span class="n">${need.length}</span>${lateN ? ` <span class="badge late">${lateN} late</span>` : ""}</h3>
    ${need.length ? `<div class="tiles" id="needTiles">${need.map(tileHTML).join("")}</div>`
      : `<p class="muted all-done">${I.leaf} Nothing needs you today.</p>`}
    ${fine.length ? `<h3 class="sec-h">All good <span class="n">${fine.length}</span></h3>
    <div class="tiles" id="okTiles">${fine.map(tileHTML).join("")}</div>` : ""}
    <p class="small muted legend"><span class="chip late">${I.drop}late</span> <span class="chip due">${I.drop}today</span> <span class="chip soon">${I.drop}3d</span> next care · <span class="legend-kid">${I.alert}</span> keep away from kids</p>
    ${outlook}`;
  view().querySelectorAll(".pill").forEach((b) => b.addEventListener("click", () => { state.filter = b.dataset.f; renderGarden(); }));
  const wx = $("#wxBtn");
  if (wx) wx.addEventListener("click", () => checkWeather(wx));
  const more = $("#wxMore");
  if (more) more.addEventListener("click", () => { $("#outlook").classList.add("open"); more.remove(); });
  hydratePhotos();
}

/* ---------- Weather & climate outlook ----------
 * The ONLY outside connection the app ever makes: the U.S. National Weather Service public API,
 * and only when the user taps "Check weather". It receives the location rounded to ~1 km.
 * No cookies, no referrer, no other data. All advice is computed here, on the phone.
 */
const WEATHER_ORIGIN = "https://api.weather.gov";
const NWS_FETCH = Object.freeze({ method: "GET", mode: "cors", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", redirect: "error", headers: { Accept: "application/geo+json" } });
const FORECAST_MAX_AGE = 24 * 3600 * 1000;

async function weatherJSON(url) {
  if (typeof url !== "string" || !url.startsWith(WEATHER_ORIGIN + "/")) throw new Error("Blocked: that isn't the weather service.");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, { ...NWS_FETCH, signal: ctl.signal });
    if (!r.ok) throw new Error(`The weather service answered ${r.status}.`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

async function checkWeather(btn) {
  const loc = await DB.setting("location");
  if (!loc) { location.hash = "#/settings"; return; }
  btn.disabled = true;
  btn.textContent = "Checking…";
  try {
    const point = await weatherJSON(`${WEATHER_ORIGIN}/points/${C.roundCoord(loc.lat)},${C.roundCoord(loc.lon)}`);
    const hourlyUrl = point && point.properties && point.properties.forecastHourly;
    const days = C.summarizeDays(C.parseNwsHourly(await weatherJSON(hourlyUrl)));
    if (!days.length) throw new Error("No forecast available right now.");
    await DB.saveSetting("forecast", { fetchedAt: Date.now(), lat: loc.lat, lon: loc.lon, days });
    toast("Weather updated");
  } catch (e) {
    toast(e.name === "AbortError" ? "The weather service took too long. Try again later." : (e.message || "Couldn't reach the weather service."));
  }
  // Only repaint if the garden is still on screen; the user may have moved on while it loaded.
  if (currentPage() === "garden") renderGarden();
}

const TIP_ICON = { heat: I.sun, cold: I.temp, frost: I.temp, dry: I.mist, gloomy: I.drop, calm: I.leaf,
  "short-days": I.sun, growing: I.leaf, "hot-season": I.sun, "cool-nights": I.temp };

function ago(t) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

async function outlookHTML(plants) {
  const [loc, climate, forecast] = await Promise.all([DB.setting("location"), DB.setting("climate"), DB.setting("forecast")]);
  const fresh = forecast && loc && forecast.lat === loc.lat && forecast.lon === loc.lon && Date.now() - forecast.fetchedAt < FORECAST_MAX_AGE;
  const tips = [
    ...(fresh ? C.weatherAdvice(forecast.days.filter((d) => d.date >= todayKey()), plants, profile) : []),
    ...C.climateAdvice({ month: new Date().getMonth() + 1, lat: loc ? loc.lat : NaN, climate, plants, profileOf: profile })
  ];
  const source = fresh ? `Forecast: U.S. National Weather Service · ${esc(ago(forecast.fetchedAt))}`
    : loc ? "Tap Check weather for this week's forecast." : "Add your location in Settings to get weather tips.";
  const button = loc
    ? `<button class="btn small" id="wxBtn">${I.sun} Check weather</button>`
    : `<a class="btn small" href="#/settings">Set location</a>`;
  return `
    <section class="outlook" id="outlook">
      <div class="outlook-head"><h3>Care outlook</h3>${button}</div>
      ${tips.length ? `<ul class="tips-list">${tips.map((t, i) => `
        <li class="tip ${esc(t.level)}${i > 0 ? " extra" : ""}">
          <span class="tip-ico">${TIP_ICON[t.id] || I.leaf}</span>
          <div><b>${esc(t.title)}</b><span>${esc(t.detail)}</span></div>
        </li>`).join("")}</ul>` : ""}
      ${tips.length > 1 ? `<button class="link-btn" id="wxMore">Show ${tips.length - 1} more</button>` : ""}
      <p class="small muted">${source}</p>
    </section>`;
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function hydratePhotos(root = view()) {
  for (const el of root.querySelectorAll("[data-photo]")) {
    const id = el.dataset.photo;
    if (!id) continue;
    const url = await photoURL(id, el.dataset.kind || "thumb");
    if (url) el.innerHTML = `<img src="${url}" alt="">`;
  }
}

/* ---------- Plant detail ---------- */
async function renderPlant(id) {
  const plant = await DB.get("plants", id);
  if (!plant) { location.hash = "#/garden"; return; }
  const prof = profile(plant.speciesId);
  setChrome({ title: plant.nickname, back: true, tab: "garden", action: { icon: I.edit, label: "Edit plant", fn: () => (location.hash = `#/edit/${plant.id}`) } });
  const s = status(plant);
  const water = waterML(plant);
  const events = (await DB.eventsFor(plant.id)).sort((a, b) => b.at - a.at);
  const scheds = activeSchedules(plant);
  const resumes = C.fertilizeResumes(prof);
  const restRow = resumes && plant.schedules.fertilize && plant.schedules.fertilize.on ? `
          <div class="row">
            <div class="ico">${CARE.fertilize.icon}</div>
            <div class="txt"><b>Fertilize</b><span>Winter rest: no feeding until ${fmtDate(resumes)}, then every ${plant.schedules.fertilize.every} days</span></div>
            <div class="end"><span class="badge ok">Resting</span></div>
          </div>` : "";
  view().innerHTML = `
    <div class="hero" data-photo="${esc(plant.photoId || "")}" data-kind="full">${I.leaf}</div>
    <div class="detail-head">
      <h2>${esc(plant.nickname)}</h2>
      <div class="sub">${esc(plant.speciesName || "Unknown species")}${plant.room ? " · " + esc(plant.room) : ""}</div>
      <div class="mt-s"><span class="badge ${esc(s.level)}">${esc(s.text)}</span></div>
    </div>

    <div class="actions">
      <button class="action water" data-act="water">${I.drop}Water now<small>${water ? "~" + water.ml + " ml" : "Set pot size"}</small></button>
      <button class="action" data-act="fertilize">${I.feed}Fertilize<small>${fertilizePaused(plant) ? "Winter rest" : "Choose feed"}</small></button>
      <button class="action" data-act="note">${I.camera}Note / photo<small>Growth journal</small></button>
    </div>

    ${water ? `
    <div class="callout info mt">${I.drop}<p><b>${water.ml} ml</b> per watering. ${esc(water.how)}.${prof ? " " + esc(prof.water.checkBeforeWatering) : " Check that the top few cm of soil are dry first."}</p></div>` : ""}

    ${plant.speciesId && !prof ? `
    <div class="callout warn mt">${I.alert}<p><b>Care guide missing on this phone.</b> Open Settings and restore your plant file again to add it.</p></div>` : ""}

    ${prof && prof.toxicity.children !== "none" ? `
    <div class="callout warn mt">${I.alert}<p><b>Keep away from kids.</b> ${esc(prof.toxicity.notes)}</p></div>` : ""}

    <div class="section">
      <h3>Care schedule</h3>
      <div class="panel">
        ${scheds.length ? scheds.map((c) => `
          <div class="row">
            <div class="ico">${CARE[c.kind].icon}</div>
            <div class="txt"><b>${CARE[c.kind].label}</b><span>Every ${interval(c)} days${c.last ? " · last " + fmtDate(c.last) : ""}</span></div>
            <div class="end">${daysUntil(c.next) < 0 ? `<span class="badge late">${-daysUntil(c.next)}d late</span>` : esc(fmtWhen(c.next))}</div>
          </div>`).join("") + restRow : restRow || `<div class="row"><div class="txt muted">No care reminders turned on. Edit the plant to add some.</div></div>`}
      </div>
    </div>

    ${prof ? careInfo(prof) : ""}

    <div class="section">
      <h3>Care &amp; growth journal</h3>
      <div class="panel">
        <ul class="timeline">
          ${events.length ? events.map((e) => `
            <li>
              <div class="dot">${e.type === "care" ? CARE[e.kind].icon : I.note}</div>
              <button class="icon-btn del-ev" data-ev="${esc(e.id)}" aria-label="Delete this entry">${I.trash}</button>
              <div class="grow">
                <div><b>${e.type === "care" ? CARE[e.kind].past : "Journal"}</b>${e.amountMl ? ` · ${e.amountMl} ml` : ""}</div>
                <div class="when">${fmtDate(e.at)} · ${new Date(e.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div>
                ${e.text ? `<div class="note">${esc(e.text)}</div>` : ""}
                ${e.photoId ? `<div data-photo="${esc(e.photoId)}" data-kind="full"></div>` : ""}
              </div>
            </li>`).join("") : `<li class="muted">Nothing logged yet. Tap “Water now” after you water.</li>`}
        </ul>
      </div>
    </div>
    <div class="spacer"></div>`;

  view().querySelector('[data-act="water"]').onclick = () => quickLog(plant, "water", water);
  view().querySelector('[data-act="fertilize"]').onclick = () => feedSheet(plant, prof);
  view().querySelectorAll(".del-ev").forEach((b) => (b.onclick = () => confirmDeleteEvent(plant, events.find((e) => e.id === b.dataset.ev))));
  view().querySelector('[data-act="note"]').onclick = () => noteSheet(plant);
  hydratePhotos();
}

function careInfo(p) {
  const level = (v) => ({ none: "Non-toxic", mild: "Mildly toxic", moderate: "Toxic", severe: "Highly toxic" }[v] || v);
  const months = (arr) => arr.map((m) => new Date(2000, m - 1, 1).toLocaleString(undefined, { month: "short" })).join(", ");
  return `
    <div class="section">
      <h3>How to care for it</h3>
      <div class="panel">
        <div class="row"><div class="ico">${I.sun}</div><div class="txt"><b>${esc(LIGHT[p.light.ideal])}</b><span>${esc(p.light.notes)}</span></div></div>
        <div class="row"><div class="ico">${I.drop}</div><div class="txt"><b>Water every ${p.water.intervalDaysGrowing} days (${p.water.intervalDaysDormant} in winter)</b><span>${esc(p.water.method)}</span></div></div>
        <div class="row"><div class="ico">${I.mist}</div><div class="txt"><b>${esc(p.humidity.level[0].toUpperCase() + p.humidity.level.slice(1))} humidity · ${p.humidity.idealMinPercent}%+</b><span>${esc(p.humidity.notes)}</span></div></div>
        <div class="row"><div class="ico">${I.temp}</div><div class="txt"><b>${p.temperature.idealMinC}–${p.temperature.idealMaxC} °C</b><span>Not below ${p.temperature.minC} °C. ${esc(p.temperature.notes)}</span></div></div>
        <div class="row"><div class="ico">${I.soil}</div><div class="txt"><b>Soil</b><span>${esc(p.soil.mix)} ${esc(p.soil.drainage)}</span></div></div>
        <div class="row"><div class="ico">${I.feed}</div><div class="txt"><b>Fertilize every ${p.fertilizer.intervalDaysGrowing} days</b><span>${p.fertilizer.pauseMonths.length ? `Rest (no feeding) in ${months(p.fertilizer.pauseMonths)}. ` : "All year. "}${esc(p.fertilizer.notes)} Options below.</span></div></div>
        <div class="row"><div class="ico">${I.repot}</div><div class="txt"><b>Repot every ~${p.repotting.everyMonths} months</b><span>Best in ${months(p.repotting.bestMonths)}. ${esc(p.repotting.notes)}</span></div></div>
        <div class="row"><div class="ico">${I.scissors}</div><div class="txt"><b>Pruning</b><span>${esc(p.pruning.how)}</span></div></div>
        <div class="row"><div class="ico">${I.group}</div><div class="txt"><b>Keep with</b><span>${esc(p.companions.notes)}</span></div></div>
      </div>
    </div>

    ${feedHTML(p)}

    <div class="section">
      <h3>Best growth tips</h3>
      <div class="panel"><ul class="tips">${p.growthTips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>
    </div>

    <div class="section">
      <h3>Problems &amp; fixes</h3>
      <div class="panel">
        ${p.problems.map((x) => `
          <div class="row top">
            <div class="ico">${I.alert}</div>
            <div class="txt"><b>${esc(x.symptom)}</b><span>${esc(x.fix)}</span></div>
            <span class="badge ${x.severity === "high" ? "late" : x.severity === "medium" ? "warn" : "ok"}">${esc(x.severity)}</span>
          </div>`).join("")}
      </div>
    </div>

    <div class="section">
      <h3>Pests</h3>
      <div class="panel">
        ${p.pests.map((x) => `<div class="row top"><div class="ico">${I.bug}</div><div class="txt"><b>${esc(x.name)}</b><span>${esc(x.signs)} <br><b class="inline">Treat:</b> ${esc(x.treatment)}</span></div></div>`).join("")}
      </div>
    </div>

    <div class="section">
      <h3>Safety</h3>
      <div class="panel"><dl class="kv">
        <dt>Children</dt><dd>${esc(level(p.toxicity.children))}</dd>
        <dt>Pets</dt><dd>${esc(level(p.toxicity.pets))}</dd>
        <dt>Why</dt><dd>${esc(p.toxicity.compound)}</dd>
      </dl></div>
    </div>`;
}

/** Fertilizer options: homemade first (preferred), then store-bought. */
function feedHTML(p) {
  const f = p.fertilizer;
  const item = (x) => `<div class="row top"><div class="ico">${I.leaf}</div><div class="txt"><b>${esc(x.name)}</b><span>${esc(x.how)}${x.caution ? `<br><i class="caution">${esc(x.caution)}</i>` : ""}</span></div></div>`;
  return `
    <div class="section">
      <h3>Fertilizer options</h3>
      <div class="panel">
        <div class="row group-h"><div class="ico">${I.home}</div><div class="txt"><b>Homemade (preferred)</b></div></div>
        ${f.homemade.length ? f.homemade.map(item).join("") : `<div class="row"><div class="txt muted">No reliable homemade feed for this plant. Use the store-bought option.</div></div>`}
        <div class="row group-h"><div class="ico">${I.shop}</div><div class="txt"><b>Store-bought</b></div></div>
        ${f.storeBought.length ? f.storeBought.map(item).join("") : `<div class="row"><div class="txt">${esc(f.type || "Balanced liquid houseplant fertilizer")}${f.dilution ? ", " + esc(f.dilution.toLowerCase()) : ""}.</div></div>`}
      </div>
    </div>`;
}

async function quickLog(plant, kind, water, extra = {}) {
  const amountMl = kind === "water" && water ? water.ml : undefined;
  const ev = await logCare(plant, kind, { ...extra, ...(amountMl ? { amountMl } : {}) });
  renderPlant(plant.id);
  toast(`${CARE[kind].past} ${plant.nickname}${amountMl ? ` · ${amountMl} ml` : ""}`, {
    label: "Undo",
    fn: async () => { await deleteEvent(plant.id, ev.id); toast("Undone"); route(); }
  });
}

function feedSheet(plant, prof) {
  const f = prof ? prof.fertilizer : { homemade: [], storeBought: [] };
  const resumes = C.fertilizeResumes(prof);
  const opt = (name, group, i) => `<label class="opt"><input type="radio" name="feed" value="${esc(name)}" ${i === 0 ? "checked" : ""}><span><b>${esc(name)}</b><small>${esc(group)}</small></span></label>`;
  const names = [...f.homemade.map((x) => [x.name, "Homemade"]), ...f.storeBought.map((x) => [x.name, "Store-bought"]), ["Something else", ""]];
  const el = sheet(`
    <h3>What did you feed ${esc(plant.nickname)}?</h3>
    ${resumes ? `<p class="small muted">It's the winter rest: feeding isn't needed until ${esc(fmtDate(resumes))}.</p>` : ""}
    <form id="feedForm">
      <div class="opts">${names.map(([n, g], i) => opt(n, g, i)).join("")}</div>
      <div class="row-btns"><button type="button" class="btn" id="feedCancel">Cancel</button><button class="btn primary" type="submit">Log feed</button></div>
    </form>`);
  $("#feedCancel", el).onclick = () => el.remove();
  $("#feedForm", el).onsubmit = async (e) => {
    e.preventDefault();
    const name = e.target.feed.value;
    el.remove();
    await quickLog(plant, "fertilize", null, name && name !== "Something else" ? { text: name } : {});
  };
}

function confirmDeleteEvent(plant, ev) {
  if (!ev) return;
  const what = ev.type === "care" ? `“${CARE[ev.kind].past}” on ${fmtDate(ev.at)}` : `this journal entry from ${fmtDate(ev.at)}`;
  const el = sheet(`<h3>Delete ${esc(what)}?</h3>
    <p class="muted">${ev.type === "care" ? "The care schedule goes back to how it was before this entry." : "Its note and photo will be removed from this phone."}</p>
    <div class="row-btns"><button class="btn" id="evKeep">Keep</button><button class="btn danger" id="evDel">Delete</button></div>`);
  $("#evKeep", el).onclick = () => el.remove();
  $("#evDel", el).onclick = async () => { await deleteEvent(plant.id, ev.id); el.remove(); toast("Entry deleted"); renderPlant(plant.id); };
}

function sheet(html) {
  const back = document.createElement("div");
  back.className = "sheet-backdrop";
  back.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  back.addEventListener("click", (e) => { if (e.target === back) back.remove(); });
  document.body.appendChild(back);
  return back;
}

function noteSheet(plant) {
  const el = sheet(`
    <h3>Journal entry</h3>
    <form id="noteForm">
      <div class="field"><textarea name="text" placeholder="New leaf unfurling, moved closer to the window…"></textarea></div>
      <div class="photo-pick">
        <div class="preview" id="notePrev">${I.camera}</div>
        <div class="btns">
          <span class="btn file-btn">${I.camera} Take photo<input type="file" accept="image/*" capture="environment" name="cam"></span>
          <span class="btn file-btn">Choose from library<input type="file" accept="image/*" name="lib"></span>
        </div>
      </div>
      <div class="row-btns"><button type="button" class="btn" id="noteCancel">Cancel</button><button class="btn primary" type="submit">Save</button></div>
    </form>`);
  let file = null;
  const onPick = (e) => {
    file = e.target.files[0] || null;
    if (file) $("#notePrev", el).innerHTML = `<img src="${URL.createObjectURL(file)}" alt="">`;
  };
  el.querySelectorAll("input[type=file]").forEach((i) => i.addEventListener("change", onPick));
  $("#noteCancel", el).onclick = () => el.remove();
  $("#noteForm", el).onsubmit = async (e) => {
    e.preventDefault();
    const text = e.target.text.value.trim();
    if (!text && !file) { el.remove(); return; }
    e.target.querySelector("[type=submit]").disabled = true;
    const photoId = file ? await savePhoto(file) : null;
    await DB.put("events", { id: uid(), plantId: plant.id, type: "journal", at: Date.now(), text, photoId });
    el.remove();
    toast("Added to journal");
    renderPlant(plant.id);
  };
}

/* ---------- Add / edit ---------- */
async function renderEdit(id, speciesFromGuide) {
  const existing = id ? await DB.get("plants", id) : null;
  const prof0 = profile(existing ? existing.speciesId : speciesFromGuide);
  const p = existing || {
    id: uid(), nickname: prof0 ? prof0.commonName : "", speciesId: prof0 ? prof0.id : "", speciesName: prof0 ? prof0.commonName : "",
    room: "", light: prof0 ? prof0.light.ideal : "indirect", acquired: "", notes: "",
    potDiameterCm: "", potMaterial: "plastic", drainage: true, waterOverrideMl: "",
    photoId: null, schedules: newSchedules(prof0), createdAt: Date.now()
  };
  setChrome({ title: existing ? "Edit plant" : "Add plant", back: true, tab: "garden" });
  const plants = await DB.all("plants");
  const rooms = [...new Set(["Living Room", "Kitchen", "Bedroom", "Balcony", "Office", ...plants.map((x) => x.room).filter(Boolean)])];

  view().innerHTML = `
    <form id="plantForm" autocomplete="off">
      <div class="photo-pick">
        <div class="preview" id="prev" data-photo="${esc(p.photoId || "")}">${I.leaf}</div>
        <div class="btns">
          <span class="btn file-btn">${I.camera} Take photo<input type="file" accept="image/*" capture="environment" name="cam"></span>
          <span class="btn file-btn">Choose from library<input type="file" accept="image/*" name="lib"></span>
        </div>
      </div>

      <div class="field"><label for="nick">Nickname</label><input id="nick" name="nickname" required placeholder="e.g. Kitchen pothos" value="${esc(p.nickname)}"></div>

      <div class="field"><label for="species">Species</label>
        <select id="species" name="speciesId">
          <option value="">Not sure / not in guide</option>
          ${GUIDE.plants.map((g) => `<option value="${esc(g.id)}" ${g.id === p.speciesId ? "selected" : ""}>${esc(g.commonName)} (${esc(g.scientificName)})</option>`).join("")}
        </select>
        <span class="hint">Choosing a species fills in its watering, feeding and care guide.</span>
      </div>

      <div class="field"><label for="room">Room</label>
        <input id="room" name="room" list="roomList" placeholder="Living Room" value="${esc(p.room)}">
        <datalist id="roomList">${rooms.map((r) => `<option value="${esc(r)}">`).join("")}</datalist>
      </div>

      <div class="field"><span class="label">Light where it sits</span>
        <div class="seg">${Object.entries(LIGHT).map(([k, v]) => `<label><input type="radio" name="light" value="${k}" ${p.light === k ? "checked" : ""}><span>${{ low: "Low", indirect: "Indirect", direct: "Direct sun" }[k]}</span></label>`).join("")}</div>
      </div>

      <div class="two">
        <div class="field"><label for="pot">Pot width (cm)</label><input id="pot" name="potDiameterCm" type="number" inputmode="decimal" min="4" max="80" step="0.5" placeholder="15" value="${esc(p.potDiameterCm)}"></div>
        <div class="field"><label for="mat">Pot type</label>
          <select id="mat" name="potMaterial">${Object.entries(POT).map(([k, v]) => `<option value="${k}" ${p.potMaterial === k ? "selected" : ""}>${v}</option>`).join("")}</select>
        </div>
      </div>
      <div class="callout info" id="mlPreview" hidden></div>

      <div class="two">
        <div class="field"><label for="ovr">Custom water (ml)</label><input id="ovr" name="waterOverrideMl" type="number" inputmode="numeric" min="0" step="25" placeholder="Auto" value="${esc(p.waterOverrideMl || "")}"></div>
        <div class="field"><label for="acq">Got it on</label><input id="acq" name="acquired" type="date" value="${esc(p.acquired)}"></div>
      </div>

      <div class="field"><span class="label">Care schedule</span>
        <div class="panel" id="scheds">
          ${Object.keys(CARE).map((k) => schedRow(k, p.schedules[k])).join("")}
        </div>
      </div>

      <div class="field"><label for="notes">Notes</label><textarea id="notes" name="notes" placeholder="Anything worth remembering">${esc(p.notes)}</textarea></div>

      <button class="btn primary block" type="submit">${existing ? "Save changes" : "Add to my garden"}</button>
      ${existing ? `<button class="btn danger block" type="button" id="delBtn">Delete plant</button>` : ""}
    </form>`;
  hydratePhotos();

  const form = $("#plantForm");
  let file = null;
  form.querySelectorAll("input[type=file]").forEach((inp) => inp.addEventListener("change", (e) => {
    file = e.target.files[0] || null;
    if (file) $("#prev").innerHTML = `<img src="${URL.createObjectURL(file)}" alt="">`;
  }));

  const previewMl = () => {
    const draft = { ...p, speciesId: form.speciesId.value, potDiameterCm: form.potDiameterCm.value, potMaterial: form.potMaterial.value, waterOverrideMl: Number(form.waterOverrideMl.value) || null };
    const w = waterML(draft);
    const box = $("#mlPreview");
    box.hidden = !w;
    if (w) box.innerHTML = `${I.drop}<p><b>${w.ml} ml</b> per watering · ${esc(w.how)}</p>`;
  };
  ["potDiameterCm", "potMaterial", "waterOverrideMl"].forEach((n) => form[n].addEventListener("input", previewMl));
  previewMl();

  form.speciesId.addEventListener("change", () => {
    const prof = profile(form.speciesId.value);
    if (!prof) { previewMl(); return; }
    if (!form.nickname.value.trim()) form.nickname.value = prof.commonName;
    form.querySelector(`input[name=light][value=${prof.light.ideal}]`).checked = true;
    if (!existing) {
      p.schedules = newSchedules(prof);
      $("#scheds").innerHTML = Object.keys(CARE).map((k) => schedRow(k, p.schedules[k])).join("");
    }
    previewMl();
  });

  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector("[type=submit]");
    btn.disabled = true;
    const prof = profile(form.speciesId.value);
    p.nickname = form.nickname.value.trim() || (prof ? prof.commonName : "My plant");
    p.speciesId = form.speciesId.value;
    p.speciesName = prof ? prof.commonName : "";
    p.room = form.room.value.trim();
    p.light = form.light.value;
    p.acquired = form.acquired.value;
    p.notes = form.notes.value.trim();
    p.potDiameterCm = Number(form.potDiameterCm.value) || "";
    p.potMaterial = form.potMaterial.value;
    p.waterOverrideMl = Number(form.waterOverrideMl.value) || "";
    for (const k of Object.keys(CARE)) {
      const on = form[`on_${k}`].checked;
      const every = Math.max(1, Number(form[`every_${k}`].value) || CARE[k].def);
      const s = p.schedules[k] || { last: null, next: startOfDay() };
      const changed = s.every !== every;
      const turnedOn = on && !s.on;
      s.on = on; s.every = every;
      if (turnedOn && !s.last) s.next = ["repot", "prune", "rotate"].includes(k) ? addDays(Date.now(), every) : startOfDay();
      if (k === "water" && prof && changed) s.winterEvery = Math.round(every * prof.water.intervalDaysDormant / prof.water.intervalDaysGrowing);
      if (k === "water" && !prof) s.winterEvery = null;
      if (changed && s.last) s.next = addDays(s.last, interval(s));
      p.schedules[k] = s;
    }
    if (file) {
      const old = p.photoId;
      p.photoId = await savePhoto(file);
      if (old) await deletePhoto(old);
    }
    p.updatedAt = Date.now();
    await DB.put("plants", p);
    toast(existing ? "Saved" : `${p.nickname} added`);
    location.replace(`#/plant/${p.id}`);
  };

  if (existing) $("#delBtn").onclick = () => {
    const el = sheet(`<h3>Delete ${esc(p.nickname)}?</h3><p class="muted">Its photos, care history and journal will be removed from this phone. This can’t be undone.</p>
      <div class="row-btns"><button class="btn" id="c">Keep</button><button class="btn danger" id="d">Delete</button></div>`);
    $("#c", el).onclick = () => el.remove();
    $("#d", el).onclick = async () => { await deletePlant(p); el.remove(); toast("Plant deleted"); location.replace("#/garden"); };
  };
}

function schedRow(k, s) {
  s = s || { on: false, every: CARE[k].def };
  return `
    <div class="sched">
      <div class="ico sm">${CARE[k].icon}</div>
      <span class="lbl">${CARE[k].label.replace(" / humidity check", "")}</span>
      <span class="unit">every</span>
      <input type="number" name="every_${k}" min="1" max="999" inputmode="numeric" value="${s.every}" aria-label="${CARE[k].label} every how many days">
      <span class="unit">d</span>
      <label class="switch"><input type="checkbox" name="on_${k}" ${s.on ? "checked" : ""} aria-label="${CARE[k].label} on"><span></span></label>
    </div>`;
}

/* ---------- Guide ---------- */
async function renderGuide() {
  setChrome({ title: "Care Guide", tab: "guide" });
  // Only the species in your garden are listed (all species stay available when adding a plant).
  const mine = new Set((await DB.all("plants")).map((p) => p.speciesId).filter(Boolean));
  const list = mine.size ? GUIDE.plants.filter((p) => mine.has(p.id)) : GUIDE.plants;
  const missing = [...mine].filter((id) => !profile(id)).length;
  view().innerHTML = `
    ${missing ? `<div class="callout warn">${I.alert}<p><b>${missing} kind${missing > 1 ? "s" : ""} of plant in your garden ${missing > 1 ? "have" : "has"} no care guide on this phone.</b> Open Settings and restore your plant file again.</p></div>` : ""}
    <div class="search">${I.search}<input type="search" id="q" placeholder="Search ${list.length} plants" value="${esc(state.query)}" autocomplete="off"></div>
    <div class="panel" id="results"></div>
    <p class="small muted mt">${mine.size ? `The ${list.length} kinds of plant in your garden.` : `Care guide version ${esc(GUIDE.databaseVersion)}.`} Stored on this phone, works offline.</p>`;
  const draw = () => {
    const q = state.query.toLowerCase().trim();
    const hits = list.filter((p) => !q || [p.commonName, p.scientificName, ...p.aliases].some((n) => n.toLowerCase().includes(q)));
    $("#results").innerHTML = hits.map((p) => `
      <a class="row" href="#/guide/${esc(p.id)}">
        <div class="ico">${I.leaf}</div>
        <div class="txt"><b>${esc(p.commonName)}</b><span><i>${esc(p.scientificName)}</i> · ${esc(LIGHT[p.light.ideal])}</span></div>
        <span class="diff muted">${esc(p.difficulty)}</span>${I.chevron}
      </a>`).join("") || `<div class="row muted">No plants match “${esc(state.query)}”.</div>`;
  };
  $("#q").addEventListener("input", (e) => { state.query = e.target.value; draw(); });
  draw();
}

async function renderProfile(id) {
  const p = profile(id);
  if (!p) { location.hash = "#/guide"; return; }
  setChrome({ title: p.commonName, back: true, tab: "guide" });
  view().innerHTML = `
    <div class="detail-head">
      <h2>${esc(p.commonName)}</h2>
      <div class="sub"><i>${esc(p.scientificName)}</i>${p.aliases.length ? " · also called " + esc(p.aliases.join(", ")) : ""}</div>
    </div>
    <p>${esc(p.summary)}</p>
    <a class="btn primary block" href="#/edit?species=${encodeURIComponent(p.id)}">Add to my garden</a>
    ${p.toxicity.children !== "none" ? `<div class="callout warn mt">${I.alert}<p><b>Keep away from kids.</b> ${esc(p.toxicity.notes)}</p></div>` : ""}
    ${careInfo(p)}
    <div class="spacer"></div>`;
}

/* ---------- Settings ---------- */
async function renderSettings() {
  setChrome({ title: "Settings", tab: "settings" });
  const plants = await DB.all("plants");
  let usage = "";
  try { const e = await navigator.storage.estimate(); usage = `${(e.usage / 1048576).toFixed(1)} MB used on this phone`; } catch {}
  let persisted = false;
  try { persisted = await navigator.storage.persisted(); } catch {}
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const [loc, climate] = await Promise.all([DB.setting("location"), DB.setting("climate")]);

  view().innerHTML = `
    ${standalone ? "" : `<div class="callout info">${I.alert}<p><b>Install Botanica:</b> in Safari tap the Share button, then <b>Add to Home Screen</b>. It then opens full-screen and works with no internet.</p></div>`}
    <div class="section">
      <h3>Your data</h3>
      <div class="panel">
        <div class="row"><div class="ico">${I.leaf}</div><div class="txt"><b>${plants.length} plant${plants.length === 1 ? "" : "s"}</b><span>${esc(usage || "Stored only on this phone")}</span></div></div>
        <div class="row"><div class="ico">${I.alert}</div><div class="txt"><b>${persisted ? "Protected storage" : "Back up now and then"}</b><span>${persisted ? "The phone won't clear Botanica's data to free space." : "Removing Botanica from the home screen deletes its data. Export a backup to keep it safe."}</span></div></div>
      </div>
      <div class="stack mt">
        <button class="btn block" id="exportBtn">Export backup</button>
        <span class="btn block file-btn">Restore from backup<input type="file" accept="application/json,.json" id="importInput"></span>
      </div>
    </div>
    <div class="section">
      <h3>Weather</h3>
      <div class="panel">
        <div class="row"><div class="ico">${I.sun}</div><div class="txt"><b>${loc ? esc(loc.label) : "No location set"}</b><span id="locText">${loc ? `${loc.lat.toFixed(2)}, ${loc.lon.toFixed(2)} (rounded to about 1 km)` : "Needed for weather tips"}</span></div></div>
        <div class="row"><div class="ico">${I.leaf}</div><div class="txt"><b>Local climate calendar</b><span>${climate ? esc(climate.label || "Loaded") : "Not loaded yet. It comes with your plant file."}</span></div></div>
      </div>
      <div class="stack mt">
        <button class="btn block" id="geoBtn">Use my current location</button>
        <button class="btn block" id="locManual">Enter location manually</button>
        ${loc ? `<button class="btn block danger" id="locClear">Remove location</button>` : ""}
      </div>
      <p class="small muted mt">Weather comes only from the U.S. National Weather Service (api.weather.gov), and only when you tap “Check weather”. It receives your location rounded to about 1 km, nothing else. All advice is worked out on this phone.</p>
    </div>
    <div class="section">
      <h3>About</h3>
      <div class="panel"><dl class="kv">
        <dt>Version</dt><dd id="appVersion">${esc(APP_VERSION)}</dd>
        <dt>Care guide</dt><dd>${esc(GUIDE.databaseVersion)} · ${GUIDE.plants.length} species</dd>
        <dt>Privacy</dt><dd>No accounts, no tracking, no cloud. Everything stays on this phone.</dd>
      </dl></div>
    </div>`;

  // Show which build this phone is running (the cache name holds the content hash of the app files).
  try { const key = (await caches.keys()).find((k) => k.startsWith("botanica-")); if (key) $("#appVersion").textContent = `${APP_VERSION} (build ${key.slice(9)})`; } catch {}
  $("#exportBtn").onclick = exportBackup;
  $("#importInput").onchange = (e) => e.target.files[0] && importBackup(e.target.files[0]);
  $("#geoBtn").onclick = useMyLocation;
  $("#locManual").onclick = () => locationSheet(loc);
  if (loc) $("#locClear").onclick = async () => { await DB.saveSetting("location", null); await DB.saveSetting("forecast", null); toast("Location removed"); renderSettings(); };
}

async function saveLocation(raw) {
  const loc = C.cleanLocation(raw);
  if (!loc) { toast("That location doesn't look right."); return false; }
  await DB.saveSetting("location", loc);
  await DB.saveSetting("forecast", null);
  toast(`Location saved: ${loc.label}`);
  renderSettings();
  return true;
}

function useMyLocation() {
  if (!navigator.geolocation) { toast("Location isn't available on this device."); return; }
  navigator.geolocation.getCurrentPosition(
    (pos) => saveLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude, label: "Home" }),
    () => toast("Couldn't get your location. Enter it manually instead."),
    { enableHighAccuracy: false, maximumAge: 3600000, timeout: 15000 }
  );
}

function locationSheet(loc) {
  const el = sheet(`
    <h3>Location for weather</h3>
    <form id="locForm">
      <div class="field"><label for="locLabel">Name</label><input id="locLabel" name="label" maxlength="40" value="${esc(loc ? loc.label : "Home")}"></div>
      <div class="two">
        <div class="field"><label for="locLat">Latitude</label><input id="locLat" name="lat" inputmode="text" autocapitalize="off" autocorrect="off" pattern="-?[0-9]{1,2}([.][0-9]+)?" required value="${loc ? loc.lat : ""}" placeholder="40.71"></div>
        <div class="field"><label for="locLon">Longitude</label><input id="locLon" name="lon" inputmode="text" autocapitalize="off" autocorrect="off" pattern="-?[0-9]{1,3}([.][0-9]+)?" required value="${loc ? loc.lon : ""}" placeholder="-74.01"></div>
      </div>
      <p class="small muted">Stored only on this phone, rounded to about 1 km.</p>
      <div class="row-btns"><button type="button" class="btn" id="locCancel">Cancel</button><button class="btn primary" type="submit">Save</button></div>
    </form>`);
  $("#locCancel", el).onclick = () => el.remove();
  $("#locForm", el).onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    if (await saveLocation({ lat: f.lat.value, lon: f.lon.value, label: f.label.value })) el.remove();
  };
}

const blobToDataURL = (b) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(b); });
const dataURLToBlob = (u) => new Blob([C.dataURLToBytes(u)], { type: "image/jpeg" });
const MAX_BACKUP_BYTES = 200 * 1024 * 1024;

async function exportBackup() {
  const [plants, events, photos] = await Promise.all([DB.all("plants"), DB.all("events"), DB.all("photos")]);
  const [loc, climate] = await Promise.all([DB.setting("location"), DB.setting("climate")]);
  const settings = {};
  if (loc) settings.location = loc;
  if (climate) settings.climate = climate;
  const profiles = (await DB.setting("profiles")) || [];
  const out = { app: "botanica", version: 1, exportedAt: new Date().toISOString(), plants, events, photos: [], settings, profiles };
  for (const p of photos) out.photos.push({ id: p.id, createdAt: p.createdAt, full: await blobToDataURL(p.full), thumb: await blobToDataURL(p.thumb) });
  const blob = new Blob([JSON.stringify(out)], { type: "application/json" });
  const name = `botanica-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([blob], name, { type: "application/json" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: "Botanica backup" }); return; } catch (e) { if (e.name === "AbortError") return; }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function importBackup(file) {
  try {
    if (file.size > MAX_BACKUP_BYTES) throw new Error("Backup file is too large.");
    let raw;
    try { raw = JSON.parse(await file.text()); } catch { throw new Error("This isn't a Botanica backup."); }
    const data = C.validateBackup(raw); // untrusted input: sanitized before anything is stored
    for (const p of data.photos) await DB.put("photos", { id: p.id, createdAt: p.createdAt, full: dataURLToBlob(p.full), thumb: dataURLToBlob(p.thumb) });
    for (const e of data.events) await DB.put("events", e);
    for (const p of data.plants) await DB.put("plants", p);
    if (data.settings.location) await DB.saveSetting("location", data.settings.location);
    if (data.settings.climate) await DB.saveSetting("climate", data.settings.climate);
    if (data.profiles.length) {
      const byId = new Map(((await DB.setting("profiles")) || []).map((p) => [p.id, p]));
      for (const p of data.profiles) byId.set(p.id, p);
      await DB.saveSetting("profiles", [...byId.values()]);
      await mergePrivateProfiles();
    }
    const extra = Object.keys(data.settings).length || data.profiles.length ? " and your settings" : "";
    toast(`Restored ${data.plants.length} plant${data.plants.length === 1 ? "" : "s"}${extra}`);
    location.hash = "#/garden";
  } catch (e) {
    toast(e.message || "Restore failed");
  }
}

/* ---------- Boot ---------- */
(async function boot() {
  // Refuse to run inside another site's frame (clickjacking protection).
  if (window.top !== window.self) { document.body.textContent = "Botanica can only be opened directly."; return; }
  try { await DB.open(); }
  catch (e) {
    view().innerHTML = `<div class="empty"><h2>Storage unavailable</h2><p>This browser blocked on-device storage (private browsing?). Open Botanica in normal Safari.</p></div>`;
    return;
  }
  await loadGuide();
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch {}
  if ("serviceWorker" in navigator) {
    // A new version installs in the background and takes over at once; reload once so it's used.
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
    try { navigator.serviceWorker.register("sw.js").then((r) => r.update()).catch(() => {}); } catch {}
  }
  route();
})();
