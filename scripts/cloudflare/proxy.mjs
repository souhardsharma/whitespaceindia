// Cloudflare Pages serves the prerendered site; the routes Next renders per
// request (the instrument APIs, /latest, /feed, brief, subscribe) are passed
// to the Node server at BACKEND_ORIGIN (scripts/cloudflare/backend.mjs).
//
// The backend answers only requests carrying BACKEND_KEY, so its own address
// cannot be crawled as a second copy of the site or spend its bandwidth.
//
// The caller's address is handed on as x-backend-client-ip (and x-real-ip,
// which clientIp() in lib/request-identity.ts reads). It comes from
// CF-Connecting-IP, which Cloudflare's edge sets and a client cannot; any
// client-sent copy of the headers clientIp trusts is dropped first, or one
// header would let a caller name whose rate-limit bucket it spends.
const DROP = [
  "x-real-ip", "x-vercel-forwarded-for", "x-forwarded-for", "x-backend-key", "x-backend-client-ip", "host",
];

// Every GET the proxy carries is public data that changes once a night, and
// the free backend is suspended for the month if its bandwidth runs out. So a
// GET answer is kept in this Cloudflare location's cache for an hour, and a
// crawler or a busy page reads it from there instead of from the backend.
export const CACHE_SECONDS = 3600;

// The backend's pages load their scripts and styles from its own build, under
// this prefix (next.config.mjs): /_be/_next/static/x is the backend's
// /_next/static/x. Those names are content hashes, so an edge copy is kept for
// thirty days.
export const ASSET_PREFIX = "/_be";
export const ASSET_CACHE_SECONDS = 30 * 86400;
const ASSET = { strip: ASSET_PREFIX, ttl: ASSET_CACHE_SECONDS };
// The most of a page's files fetched into the cache alongside it (warmAssets).
const WARM_LIMIT = 40;

export function backendRequest(request, env, strip = "") {
  const url = new URL(request.url);
  const path = strip && url.pathname.startsWith(strip + "/") ? url.pathname.slice(strip.length) : url.pathname;
  const target = new URL(path + url.search, env.BACKEND_ORIGIN);
  const headers = new Headers(request.headers);
  for (const h of DROP) headers.delete(h);
  const ip = request.headers.get("cf-connecting-ip");
  if (ip) {
    headers.set("x-real-ip", ip);
    headers.set("x-backend-client-ip", ip);
  }
  headers.set("x-forwarded-host", url.host);
  headers.set("x-forwarded-proto", url.protocol.replace(":", ""));
  if (env.BACKEND_KEY) headers.set("x-backend-key", env.BACKEND_KEY);
  const init = { method: request.method, headers, redirect: "manual" };
  if (!["GET", "HEAD"].includes(request.method)) init.body = request.body;
  return new Request(target, init);
}

// A client-side navigation asks a page for its RSC payload under the same URL
// (an `rsc` header, or `_rsc` in the query); caching that would hand a reader
// the payload in place of the page, or the reverse.
export function isCacheable(request) {
  if (request.method !== "GET") return false;
  if (request.headers.has("rsc") || request.headers.has("next-router-prefetch")) return false;
  return !new URL(request.url).searchParams.has("_rsc");
}

// The stored copy carries the cache's lifetime; the backend's own
// Cache-Control (no-store on a rendered page) is what the browser gets back.
// fetch() hands over the body already decoded, so the stored copy must not
// keep the backend's Content-Encoding: kept, a hit was served as the decoded
// bytes encoded a second time, which no browser can read.
function forCache(res, ttl) {
  const copy = new Response(res.body, res);
  copy.headers.set("x-origin-cache-control", res.headers.get("cache-control") || "");
  copy.headers.set("cache-control", `public, max-age=${ttl}`);
  for (const h of ["vary", "content-encoding", "content-length"]) copy.headers.delete(h);
  return copy;
}

function fromCache(res) {
  const out = new Response(res.body, res);
  const origin = out.headers.get("x-origin-cache-control");
  if (origin) out.headers.set("cache-control", origin);
  else out.headers.delete("cache-control");
  out.headers.delete("x-origin-cache-control");
  out.headers.set("x-proxy-cache", "hit");
  return out;
}

async function fetchBackend(request, env, strip = "") {
  try {
    return await fetch(backendRequest(request, env, strip));
  } catch {
    // The free backend sleeps when idle and can be restarting; say so rather
    // than hand the browser Cloudflare's generic error page.
    return new Response("This part of the site is waking up. Try again in a minute.", {
      status: 503,
      headers: { "Retry-After": "60" },
    });
  }
}

function offline() {
  return new Response("This part of the site is offline for now.", { status: 503 });
}

async function cached(request, env, waitUntil, { strip = "", ttl = CACHE_SECONDS } = {}) {
  const cache = caches.default;
  const key = new Request(request.url, { method: "GET" });
  const hit = await cache.match(key);
  if (hit) return fromCache(hit);

  const res = await fetchBackend(request, env, strip);
  if (res.status !== 200 || res.headers.has("set-cookie")) return res;
  waitUntil(cache.put(key, forCache(res.clone(), ttl)));
  const out = new Response(res.body, res);
  out.headers.set("x-proxy-cache", "miss");
  return out;
}

// A page is kept for an hour, and the backend can deploy inside that hour,
// after which it no longer has the files the kept page names. So the files a
// page names are put in the cache when the page is: a page a crawler fetched
// without its scripts would otherwise be served later with none that load.
export function assetPaths(html) {
  const re = new RegExp(String.raw`["'](${ASSET_PREFIX}/_next/static/[^"'\s<>\\]+)["']`, "g");
  return [...new Set([...html.matchAll(re)].map((m) => m[1].replace(/&amp;/g, "&")))].slice(0, WARM_LIMIT);
}

async function warmAssets(page, request, env) {
  const origin = new URL(request.url).origin;
  const cache = caches.default;
  await Promise.all(
    assetPaths(await page.text()).map(async (p) => {
      const key = new Request(origin + p, { method: "GET" });
      if (await cache.match(key)) return;
      const res = await fetchBackend(key, env, ASSET_PREFIX);
      if (res.status === 200 && !res.headers.has("set-cookie")) await cache.put(key, forCache(res, ASSET_CACHE_SECONDS));
    }),
  );
}

export async function proxy({ request, env, waitUntil }) {
  if (!env.BACKEND_ORIGIN) return offline();
  if (!isCacheable(request)) return fetchBackend(request, env);

  const res = await cached(request, env, waitUntil);
  const html = (res.headers.get("content-type") || "").startsWith("text/html");
  if (html && res.headers.get("x-proxy-cache") === "miss") {
    waitUntil(warmAssets(res.clone(), request, env).catch(() => {}));
  }
  return res;
}

// /_be/*: only the backend build's static files, never a page through a path
// that would keep it for thirty days.
export async function proxyAsset({ request, env, waitUntil }) {
  if (!env.BACKEND_ORIGIN) return offline();
  if (!new URL(request.url).pathname.startsWith(`${ASSET_PREFIX}/_next/static/`)) {
    return new Response("Not found", { status: 404 });
  }
  if (!isCacheable(request)) return fetchBackend(request, env, ASSET_PREFIX);
  return cached(request, env, waitUntil, ASSET);
}
