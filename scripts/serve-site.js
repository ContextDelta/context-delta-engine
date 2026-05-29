#!/usr/bin/env node
// Zero-dependency static server for the Context Delta docs site.
// Usage: npm run site            (serves docs/ on http://localhost:3001)
//        npm run site -- --port 4000 --root docs

import http from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const args = { port: 3001, root: "docs" };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--port" || flag === "-p") args.port = Number(argv[++i]) || args.port;
    else if (flag === "--root" || flag === "-r") args.root = argv[++i] ?? args.root;
  }
  return args;
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

const { port, root } = parseArgs(process.argv.slice(2));
const rootDir = path.resolve(repoRoot, root);

async function resolveTarget(urlPath) {
  // Strip query string, decode, and prevent path traversal outside rootDir.
  const clean = decodeURIComponent(urlPath.split("?")[0]);
  let target = path.join(rootDir, clean);
  if (!target.startsWith(rootDir)) return null;

  try {
    const info = await stat(target);
    if (info.isDirectory()) target = path.join(target, "index.html");
  } catch {
    // Allow pretty URLs: /cli -> /cli.html
    if (!path.extname(target)) target += ".html";
  }
  return target;
}

const server = http.createServer(async (req, res) => {
  const target = await resolveTarget(req.url ?? "/");
  if (!target) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error("not a file");
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(target)] ?? "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    createReadStream(target).pipe(res);
  } catch {
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<h1>404</h1><p>Not found: ${req.url}</p><p><a href="/">Back to index</a></p>`);
  }
});

server.listen(port, () => {
  console.log(`Context Delta site serving ${path.relative(repoRoot, rootDir) || "."}`);
  console.log(`  http://localhost:${port}`);
  console.log("Press Ctrl+C to stop.");
});
