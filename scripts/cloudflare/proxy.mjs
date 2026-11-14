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
// A PAGE older than that is still served, once, while a fresh copy is read
// behind it, for this long past the hour. A reader then waits on the backend
// only when a location has had no visit for seven hours. Rendering /latest
// takes the free backend 3-5 s, so a miss every hour in every location was a
// pause most readers met. Pages only: the parts of one CSV download are kept
// separately, and a stale part beside a fresh one would make a file of two
// nights.
export const STALE_SECONDS = 6 * 3600;

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
function isHtml(res) {
  return (res.headers.get("content-type") || "").startsWith("text/html");
}

function forCache(res, ttl, keep = ttl) {
  const copy = new Response(res.body, res);
  copy.headers.set("x-origin-cache-control", res.headers.get("cache-control") || "");
  copy.headers.set("cache-control", `public, max-age=${keep}`);
  copy.headers.set("x-stored-at", String(Date.now()));
  for (const h of ["vary", "content-encoding", "content-length"]) copy.headers.delete(h);
  return copy;
}

function fromCache(res, state = "hit") {
  const out = new Response(res.body, res);
  const origin = out.headers.get("x-origin-cache-control");
  if (origin) out.headers.set("cache-control", origin);
  else out.headers.delete("cache-control");
  out.headers.delete("x-origin-cache-control");
  out.headers.delete("x-stored-at");
  out.headers.set("x-proxy-cache", state);
  return out;
}

// The free backend sleeps after 15 idle minutes, and NOTHING AT CLOUDFLARE CAN
// WAKE IT. Render's router answers a request for a sleeping service that comes
// from a Worker (this proxy, the keep-warm Worker) with 429 and
// `x-render-routing: hibernate-rate-limited`, and does not start the service.
// Measured 2026-11-14: four requests through this proxy, 100 s apart, were all
// refused that way, and a fifth from a GitHub runner woke the service in 52 s;
// the keep-warm Worker's own log shows its pings refused every morning (130 in
// seven days) until the night's data commit redeployed the service. For about
// a minute after such a refusal Render's edge also answers the host with
// Cloudflare's challenge page (cf-mitigated: challenge), to everyone.
//
// So the nightly workflow wakes it (the `wake` job in instruments-sync.yml),
// and what a refusal looks like here is settled once: it is never the
// backend's answer. The backend's own answers, its own rate-limit 429s among
// them, carry x-render-origin-server.
export function edgeRefusal(res, env) {
  if (res.headers.has("cf-mitigated")) return true;
  if (res.status !== 429 || res.headers.has("x-render-origin-server")) return false;
  try {
    return new URL(env.BACKEND_ORIGIN).hostname.endsWith(".onrender.com");
  } catch {
    return false;
  }
}

// Seconds a reader is asked to wait: a wake takes about a minute.
export const WAKE_SECONDS = 120;
// Seconds the waking page waits before it sends the reader to the backend.
// Long enough to read the line; the reader's browser passes the edge's
// challenge where a script could not.
export const WAKE_AFTER_SECONDS = 4;

const attr = (text) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function wantsPage(request) {
  if (request.method !== "GET") return false;
  if (request.headers.has("rsc") || request.headers.has("next-router-prefetch")) return false;
  const path = new URL(request.url).pathname;
  if (path.startsWith("/api/") || path.startsWith(ASSET_PREFIX + "/")) return false;
  return (request.headers.get("accept") || "").includes("text/html");
}

