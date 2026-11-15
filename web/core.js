/* Botanica core logic: pure functions with no DOM, storage or network access.
 * Loaded by the app in the browser and by the unit tests in Node.
 */
(function (root) {
  "use strict";

  const DAY = 86400000;
  const DORMANT_MONTHS = [11, 12, 1, 2];
  const CARE_KINDS = ["water", "fertilize", "mist", "repot", "prune", "rotate"];
  const DEFAULT_INTERVAL = { water: 7, fertilize: 30, mist: 3, repot: 540, prune: 90, rotate: 14 };
  const FUTURE_START = ["repot", "prune", "rotate"]; // first due one interval from now, not today
  const LIGHTS = ["low", "indirect", "direct"];
  const POT_MATERIALS = ["plastic", "terracotta", "glazedCeramic", "selfWatering", "other"];
  const POT_FACTOR = { terracotta: 1.15, selfWatering: 0.8 };

  /* ---- Dates (all "due" dates are local midnight) ---- */
  function startOfDay(t = Date.now()) { const x = new Date(t); x.setHours(0, 0, 0, 0); return x.getTime(); }
  function addDays(t, n) { const x = new Date(startOfDay(t)); x.setDate(x.getDate() + n); return x.getTime(); }
  function daysUntil(t, now = Date.now()) { return Math.round((startOfDay(t) - startOfDay(now)) / DAY); }
  function isDormant(t = Date.now()) { return DORMANT_MONTHS.includes(new Date(t).getMonth() + 1); }

  /* ---- HTML escaping: every user-provided string goes through this ---- */
  function esc(v) {
    return String(v ?? "").replace(/[&<>"'`]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" }[c]));
  }

  /* ---- Schedules ---- */
  function newSchedules(prof, now = Date.now()) {
    const s = {};
    for (const k of CARE_KINDS) {
      s[k] = { on: false, every: DEFAULT_INTERVAL[k], winterEvery: null, last: null,
               next: FUTURE_START.includes(k) ? addDays(now, DEFAULT_INTERVAL[k]) : startOfDay(now) };
    }
    s.water.on = true;
    if (prof) {
      s.water.every = prof.water.intervalDaysGrowing;
      s.water.winterEvery = prof.water.intervalDaysDormant;
      s.fertilize.on = true;
      s.fertilize.every = prof.fertilizer.intervalDaysGrowing;
      s.mist.on = !!prof.humidity.misting;
      s.repot.every = Math.round(prof.repotting.everyMonths * 30.4);
      s.repot.next = addDays(now, s.repot.every);
      s.prune.on = !!prof.pruning.needed;
      s.prune.next = addDays(now, s.prune.every);
    }
    return s;
  }

  function interval(sch, t = Date.now()) {
    return isDormant(t) && sch.winterEvery ? sch.winterEvery : sch.every;
  }

  function fertilizePaused(prof, t = Date.now()) {
    return !!prof && prof.fertilizer.pauseMonths.includes(new Date(t).getMonth() + 1);
  }

  function activeSchedules(plant, prof, now = Date.now()) {
    return Object.entries(plant.schedules || {})
      .filter(([k, s]) => s && s.on && !(k === "fertilize" && fertilizePaused(prof, now)))
      .map(([k, s]) => Object.assign({ kind: k }, s))
      .sort((a, b) => a.next - b.next);
  }

  /** Records a care action: returns the updated schedule (does not mutate input). */
  function markDone(sch, now = Date.now()) {
    return Object.assign({}, sch, { last: now, next: addDays(now, interval(sch, now)) });
  }

  /** First day fertilizing may resume after a pause (null if not paused now). */
  function fertilizeResumes(prof, t = Date.now()) {
    if (!fertilizePaused(prof, t)) return null;
    const d = new Date(startOfDay(t));
    for (let i = 0; i < 13; i++) {
      d.setDate(1); d.setMonth(d.getMonth() + 1);
      if (!prof.fertilizer.pauseMonths.includes(d.getMonth() + 1)) return d.getTime();
    }
    return null;
  }

  /**
   * Undoes one logged care event (e.g. an accidental tap). Only changes the schedule when the
   * event is the one that set its "last" date. Uses the snapshot saved with the event when there
   * is one; otherwise falls back to the latest remaining event of the same kind.
   */
  function undoCare(sch, event, remaining = [], now = Date.now()) {
    if (!sch || !event || event.type !== "care" || sch.last !== event.at) return sch;
    if (event.prevNext) return Object.assign({}, sch, { last: event.prevLast || null, next: event.prevNext });
    const prev = remaining.filter((e) => e.type === "care" && e.kind === event.kind && e.id !== event.id)
      .reduce((m, e) => (m && m.at > e.at ? m : e), null);
    if (prev) return Object.assign({}, sch, { last: prev.at, next: addDays(prev.at, interval(sch, prev.at)) });
    return Object.assign({}, sch, { last: null, next: startOfDay(now) });
  }

  /** Every active care item with days until due (negative = late), most urgent first. */
  function careItems(plant, prof, now = Date.now()) {
    return activeSchedules(plant, prof, now).map((s) => ({ kind: s.kind, days: daysUntil(s.next, now), next: s.next }));
  }

  /** Dashboard status: late (overdue) > due (today) > ok. */
  function status(plant, prof, now = Date.now()) {
    // Compare calendar days, not timestamps: a due date restored from a backup, or saved in another
    // time zone, is not exactly local midnight here.
    let dueKind = null;
    for (const s of activeSchedules(plant, prof, now)) {
      const d = daysUntil(s.next, now);
      if (d < 0) return { level: "late", kind: s.kind };
      if (d === 0 && !dueKind) dueKind = s.kind;
    }
    if (dueKind) return { level: "due", kind: dueKind };
    return { level: "ok", kind: null };
  }

  /* ---- Water amount in ml ---- */
  function waterML(plant, prof, now = Date.now()) {
    const override = Number(plant.waterOverrideMl);
    if (override > 0) return { ml: Math.round(override), source: "custom" };
    const d = Number(plant.potDiameterCm);
    if (!(d > 0)) return null;
    const fraction = prof ? prof.water.fractionOfPotVolume : 0.22;
    const r = d / 2, h = d * 0.9;
    const soilMl = Math.PI * r * r * h * 0.85; // tapered pot, soil below the rim
    let ml = soilMl * fraction * (POT_FACTOR[plant.potMaterial] || 1);
    const dormant = isDormant(now);
    if (dormant) ml *= 0.8;
    ml = Math.max(25, Math.round(ml / 25) * 25);
    return { ml, source: dormant ? "winter" : "growing" };
  }

  /* ---- Backup validation (a restored file is untrusted input) ---- */
  const MAX_BACKUP_PLANTS = 500;
  const MAX_TEXT = 4000;
  const ID_RE = /^[A-Za-z0-9-]{1,64}$/;
  const PHOTO_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;

  const isId = (v) => typeof v === "string" && ID_RE.test(v); // regex.test() alone would coerce ["x"] or 7 to a string
  function cleanText(v, max = 200) { return typeof v === "string" ? v.slice(0, max) : ""; }
  function cleanNum(v, min, max) { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? n : ""; }
  function cleanTime(v) { const n = Number(v); return Number.isFinite(n) && n > 0 && n < 4102444800000 ? n : null; }

  function cleanSchedules(raw, now) {
    const base = newSchedules(null, now);
    for (const k of CARE_KINDS) {
      const s = raw && raw[k];
      if (!s || typeof s !== "object") continue;
      base[k] = {
        on: s.on === true,
        every: cleanNum(s.every, 1, 999) || base[k].every,
        winterEvery: cleanNum(s.winterEvery, 1, 999) || null,
        last: cleanTime(s.last),
        next: cleanTime(s.next) || base[k].next
      };
    }
    return base;
  }

  /* ---- Care profiles delivered in a private backup (untrusted input: strict schema) ---- */
  const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  const DIFFICULTY = ["easy", "moderate", "hard"];
  const HUMIDITY = ["low", "medium", "high"];
  const TOXICITY = ["none", "mild", "moderate", "severe"];
  const SEVERITY = ["low", "medium", "high"];
  const pStr = (v, max = 600) => (typeof v === "string" && v.trim() ? v.slice(0, max) : null);
  const pStrs = (a, n = 12, max = 300) => (Array.isArray(a) ? a.map((x) => pStr(x, max)).filter(Boolean).slice(0, n) : []);
  const pSlugs = (a, n = 12) => (Array.isArray(a) ? a.filter((x) => typeof x === "string" && x.length <= 64 && SLUG_RE.test(x)).slice(0, n) : []);
  const pMonths = (a) => (Array.isArray(a) ? [...new Set(a.map(Number).filter((m) => Number.isInteger(m) && m >= 1 && m <= 12))] : []);
  const pNum = (v, min, max) => { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? n : null; };
  const obj = (v) => (v && typeof v === "object" ? v : {});
  /** Fertilizer options: [{ name, how, caution? }], at most 6. */
  const pFerts = (a) => (Array.isArray(a) ? a.slice(0, 6).map((x) => {
    x = obj(x);
    const name = pStr(x.name, 80), how = pStr(x.how, 400);
    if (!name || !how) return null;
    const caution = pStr(x.caution, 300);
    return caution ? { name, how, caution } : { name, how };
  }).filter(Boolean) : []);

  /** Returns a sanitized profile with exactly the known fields, or null if anything essential is wrong. */
  function cleanProfile(p) {
    if (!p || typeof p !== "object" || typeof p.id !== "string" || p.id.length > 64 || !SLUG_RE.test(p.id)) return null;
    const need = (v) => { if (v === null || v === undefined) throw new Error("missing"); return v; };
    try {
      const L = obj(p.light), W = obj(p.water), H = obj(p.humidity), T = obj(p.temperature), S = obj(p.soil),
        F = obj(p.fertilizer), R = obj(p.repotting), P = obj(p.pruning), X = obj(p.toxicity), G = obj(p.companions);
      const out = {
        id: p.id,
        commonName: need(pStr(p.commonName, 80)),
        scientificName: need(pStr(p.scientificName, 120)),
        aliases: pStrs(p.aliases, 8, 60),
        family: pStr(p.family, 60) || "",
        difficulty: DIFFICULTY.includes(p.difficulty) ? p.difficulty : "moderate",
        summary: need(pStr(p.summary)),
        light: { ideal: need(LIGHTS.includes(L.ideal) ? L.ideal : null), tolerates: Array.isArray(L.tolerates) ? L.tolerates.filter((l) => LIGHTS.includes(l)) : [], notes: pStr(L.notes) || "" },
        water: {
          intervalDaysGrowing: need(pNum(W.intervalDaysGrowing, 1, 90)),
          intervalDaysDormant: need(pNum(W.intervalDaysDormant, 1, 120)),
          fractionOfPotVolume: need(pNum(W.fractionOfPotVolume, 0.03, 0.6)),
          checkBeforeWatering: pStr(W.checkBeforeWatering) || "",
          method: pStr(W.method) || "",
          signsOfOverwatering: pStrs(W.signsOfOverwatering),
          signsOfUnderwatering: pStrs(W.signsOfUnderwatering)
        },
        humidity: { level: HUMIDITY.includes(H.level) ? H.level : "medium", idealMinPercent: pNum(H.idealMinPercent, 0, 100) ?? 40, misting: H.misting === true, notes: pStr(H.notes) || "" },
        temperature: { minC: need(pNum(T.minC, -40, 40)), idealMinC: need(pNum(T.idealMinC, -30, 45)), idealMaxC: need(pNum(T.idealMaxC, -20, 50)), notes: pStr(T.notes) || "" },
        soil: { mix: pStr(S.mix) || "", drainage: pStr(S.drainage) || "" },
        fertilizer: { type: pStr(F.type, 200) || "", dilution: pStr(F.dilution, 100) || "", intervalDaysGrowing: pNum(F.intervalDaysGrowing, 7, 365) ?? 30, pauseMonths: pMonths(F.pauseMonths), notes: pStr(F.notes) || "",
          homemade: pFerts(F.homemade), storeBought: pFerts(F.storeBought) },
        repotting: { everyMonths: pNum(R.everyMonths, 1, 120) ?? 24, bestMonths: pMonths(R.bestMonths), potSizeStepCM: pNum(R.potSizeStepCM, 0, 30) ?? 5, signs: pStrs(R.signs), notes: pStr(R.notes) || "" },
        pruning: { needed: P.needed === true, bestMonths: pMonths(P.bestMonths), how: pStr(P.how) || "" },
        propagation: pStrs(p.propagation),
        growthTips: pStrs(p.growthTips),
        problems: (Array.isArray(p.problems) ? p.problems : []).slice(0, 15).map((x) => {
          x = obj(x);
          const id = typeof x.id === "string" && SLUG_RE.test(x.id) ? x.id : null;
          const symptom = pStr(x.symptom, 200), fix = pStr(x.fix);
          return id && symptom && fix ? { id, symptom, likelyCauses: pStrs(x.likelyCauses), fix, severity: SEVERITY.includes(x.severity) ? x.severity : "medium" } : null;
        }).filter(Boolean),
        pests: (Array.isArray(p.pests) ? p.pests : []).slice(0, 15).map((x) => {
          x = obj(x);
          const id = typeof x.id === "string" && SLUG_RE.test(x.id) ? x.id : null;
          const name = pStr(x.name, 80), signs = pStr(x.signs), treatment = pStr(x.treatment);
          return id && name && signs && treatment ? { id, name, signs, treatment, detectableOnDevice: x.detectableOnDevice === true } : null;
        }).filter(Boolean),
        toxicity: { children: need(TOXICITY.includes(X.children) ? X.children : null), pets: TOXICITY.includes(X.pets) ? X.pets : "mild", compound: pStr(X.compound, 200) || "", notes: pStr(X.notes) || "" },
        companions: { groupTags: pSlugs(G.groupTags), goodWith: pSlugs(G.goodWith), keepApartFrom: pSlugs(G.keepApartFrom), notes: pStr(G.notes) || "" }
      };
      const t = out.temperature;
      if (!(t.minC <= t.idealMinC && t.idealMinC < t.idealMaxC)) return null;
      return out;
    } catch {
      return null;
    }
  }

  /** Public guide + private profiles. A private profile may replace a public one, but it can never
   *  lower that species' toxicity rating or drop its safety note (kids live in this home). */
  function mergeProfiles(publicList, privateList) {
    const pub = new Map(publicList.map((p) => [p.id, p]));
    const mine = privateList.map((p) => {
      const base = pub.get(p.id);
      if (!base) return p;
      const worse = (a, b) => (TOXICITY.indexOf(a) >= TOXICITY.indexOf(b) ? a : b);
      const lowered = TOXICITY.indexOf(p.toxicity.children) < TOXICITY.indexOf(base.toxicity.children);
      return Object.assign({}, p, { toxicity: Object.assign({}, lowered ? base.toxicity : p.toxicity, {
        children: worse(p.toxicity.children, base.toxicity.children), pets: worse(p.toxicity.pets, base.toxicity.pets) }) });
    });
    const ids = new Set(mine.map((p) => p.id));
    return [...publicList.filter((p) => !ids.has(p.id)), ...mine].sort((a, b) => a.commonName.localeCompare(b.commonName));
  }

  /** Returns a sanitized copy of a backup, or throws with a readable message. */
  function validateBackup(data, now = Date.now()) {
    if (!data || typeof data !== "object" || data.app !== "botanica") throw new Error("This isn't a Botanica backup.");
    const plantsIn = Array.isArray(data.plants) ? data.plants : [];
    if (plantsIn.length > MAX_BACKUP_PLANTS) throw new Error("Backup has too many plants.");
    const photoIds = new Set();
    const photos = (Array.isArray(data.photos) ? data.photos : [])
      .filter((p) => p && isId(p.id) && typeof p.full === "string" && typeof p.thumb === "string" && PHOTO_RE.test(p.full) && PHOTO_RE.test(p.thumb))
      .map((p) => { photoIds.add(p.id); return { id: p.id, createdAt: cleanTime(p.createdAt) || now, full: p.full, thumb: p.thumb }; });
    const okPhoto = (id) => (typeof id === "string" && photoIds.has(id) ? id : null);
    const plants = plantsIn.filter((p) => p && isId(p.id)).map((p) => ({
      id: p.id,
      nickname: cleanText(p.nickname, 80) || "My plant",
      speciesId: typeof p.speciesId === "string" && /^[a-z0-9-]{0,64}$/.test(p.speciesId) ? p.speciesId : "",
      speciesName: cleanText(p.speciesName, 80),
      room: cleanText(p.room, 60),
      light: LIGHTS.includes(p.light) ? p.light : "indirect",
      acquired: typeof p.acquired === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.acquired) ? p.acquired : "",
      notes: cleanText(p.notes, MAX_TEXT),
      potDiameterCm: cleanNum(p.potDiameterCm, 1, 200),
      potMaterial: POT_MATERIALS.includes(p.potMaterial) ? p.potMaterial : "other",
      drainage: p.drainage !== false,
      waterOverrideMl: cleanNum(p.waterOverrideMl, 1, 20000),
      photoId: okPhoto(p.photoId),
      schedules: cleanSchedules(p.schedules, now),
      createdAt: cleanTime(p.createdAt) || now,
      updatedAt: cleanTime(p.updatedAt) || now
    }));
    const plantIds = new Set(plants.map((p) => p.id));
    const events = (Array.isArray(data.events) ? data.events : [])
      .filter((e) => e && isId(e.id) && plantIds.has(e.plantId) && (e.type === "care" || e.type === "journal"))
      .filter((e) => e.type !== "care" || CARE_KINDS.includes(e.kind))
      .map((e) => ({
        id: e.id, plantId: e.plantId, type: e.type,
        kind: e.type === "care" ? e.kind : undefined,
        at: cleanTime(e.at) || now,
        amountMl: cleanNum(e.amountMl, 1, 20000) || undefined,
        text: cleanText(e.text, MAX_TEXT),
        photoId: okPhoto(e.photoId),
        prevLast: cleanTime(e.prevLast),
        prevNext: cleanTime(e.prevNext)
      }));
    const settings = {};
    if (data.settings && typeof data.settings === "object") {
      const loc = cleanLocation(data.settings.location);
      if (loc) settings.location = loc;
      const cl = cleanClimate(data.settings.climate);
      if (cl) settings.climate = cl;
    }
    const profiles = (Array.isArray(data.profiles) ? data.profiles : []).slice(0, 100).map(cleanProfile).filter(Boolean);
    return { plants, events, photos, settings, profiles };
  }

  /* ---- Location & climate settings (validated like any other untrusted input) ---- */
  /** Rounds to 2 decimals (~1 km) so the weather service never sees a precise position. */
  function roundCoord(v) { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN; }

  function cleanLocation(loc) {
    if (!loc || typeof loc !== "object") return null;
    const lat = roundCoord(loc.lat), lon = roundCoord(loc.lon);
    if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) return null;
    return { lat, lon, label: cleanText(loc.label, 40).trim() || "Home" };
  }

  function cleanClimate(c) {
    if (!c || typeof c !== "object" || !Array.isArray(c.months) || c.months.length !== 12) return null;
    const months = c.months.map((m) => ({ highC: Number(m && m.highC), lowC: Number(m && m.lowC) }));
    const bad = months.some((m) => !Number.isFinite(m.highC) || !Number.isFinite(m.lowC) ||
      m.highC > 60 || m.lowC < -70 || m.lowC > m.highC);
    return bad ? null : { label: cleanText(c.label, 80), months };
  }

  /** Hours of daylight for a latitude and date (astronomical approximation, ±15 min). */
  function dayLengthHours(lat, t = Date.now()) {
    const d = new Date(t);
    const doy = Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / DAY);
    const decl = 23.44 * Math.sin((2 * Math.PI / 365) * (doy - 81)) * Math.PI / 180;
    const x = -Math.tan(lat * Math.PI / 180) * Math.tan(decl);
    if (x <= -1) return 24;
    if (x >= 1) return 0;
    return Math.round((2 * Math.acos(x) * 180 / Math.PI / 15) * 10) / 10;
  }

  /* ---- Weather: parse the National Weather Service hourly forecast and turn it into care advice ---- */
  function qv(v) {
    if (v && typeof v === "object") v = v.value;
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  const fToC = (f) => Math.round(((f - 32) * 5 / 9) * 10) / 10;
  function rhFromDewpoint(tC, dC) { const a = 17.625, b = 243.04; return 100 * Math.exp(a * dC / (b + dC) - a * tC / (b + tC)); }
  function classifySky(s) {
    s = String(s || "").toLowerCase();
    if (/rain|shower|drizzle|storm|snow|sleet/.test(s)) return "wet";
    if (/cloudy|overcast|fog/.test(s) && !/partly/.test(s)) return "cloudy";
    return "clear";
  }

  /** Converts NWS /forecast/hourly JSON into plain hourly records. Throws on unexpected shapes. */
  function parseNwsHourly(json) {
    const periods = json && json.properties && Array.isArray(json.properties.periods) ? json.properties.periods : null;
    if (!periods) throw new Error("The weather service sent unexpected data.");
    return periods.slice(0, 168).map((p) => {
      if (!p || typeof p !== "object") return null;
      const t = Date.parse(p.startTime);
      const temp = qv(p.temperature);
      if (temp === null || !Number.isFinite(t)) return null;
      const tempC = p.temperatureUnit === "C" ? temp : fToC(temp);
      let rh = qv(p.relativeHumidity);
      if (rh === null) {
        let dp = qv(p.dewpoint);
        if (dp !== null && p.dewpoint && /degF/.test(String(p.dewpoint.unitCode))) dp = fToC(dp);
        if (dp !== null) rh = rhFromDewpoint(tempC, dp);
      }
      const winds = typeof p.windSpeed === "string" ? (p.windSpeed.match(/\d+/g) || []).map(Number) : [];
      return {
        t, tempC,
        rh: rh === null ? null : Math.max(0, Math.min(100, Math.round(rh))),
        pop: qv(p.probabilityOfPrecipitation),
        windMph: winds.length ? Math.max(...winds) : null,
        isDay: p.isDaytime === true,
        sky: classifySky(cleanText(p.shortForecast, 80))
      };
    }).filter(Boolean);
  }

  const dateKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

  /** Groups hourly records into local days (max 7). */
  function summarizeDays(hours) {
    const byDay = new Map();
    for (const h of hours) {
      const k = dateKey(h.t);
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(h);
    }
    return [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).slice(0, 7).map(([date, hs]) => {
      const rhs = hs.map((h) => h.rh).filter((v) => v !== null);
      const pops = hs.map((h) => h.pop).filter((v) => v !== null);
      const day = hs.filter((h) => h.isDay);
      return {
        date,
        maxC: Math.max(...hs.map((h) => h.tempC)),
        minC: Math.min(...hs.map((h) => h.tempC)),
        minRH: rhs.length ? Math.min(...rhs) : null,
        maxPop: pops.length ? Math.max(...pops) : 0,
        dayHours: day.length,
        gloomyHours: day.filter((h) => h.sky !== "clear").length
      };
    });
  }

  function dayLabel(key) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }
  const listDays = (days) => days.map((d) => dayLabel(d.date)).join(", ");
  const names = (ps) => {
    const n = ps.map((p) => p.nickname);
    return n.length <= 1 ? n.join("") : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
  };
  const round0 = (x) => Math.round(x);

  // Plant groups used by both forecast and climate advice.
  function groups(plants, profileOf) {
    const prof = (p) => profileOf(p.speciesId) || null;
    return {
      windowSun: plants.filter((p) => p.light === "direct"),
      sunLovers: plants.filter((p) => p.light === "direct" || (prof(p) && prof(p).light.ideal === "direct")),
      tropical: plants.filter((p) => prof(p) && prof(p).temperature.idealMinC >= 16),
      humid: plants.filter((p) => prof(p) && (prof(p).humidity.level === "high" || prof(p).humidity.misting)),
      outdoor: plants.filter((p) => /balcony|patio|porch|deck|garden|outdoor|outside|yard/i.test(p.room || ""))
    };
  }

  /** Care advice for the coming days. Pure: same input → same advice. */
  function weatherAdvice(days, plants, profileOf) {
    const g = groups(plants, profileOf);
    const tips = [];
    const hot = days.filter((d) => d.maxC >= 30);
    if (hot.length) {
      tips.push({
        id: "heat", level: "warn",
        title: `Hot ${listDays(hot)}: up to ${round0(Math.max(...hot.map((d) => d.maxC)))}°C outside`,
        detail: "Soil dries faster, so check it a day early." +
          (g.windowSun.length ? ` Pull ${names(g.windowSun)} back from the sunny window in the afternoon.` : ""),
        plantIds: plants.map((p) => p.id)
      });
    }
    const cold = days.filter((d) => d.minC <= 7);
    if (cold.length && g.tropical.length) {
      tips.push({
        id: "cold", level: "warn",
        title: `Cold nights ${listDays(cold)}: down to ${round0(Math.min(...cold.map((d) => d.minC)))}°C`,
        detail: `Window glass gets much colder than the room. Move ${names(g.tropical)} at least 30 cm from the glass overnight, and away from heater vents.`,
        plantIds: g.tropical.map((p) => p.id)
      });
    }
    const frost = days.filter((d) => d.minC <= 1);
    if (frost.length && g.outdoor.length) {
      tips.push({
        id: "frost", level: "warn",
        title: `Frost risk ${listDays(frost)}`,
        detail: `Bring ${names(g.outdoor)} indoors for the night.`,
        plantIds: g.outdoor.map((p) => p.id)
      });
    }
    const dry = days.filter((d) => d.minRH !== null && d.minRH < 30);
    if (dry.length && g.humid.length) {
      tips.push({
        id: "dry", level: "warn",
        title: `Very dry air ${listDays(dry)}: humidity down to ${Math.min(...dry.map((d) => d.minRH))}%`,
        detail: `Leaf edges crisp quickly. ${g.humid.length > 1 ? `Group ${names(g.humid)} together` : `Keep ${names(g.humid)} close to other plants`}, or use a humidifier or a tray of wet pebbles. Misting only helps for an hour or two.`,
        plantIds: g.humid.map((p) => p.id)
      });
    }
    const gloomy = days.filter((d) => d.maxPop >= 60 || (d.dayHours > 0 && d.gloomyHours >= Math.max(4, d.dayHours * 0.6)));
    if (gloomy.length >= 2) {
      tips.push({
        id: "gloomy", level: "info",
        title: `Grey days ahead: ${listDays(gloomy)}`,
        detail: "Less light means soil dries slower, so water a little less and feel the soil first." +
          (g.sunLovers.length ? ` Use the grow lights to give ${names(g.sunLovers)} extra light.` : ""),
        plantIds: plants.map((p) => p.id)
      });
    }
    if (!tips.length) tips.push({ id: "calm", level: "ok", title: "No weather worries this week", detail: "Follow your normal care schedule.", plantIds: [] });
    return tips;
  }

  /** Offline advice from the month's typical climate and day length. */
  function climateAdvice({ month, lat, climate, plants, profileOf, now = Date.now() }) {
    const g = groups(plants, profileOf);
    const tips = [];
    const m = climate && climate.months[month - 1];
    const hours = Number.isFinite(lat) ? dayLengthHours(lat, now) : null;
    if (hours !== null && hours < 11) {
      tips.push({
        id: "short-days", level: "info",
        title: `Short days: about ${hours} h of daylight`,
        detail: "Growth slows and plants drink less, so always feel the soil before watering." +
          (g.sunLovers.length ? ` ${names(g.sunLovers)} need 12–14 hours of light, so switch on the grow lights for the rest of the day.` : ""),
        plantIds: plants.map((p) => p.id)
      });
    } else if (hours !== null && hours >= 13.5) {
      tips.push({
        id: "growing", level: "info",
        title: `Peak growing season: ${hours} h of daylight`,
        detail: "Feed on schedule. This is the best time to repot, prune and take cuttings.",
        plantIds: plants.map((p) => p.id)
      });
    }
    if (m && m.highC >= 27) {
      tips.push({
        id: "hot-season", level: "info",
        title: `Hot season: typical highs ${round0(m.highC)}°C`,
        detail: "Afternoon sun through west-facing glass can scorch leaves" +
          (g.windowSun.length ? `, so keep ${names(g.windowSun)} a little back from the window after 2 pm.` : ".") +
          " Check soil more often.",
        plantIds: g.windowSun.map((p) => p.id)
      });
    }
    if (m && m.lowC <= 8 && (g.tropical.length || g.humid.length)) {
      tips.push({
        id: "cool-nights", level: "info",
        title: `Cool nights: typical lows ${round0(m.lowC)}°C`,
        detail: (g.tropical.length ? `Keep ${names(g.tropical)} off cold window sills at night. ` : "") +
          (g.humid.length ? `Heaters dry the air, so ${names(g.humid)} will want extra humidity.` : ""),
        plantIds: [...new Set([...g.tropical, ...g.humid].map((p) => p.id))]
      });
    }
    return tips;
  }

  /** Decodes a base64 data URL locally (no network request), so the CSP can block all connections. */
  function dataURLToBytes(url) {
    const b64 = url.slice(url.indexOf(",") + 1);
    const bin = (typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary"));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  const api = {
    DAY, DORMANT_MONTHS, CARE_KINDS, DEFAULT_INTERVAL, LIGHTS, POT_MATERIALS, POT_FACTOR,
    startOfDay, addDays, daysUntil, isDormant, esc,
    newSchedules, interval, fertilizePaused, activeSchedules, markDone, status, waterML,
    validateBackup, mergeProfiles, dataURLToBytes,
    cleanProfile, fertilizeResumes, undoCare, careItems, roundCoord, cleanLocation, cleanClimate, dayLengthHours,
    parseNwsHourly, summarizeDays, weatherAdvice, climateAdvice
  };
  root.BotanicaCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);
