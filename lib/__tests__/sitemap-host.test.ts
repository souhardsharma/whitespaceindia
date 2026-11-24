/**
 * The sitemaps served from the backend's own host, because Google never read
 * them on pages.dev (scripts/cloudflare/sitemap-host.mjs). Only the sitemaps
 * and that host's robots.txt are open; page URLs inside stay on pages.dev.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BACKEND_ORIGIN, backendRobots, isSitemapPath, rewriteIndex } from "../../scripts/cloudflare/sitemap-host.mjs";
import { BACKEND_SITEMAP_ORIGIN, PRIMARY_ORIGIN } from "../site.ts";

test("exactly the published sitemaps are open, nothing else", () => {
  for (const p of ["/sitemap-index.xml", "/sitemap.xml", "/instruments/consent/sitemap/0.xml", "/instruments/consent/sitemap/34.xml", "/sitemap.xml?x=1"]) {
    assert.ok(isSitemapPath(p), p);
  }
  for (const p of ["/", "/api/instruments/consent/search", "/robots.txt", "/sitemap.xml/../api/x", "/instruments/consent/sitemap/x.xml",
                   "/instruments/consent/1243990978", "//evil.example/sitemap.xml", "/sitemap-index.xmlx", "/view/consent/rows/0.json"]) {
    assert.ok(!isSitemapPath(p), p);
  }
});

test("the index's children move to the backend; page URLs never do", () => {
  const index = `<sitemapindex><sitemap><loc>${PRIMARY_ORIGIN}/sitemap.xml</loc></sitemap><sitemap><loc>${PRIMARY_ORIGIN}/instruments/consent/sitemap/0.xml</loc></sitemap></sitemapindex>`;
  const out = rewriteIndex(index, PRIMARY_ORIGIN, BACKEND_ORIGIN);
  assert.match(out, new RegExp(`<loc>${BACKEND_ORIGIN}/sitemap.xml</loc>`));
  assert.match(out, new RegExp(`<loc>${BACKEND_ORIGIN}/instruments/consent/sitemap/0.xml</loc>`));
  assert.doesNotMatch(out, /pages\.dev/);
  // backend.mjs rewrites only the index, never a child: a child's <loc>s are pages.
  const src = readFileSync(new URL("../../scripts/cloudflare/backend.mjs", import.meta.url), "utf8");
  assert.match(src, /if \(pathname !== "\/sitemap-index\.xml"\)[\s\S]{0,80}handle\(req, res\)/);
});

test("the backend's robots.txt offers the sitemaps and nothing else", () => {
  const r = backendRobots();
  assert.match(r, /^User-agent: \*$/m);
  assert.match(r, /^Allow: \/sitemap-index\.xml$/m);
  assert.match(r, /^Allow: \/instruments\/consent\/sitemap\/$/m);
  assert.match(r, /^Disallow: \/$/m);
});

test("the public robots.txt names both indexes, its own first", () => {
  assert.equal(BACKEND_SITEMAP_ORIGIN, BACKEND_ORIGIN, "lib/site.ts and sitemap-host.mjs must name the same host");
  const src = readFileSync(new URL("../../app/robots.ts", import.meta.url), "utf8");
  assert.match(src, /sitemap: \[`\$\{BASE_URL\}\/sitemap-index\.xml`, `\$\{BACKEND_SITEMAP_ORIGIN\}\/sitemap-index\.xml`\]/);
});

test("the open paths sit before the key check, and everything else still redirects", () => {
  const src = readFileSync(new URL("../../scripts/cloudflare/backend.mjs", import.meta.url), "utf8");
  const gate = src.indexOf("if (!keyMatches(req.headers[\"x-backend-key\"]))");
  const open = src.indexOf("isSitemapPath(req.url)");
  const redirect = src.indexOf("res.writeHead(308", gate);
  assert.ok(gate > 0 && open > gate && redirect > open, "sitemaps are the only exception inside the unkeyed branch");
});
