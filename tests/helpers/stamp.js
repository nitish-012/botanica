// Computes the content hash of every file the service worker caches and writes it into web/sw.js.
// Usage: node tests/helpers/stamp.js          (updates sw.js)
//        require("./stamp.js").expected()     (used by the unit test)
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const WEB = path.join(__dirname, "../../web");
const SW = path.join(WEB, "sw.js");

function expected() {
  const sw = fs.readFileSync(SW, "utf8");
  const files = JSON.parse(sw.match(/const FILES = (\[[\s\S]*?\]);/)[1]).filter((f) => f !== "./").sort();
  const h = crypto.createHash("sha256");
  for (const f of files) { h.update(f + "\0"); h.update(fs.readFileSync(path.join(WEB, f))); h.update("\0"); }
  return h.digest("hex").slice(0, 12);
}
function current() { return fs.readFileSync(SW, "utf8").match(/const BUILD = "([0-9a-f]{12})";/)[1]; }

if (require.main === module) {
  fs.writeFileSync(SW, fs.readFileSync(SW, "utf8").replace(/const BUILD = "[0-9a-f]{12}";/, `const BUILD = "${expected()}";`));
  console.log("sw.js stamped:", expected());
}
module.exports = { expected, current };
