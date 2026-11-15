// Security & privacy checks over the whole repository. These run on every change and block publishing.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "../..");
const WEB = path.join(ROOT, "web");
const rel = (f) => path.relative(ROOT, f).split(path.sep).join("/");

function trackedFiles() {
  try {
    return execFileSync("git", ["ls-files", "-z"], { cwd: ROOT }).toString().split("\0").filter(Boolean);
  } catch {
    const out = [];
    (function walk(d) {
      for (const n of fs.readdirSync(d)) {
        if ([".git", "node_modules", "build"].includes(n)) continue;
        const f = path.join(d, n);
        fs.statSync(f).isDirectory() ? walk(f) : out.push(rel(f));
      }
    })(ROOT);
    return out;
  }
}
const FILES = trackedFiles().filter((f) => fs.existsSync(path.join(ROOT, f)));
const BINARY = /\.(png|jpe?g|gif|webp|heic|ico|pdf|zip|ipa)$/i;
const TEXT_FILES = FILES.filter((f) => !BINARY.test(f));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const webText = (exts) => fs.readdirSync(WEB).filter((n) => exts.test(n)).map((n) => ["web/" + n, fs.readFileSync(path.join(WEB, n), "utf8")]);

/* ---------- No AI-service references or credentials ---------- */
// Built from pieces so this file does not match its own scan.
const AI_TERMS = new RegExp(["anth" + "ropic", "cla" + "ude", "sk-" + "ant-", "api[_-]?" + "key"].join("|"), "i");

test("app and docs contain no AI-service references or API-key fields", () => {
  const scope = TEXT_FILES.filter((f) => !f.startsWith("tests/"));
  const hits = scope.flatMap((f) => read(f).split("\n").map((l, i) => [f, i + 1, l]).filter(([, , l]) => AI_TERMS.test(l)));
  assert.deepEqual(hits.map(([f, n]) => `${f}:${n}`), []);
});

test("no secrets or tokens are committed anywhere", () => {
  const SECRET = [
    /sk-ant-[A-Za-z0-9_-]{20,}/, /\bghp_[A-Za-z0-9]{30,}/, /\bgithub_pat_[A-Za-z0-9_]{30,}/, /\bgh[osu]_[A-Za-z0-9]{30,}/,
    /\bAKIA[0-9A-Z]{16}\b/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bxox[abprs]-[A-Za-z0-9-]{10,}/, /\bAIza[0-9A-Za-z_-]{35}\b/
  ];
  const hits = TEXT_FILES.filter((f) => SECRET.some((re) => re.test(read(f))));
  assert.deepEqual(hits, []);
  const badNames = FILES.filter((f) => /(^|\/)(\.env(\..*)?|.*\.(pem|key|p12|mobileprovision|keychain))$/i.test(f));
  assert.deepEqual(badNames, []);
});

/* ---------- No personal data in the public repo ---------- */
test("no email addresses or phone numbers are committed", () => {
  const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  const PHONE = /(?:\+?1[-.\s]?)?\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g;
  const ALLOWED_PHONES = new Set(["1-800-222-1222"]); // US Poison Control, a public helpline
  const hits = [];
  for (const f of TEXT_FILES) {
    const s = read(f);
    for (const m of s.match(EMAIL) || []) if (!/@users\.noreply\.github\.com$/.test(m)) hits.push(`${f}: ${m}`);
    for (const m of s.match(PHONE) || []) if (![...ALLOWED_PHONES].some((p) => m.includes(p))) hits.push(`${f}: ${m}`);
  }
  assert.deepEqual(hits, []);
});

