// Turns a finished `next build` into a static site for Cloudflare Pages.
// Every prerendered route is copied as a file; the nine routes Next renders
// per request (the instrument APIs, /latest, /feed, brief, subscribe) are
// handed to the proxy functions in functions/ at the project root.
//
//   node scripts/cloudflare/assemble.mjs <project root> <out dir>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { retiredCardRedirects } from "./retired-cards.mjs";
import { checkLimits } from "./limits.mjs";

const [root, out] = process.argv.slice(2).map((p) => path.resolve(p));
if (!root || !out) throw new Error("usage: node scripts/cloudflare/assemble.mjs <project root> <out dir>");
const appDir = path.join(root, ".next/server/app");

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
// Proposals are then matched by their first digit, not by any segment: with
// `:id`, a mistyped address such as /instruments/consent/not-a-proposal was
// answered 200 with the proposal page saying "not found" - a soft 404 - where
// it now gets the site's real 404.
const consent = fs
  .readdirSync(path.join(appDir, "instruments/consent"))
  .filter((n) => n.endsWith(".html"))
  .map((n) => n.slice(0, -5));
const redirects = [
  // The old simulator address. As a static page it answered 200 with an empty
  // body and moved to /csr only once its script ran.
  "/simulator /csr#simulator 301",
  ...consent.map((n) => `/instruments/consent/${n} /instruments/consent/${n} 200`),
  ..."0123456789".split("").map((d) => `/instruments/consent/${d}* /instruments/consent/view 200`),
  // Instrument 02's schools are one static page too. School codes start with
  // a digit, so any other address under /school/ gets the site's real 404.
  ..."0123456789".split("").map((d) => `/instruments/meal-claims/school/${d}* /instruments/meal-claims/view 200`),
  ...retiredCardRedirects(fs.readdirSync(path.join(root, "public/og"))),
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
const sizes = [];
walk(out, (p, rel) => {
  files++;
  sizes.push({ rel, bytes: fs.statSync(p).size });
});
sizes.sort((a, b) => b.bytes - a.bytes);
console.log(`${pages} pages, ${files} files, ${consent.length} named consent routes`);
const { errors, warnings, summary } = checkLimits({
  files,
  largest: sizes.slice(0, 20),
  redirectsText: fs.readFileSync(path.join(out, "_redirects"), "utf8"),
  headersText: fs.readFileSync(path.join(out, "_headers"), "utf8"),
  routes: JSON.parse(fs.readFileSync(path.join(out, "_routes.json"), "utf8")),
});
console.log(`Cloudflare limits: ${summary}`);
// `::warning::` / `::error::` are GitHub annotations: on a pull request they
// show on the checks page; anywhere else they are plain lines.
for (const w of warnings) console.log(`::warning::Cloudflare Pages limit near: ${w}`);
for (const e of errors) console.log(`::error::Cloudflare Pages limit exceeded: ${e}`);
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### Cloudflare Pages limits\n\n${summary}\n\n` +
      [...errors.map((e) => `- **Exceeded:** ${e}`), ...warnings.map((w) => `- Near: ${w}`)].join("\n") +
      "\n",
  );
}
if (errors.length) throw new Error(`Cloudflare Pages would refuse this deployment: ${errors.join("; ")}`);
