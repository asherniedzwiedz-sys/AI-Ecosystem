// Local dev server: serves public/ and mounts api/route.js like Vercel does.
// No Vercel login needed. Reads ANTHROPIC_API_KEY from .env.local if present.
//   npm run dev  ->  http://localhost:3000
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const publicDir = join(root, "public");

try {
  process.loadEnvFile(join(root, ".env.local"));
} catch {
  // No .env.local: the router answers 503 and the page uses offline rules.
}

const route = await import("../api/route.js");
const port = Number(process.env.PORT) || 3000;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

async function handleApi(req, res) {
  const handler = route[req.method];
  if (!handler) {
    res.writeHead(405).end();
    return;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const request = new Request(`http://localhost:${port}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: req.method === "GET" ? undefined : Buffer.concat(chunks),
  });
  const response = await handler(request);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}

async function handleStatic(req, res) {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path.endsWith("/")) path += "index.html";
  const file = normalize(join(publicDir, path));
  if (!file.startsWith(publicDir)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] || "application/octet-stream",
      "cache-control": "no-cache",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
  }
}

createServer((req, res) => {
  const handle = req.url.startsWith("/api/route") ? handleApi : handleStatic;
  handle(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
}).listen(port, () => {
  const keyState = process.env.ANTHROPIC_API_KEY ? "API router on" : "no API key, offline rules only";
  console.log(`Switchboard on http://localhost:${port}  (${keyState})`);
});