test("no personal photos or backups are committed, and test images carry no metadata", () => {
  const images = FILES.filter((f) => /\.(png|jpe?g|gif|webp|heic|heif|tiff?|mov|mp4)$/i.test(f));
  const allowed = images.filter((f) => /^web\/icons\/icon-\d+\.png$/.test(f) || /^tests\/fixtures\/[a-z0-9-]+\.jpg$/.test(f));
  assert.deepEqual(images.filter((f) => !allowed.includes(f)), [], "unexpected image files");
  for (const f of allowed) {
    const buf = fs.readFileSync(path.join(ROOT, f));
    assert.equal(buf.includes(Buffer.from("Exif\0\0")), false, `${f} has EXIF metadata`);
    assert.equal(buf.includes(Buffer.from("eXIf")), false, `${f} has EXIF metadata`);
    assert.equal(buf.includes(Buffer.from("GPS")), false, `${f} may contain location data`);
  }
  assert.deepEqual(FILES.filter((f) => /botanica-backup/i.test(f)), [], "backup files must never be committed");
});

/* ---------- The web app cannot talk to the internet ---------- */
// The ONE permitted outside host: the U.S. National Weather Service public API (tap-to-check weather).
const WEATHER_HOST = "https://api.weather.gov";

test("web app files contain no external URLs except the one weather service", () => {
  const URL_RE = /\b(?:https?|wss?|ftp):\/\/|(?:src|href|action)\s*=\s*["']\/\//i;
  const files = webText(/\.(js|html|css|json|webmanifest)$/);
  const app = files.find(([f]) => f === "web/app.js")[1];
  assert.equal(app.split(WEATHER_HOST).length - 1, 1, "weather host must appear exactly once in app.js");
  const html = files.find(([f]) => f === "web/index.html")[1];
  assert.equal(html.split(WEATHER_HOST).length - 1, 1, "weather host must appear exactly once in the CSP");
  const hits = files
    .map(([f, s]) => [f, (f === "web/app.js" || f === "web/index.html") ? s.split(WEATHER_HOST).join("") : s])
    .filter(([, s]) => URL_RE.test(s)).map(([f]) => f);
  assert.deepEqual(hits, []);
});

test("web app uses no network or code-injection APIs", () => {
  const BANNED = [/XMLHttpRequest/, /\bWebSocket\b/, /\bEventSource\b/, /sendBeacon/, /importScripts/, /\beval\s*\(/,
                  /new\s+Function\s*\(/, /document\.write/, /setTimeout\s*\(\s*["'`]/, /setInterval\s*\(\s*["'`]/,
                  /RTCPeerConnection/, /\.postMessage\s*\(/, /\bimport\s*\(/];
  const hits = [];
  for (const [f, s] of webText(/\.js$/)) for (const re of BANNED) if (re.test(s)) hits.push(`${f}: ${re}`);
  assert.deepEqual(hits, []);
});

test("fetch() is only used for the app's own care guide and its own cached files", () => {
  const app = fs.readFileSync(path.join(WEB, "app.js"), "utf8");
  const core = fs.readFileSync(path.join(WEB, "core.js"), "utf8");
  const sw = fs.readFileSync(path.join(WEB, "sw.js"), "utf8");
  assert.deepEqual(app.match(/fetch\([^)]*\)/g), ['fetch("plants_database.json", { cache: "no-cache" })', "fetch(url, { ...NWS_FETCH, signal: ctl.signal })"]);
  // The weather call refuses any URL that isn't the weather service, sends no cookies, no referrer, no redirects.
  assert.match(app, /if \(typeof url !== "string" \|\| !url\.startsWith\(WEATHER_ORIGIN \+ "\/"\)\) throw/);
  const opts = app.match(/const NWS_FETCH = Object\.freeze\((\{[^\n]*\})\);/);
  assert.ok(opts, "NWS_FETCH options must be a frozen literal");
  for (const want of ['method: "GET"', 'credentials: "omit"', 'referrerPolicy: "no-referrer"', 'redirect: "error"', 'cache: "no-store"']) assert.ok(opts[1].includes(want), want);
  assert.equal(/body\s*:|Authorization|Cookie|navigator\.userAgent/.test(opts[1]), false);
  // Weather is only ever fetched from the "Check weather" button handler.
  assert.deepEqual(app.match(/weatherJSON\(/g).length, 3, "weatherJSON: 1 definition + 2 calls in checkWeather");
  assert.deepEqual(app.match(/checkWeather\(/g).length, 2, "checkWeather: 1 definition + 1 click handler");
  assert.match(app, /wx\.addEventListener\("click", \(\) => checkWeather\(wx\)\)/);
  // Only rounded coordinates are sent.
  assert.match(app, /\/points\/\$\{C\.roundCoord\(loc\.lat\)\},\$\{C\.roundCoord\(loc\.lon\)\}/);
  assert.equal(/fetch\s*\(/.test(core), false);
  assert.deepEqual(sw.match(/fetch\([^)]*\)/g), ["fetch(req)"]);
  assert.match(sw, /new URL\(req\.url\)\.origin !== self\.location\.origin\) return;/, "service worker must ignore other origins");
  assert.match(sw, /req\.method !== "GET"/);
});

test("core logic makes no network calls when exercised", async () => {
  const calls = [];
  const http = require("node:http"), https = require("node:https"), net = require("node:net"), dns = require("node:dns");
  const saved = { hr: http.request, hg: http.get, sr: https.request, sg: https.get, nc: net.connect, dl: dns.lookup, f: globalThis.fetch };
  const trap = (name) => (...a) => { calls.push(name); throw new Error("network blocked in tests"); };
  Object.assign(http, { request: trap("http"), get: trap("http") });
  Object.assign(https, { request: trap("https"), get: trap("https") });
  net.connect = trap("net"); dns.lookup = trap("dns"); globalThis.fetch = trap("fetch");
  try {
    delete require.cache[require.resolve("../../web/core.js")];
    const C = require("../../web/core.js");
    const db = JSON.parse(fs.readFileSync(path.join(WEB, "plants_database.json"), "utf8"));
    for (const prof of [null, ...db.plants]) {
      const p = { id: "x", potDiameterCm: 14, potMaterial: "terracotta", schedules: C.newSchedules(prof) };
      C.status(p, prof); C.waterML(p, prof); C.activeSchedules(p, prof); C.markDone(p.schedules.water);
    }
    C.validateBackup({ app: "botanica", plants: [{ id: "a" }], events: [], photos: [] });
    C.dataURLToBytes("data:image/jpeg;base64,AAAA");
  } finally {
    Object.assign(http, { request: saved.hr, get: saved.hg });
    Object.assign(https, { request: saved.sr, get: saved.sg });
    net.connect = saved.nc; dns.lookup = saved.dl; globalThis.fetch = saved.f;
  }
  assert.deepEqual(calls, []);
});

/* ---------- Browser hardening ---------- */
const html = fs.readFileSync(path.join(WEB, "index.html"), "utf8");
function csp() {
  const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
  assert.ok(m, "index.html must declare a Content-Security-Policy");
  return Object.fromEntries(m[1].split(";").map((d) => d.trim()).filter(Boolean).map((d) => { const [k, ...v] = d.split(/\s+/); return [k, v]; }));
}

test("Content-Security-Policy blocks all outside connections and inline code", () => {
  const p = csp();
  assert.deepEqual(p["default-src"], ["'none'"]);
  assert.deepEqual(p["script-src"], ["'self'"]);
  assert.deepEqual(p["style-src"], ["'self'"]);
  assert.deepEqual(p["connect-src"], ["'self'", WEATHER_HOST]);
  assert.deepEqual(p["img-src"], ["'self'", "blob:"]);
  assert.deepEqual(p["object-src"], ["'none'"]);
  assert.deepEqual(p["base-uri"], ["'none'"]);
  assert.deepEqual(p["form-action"], ["'none'"]);
  assert.deepEqual(p["frame-src"], ["'none'"]);
  const all = Object.values(p).flat().filter((v) => v !== WEATHER_HOST).join(" ");
  assert.equal(/unsafe-|\*|https?:|data:|wss?:/.test(all), false, "no wildcards, unsafe- keywords or remote hosts");
  assert.ok(html.indexOf("Content-Security-Policy") < html.indexOf("<script"), "CSP must come before any script");
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
});

test("pages have no inline scripts, inline event handlers or inline styles", () => {
  const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length > 0);
  for (const [, attrs, body] of scripts) {
    assert.match(attrs, /^\s+src="[a-z]+\.js"$/, "only local external scripts");
    assert.equal(body.trim(), "", "no inline script code");
    assert.ok(fs.existsSync(path.join(WEB, attrs.match(/src="([^"]+)"/)[1])));
  }
  for (const [f, s] of webText(/\.(js|html)$/)) {
    assert.equal(/\son[a-z]+\s*=\s*["']/i.test(s), false, `${f}: inline event handler`);
    assert.equal(/\sstyle\s*=\s*["']/i.test(s), false, `${f}: inline style (blocked by CSP)`);
    assert.equal(/javascript:/i.test(s), false, `${f}: javascript: URL`);
  }
});

test("user text is never interpolated into HTML without escaping", () => {
  const app = fs.readFileSync(path.join(WEB, "app.js"), "utf8");
  const RAW = /\$\{\s*(?:\w+\.)+(nickname|room|notes|text|speciesName|commonName|scientificName|summary|symptom|fix|signs|treatment|name|how|compound|query|title|detail|label|level)\s*\}/g;
  // toast() is exempt: it writes with textContent, which never interprets HTML.
  assert.match(app, /function toast\(msg, action\) \{[\s\S]*?t\.textContent = msg;[\s\S]*?b\.textContent = action\.label;/);
  const lines = app.split("\n").filter((l) => !/^\s*toast\(/.test(l));
  assert.deepEqual(lines.join("\n").match(RAW) || [], []);
  assert.match(app, /window\.top !== window\.self/, "app must refuse to run inside a frame");
  assert.match(app, /C\.validateBackup\(raw\)/, "restored backups must be validated");
});

test("service worker caches exactly the app's own files", () => {
  const sw = fs.readFileSync(path.join(WEB, "sw.js"), "utf8");
  const files = JSON.parse(sw.match(/const FILES = (\[[\s\S]*?\]);/)[1]);
  for (const f of files) {
    assert.match(f, /^\.\/[a-z0-9_\-/.]*$/, `${f} must be a relative path`);
    if (f !== "./") assert.ok(fs.existsSync(path.join(WEB, f)), `${f} missing`);
  }
  const shipped = fs.readdirSync(WEB).filter((n) => /\.(js|css|html|json|webmanifest)$/.test(n) && n !== "sw.js");
  for (const n of shipped) assert.ok(files.includes("./" + n), `${n} is not cached for offline use`);
});

test("manifest only references local files", () => {
  const m = JSON.parse(fs.readFileSync(path.join(WEB, "manifest.webmanifest"), "utf8"));
  assert.match(m.start_url, /^\.\//);
  assert.equal(m.scope, "./");
  for (const i of m.icons) assert.ok(fs.existsSync(path.join(WEB, i.src)), i.src);
});

/* ---------- CI pipeline hardening ---------- */
const WORKFLOWS = FILES.filter((f) => /^\.github\/workflows\/.*\.ya?ml$/.test(f));

test("workflows can't be triggered by outsiders' pull requests", () => {
  assert.ok(WORKFLOWS.length > 0);
  for (const f of WORKFLOWS) {
    const s = read(f);
    assert.equal(/pull_request_target/.test(s), false, `${f}: pull_request_target`);
    assert.equal(/^\s*pull_request:/m.test(s), false, `${f}: pull_request trigger`);
    assert.equal(/^\s*(issue_comment|workflow_run|repository_dispatch):/m.test(s), false, `${f}: externally triggerable event`);
  }
});

test("workflows pin every action to a full commit SHA and declare least-privilege permissions", () => {
  for (const f of WORKFLOWS) {
    const s = read(f);
    for (const [, ref] of s.matchAll(/uses:\s*([^\s#]+)/g)) assert.match(ref, /@[0-9a-f]{40}$/, `${f}: ${ref} is not pinned`);
    assert.match(s, /^permissions:/m, `${f}: needs a top-level permissions block`);
    assert.equal(/permissions:\s*write-all/.test(s), false);
    assert.equal(/\$\{\{\s*github\.event\./.test(s), false, `${f}: untrusted event data in workflow`);
    assert.equal(/\$\{\{\s*secrets\./.test(s), false, `${f}: no secrets are needed by this project`);
  }
});