// What a reader gets while the backend sleeps or restarts. A reader's own
// browser CAN wake it: a visit to the backend's address starts the service,
// and the backend answers every visit without the key by sending it back to
// the same path here (backend.mjs). So a page is answered with a page that
// makes that round trip by itself, and anything else is told where to send a
// reader (x-backend-wake) - a script cannot follow, connect-src is 'self'.
function asleep(request, env) {
  const headers = { "Retry-After": String(WAKE_SECONDS), "cache-control": "no-store" };
  let wake = "";
  try {
    const here = new URL(request.url);
    const origin = new URL(env.BACKEND_ORIGIN).origin;
    headers["x-backend-wake"] = origin;
    wake = origin + here.pathname + here.search;
  } catch {
    // No usable backend address: the plain answer below.
  }
  if (!wake || !wantsPage(request)) {
    return new Response("This part of the site is asleep. It takes about a minute to wake; try again then.", {
      status: 503,
      headers: { ...headers, "content-type": "text/plain; charset=utf-8" },
    });
  }
  const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="${WAKE_AFTER_SECONDS};url=${attr(wake)}">
<title>Waking up | Whitespace India</title>
<style>
body{margin:0;background:#fcf9f4;color:#1c1c19;font:16px/1.6 "Public Sans",system-ui,sans-serif}
main{max-width:34rem;margin:0 auto;padding:22vh 1.5rem 3rem}
h1{font:400 2rem/1.15 Newsreader,Georgia,serif;letter-spacing:-.01em;margin:0 0 1rem}
p{margin:0 0 1rem}
a{color:inherit}
</style>
</head>
<body>
<main>
<h1>This page is waking up</h1>
<p>The part of the site that reads the register on request sleeps when nobody has used it for a while. Waking it takes about a minute.</p>
<p>You are being taken there now and will be brought back to this page. Nothing needs doing.</p>
<p><a href="${attr(wake)}">Go now</a></p>
</main>
</body>
</html>
`;
  return new Response(page, { status: 503, headers: { ...headers, "content-type": "text/html; charset=utf-8" } });
}

async function fetchBackend(request, env, strip = "") {
  let res;
  try {
    res = await fetch(backendRequest(request, env, strip));
  } catch {
    return asleep(request, env);
  }
  return edgeRefusal(res, env) ? asleep(request, env) : res;
}

function offline() {
  return new Response("This part of the site is offline for now.", { status: 503 });
}

function keepable(res) {
  return res.status === 200 && !res.headers.has("set-cookie");
}

// How long a copy stays in the cache: a page past its hour is still served
// while it is refreshed (STALE_SECONDS); anything else expires on the hour.
function keepFor(res, ttl) {
  return ttl === CACHE_SECONDS && isHtml(res) ? ttl + STALE_SECONDS : ttl;
}

async function cached(request, env, waitUntil, { strip = "", ttl = CACHE_SECONDS } = {}) {
  const cache = caches.default;
  const key = new Request(request.url, { method: "GET" });
  const hit = await cache.match(key);
  if (hit) {
    // A copy stored before x-stored-at existed expires on its own hour.
    const stored = Number(hit.headers.get("x-stored-at"));
    if (!stored || Date.now() - stored < ttl * 1000) return fromCache(hit);
    waitUntil(refresh(request, env, key, ttl, strip).catch(() => {}));
    return fromCache(hit, "stale");
  }

  const res = await fetchBackend(request, env, strip);
  if (!keepable(res)) return res;
  waitUntil(cache.put(key, forCache(res.clone(), ttl, keepFor(res, ttl))));
  const out = new Response(res.body, res);
  out.headers.set("x-proxy-cache", "miss");
  return out;
}

// The copy behind a stale page. A failed read keeps the old copy until it
// expires; a new page's files are read with it, as on a miss.
async function refresh(request, env, key, ttl, strip) {
  const res = await fetchBackend(request, env, strip);
  if (!keepable(res)) return;
  const html = isHtml(res);
  await caches.default.put(key, forCache(html ? res.clone() : res, ttl, keepFor(res, ttl)));
  if (html) await warmAssets(res, request, env);
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
      if (keepable(res)) await cache.put(key, forCache(res, ASSET_CACHE_SECONDS));
    }),
  );
}

export async function proxy({ request, env, waitUntil }) {
  if (!env.BACKEND_ORIGIN) return offline();
  if (!isCacheable(request)) return fetchBackend(request, env);

  const res = await cached(request, env, waitUntil);
  if (isHtml(res) && res.headers.get("x-proxy-cache") === "miss") {
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
