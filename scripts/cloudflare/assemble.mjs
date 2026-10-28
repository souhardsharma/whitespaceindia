// Turns a finished `next build` into a static site for Cloudflare Pages.
// Every prerendered route is copied as a file; the nine routes Next renders
// per request (the instrument APIs, /latest, /feed, brief, subscribe) are
// handed to the proxy functions in functions/ at the project root.
//
//   node scripts/cloudflare/assemble.mjs <project root> <out dir>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [root, out] = process.argv.slice(2).map((p) => path.resolve(p));
if (!root || !out) throw new Error("usage: node scripts/cloudflare/assemble.mjs <project root> <out dir>");
const appDir = path.join(root, ".next/server/app");
const MAX_FILES = 20000;
const MAX_BYTES = 25 * 1024 * 1024;

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

function copy(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}
function walk(dir, fn, base = dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, fn, base);
    else fn(p, path.relative(base, p).split(path.sep).join("/"));
  }
}

// public/ first, so a prerendered route of the same name wins.
walk(path.join(root, "public"), (p, rel) => {
  if (rel.includes("_orig_backup/")) return;
  copy(p, path.join(out, rel));
});
walk(path.join(root, ".next/static"), (p, rel) => copy(p, path.join(out, "_next/static", rel)));

let pages = 0;
walk(appDir, (p, rel) => {
  if (rel.endsWith(".html")) {
    if (rel === "_not-found.html") copy(p, path.join(out, "404.html"));
    if (rel.startsWith("_")) return;
    copy(p, path.join(out, rel));
    pages++;
  } else if (rel.endsWith(".body")) {
    // robots.txt, the sitemaps, the manifest and the cached news wire.
    copy(p, path.join(out, rel.slice(0, -".body".length)));
  }
});

// Proposal URLs are digits; Pages has no regex, so the named one-segment
// routes under /instruments/consent are matched first and served as they are.
const consent = fs
  .readdirSync(path.join(appDir, "instruments/consent"))
  .filter((n) => n.endsWith(".html"))
  .map((n) => n.slice(0, -5));
const redirects = [
  ...consent.map((n) => `/instruments/consent/${n} /instruments/consent/${n} 200`),
  "/instruments/consent/:id /instruments/consent/view 200",
];
fs.writeFileSync(path.join(out, "_redirects"), redirects.join("\n") + "\n");

// Only these paths run a function; everything else is a static asset, which
// Pages serves without counting a request.
const dynamic = ["/api/*", "/instruments/consent/latest", "/instruments/consent/feed", "/_be/*"];
fs.writeFileSync(
  path.join(out, "_routes.json"),
  JSON.stringify({ version: 1, include: dynamic, exclude: ["/api/news"] }, null, 2),
);

fs.copyFileSync(fileURLToPath(new URL("_headers", import.meta.url)), path.join(out, "_headers"));

let files = 0;
const big = [];
walk(out, (p, rel) => {
  files++;
  if (fs.statSync(p).size > MAX_BYTES) big.push(rel);
});
console.log(`${pages} pages, ${files} files, ${consent.length} named consent routes`);
if (files > MAX_FILES) throw new Error(`${files} files exceeds Cloudflare Pages' ${MAX_FILES}`);
if (big.length) throw new Error(`over 25 MiB: ${big.join(", ")}`);
