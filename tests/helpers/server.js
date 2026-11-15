// Tiny static file server for tests: serves web/ on 127.0.0.1 only.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
                ".webmanifest": "application/manifest+json", ".png": "image/png", ".jpg": "image/jpeg" };

function serve(root, extraRoutes = {}) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (extraRoutes[url.pathname]) { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(extraRoutes[url.pathname]); }
    let file = path.normalize(path.join(root, decodeURIComponent(url.pathname)));
    if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
    if (url.pathname.endsWith("/")) file = path.join(file, "index.html");
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port })));
}

module.exports = { serve };
