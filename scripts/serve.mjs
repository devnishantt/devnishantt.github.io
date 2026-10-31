// Tiny static server for local preview of ./site (GitHub Pages serves the same files in production).
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const ROOT = resolve(new URL("../site", import.meta.url).pathname);
const PORT = Number(process.env.PORT || 3000);
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
  ".pdf": "application/pdf", ".woff2": "font/woff2" };

createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end("forbidden"); return; }
    if ((await stat(file).catch(() => null))?.isDirectory()) file = join(file, "index.html");
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-cache" }).end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" }).end("not found");
  }
}).listen(PORT, "0.0.0.0", () => console.log(`serving ${ROOT} on :${PORT}`));
