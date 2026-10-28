// The Node server behind Cloudflare Pages (scripts/cloudflare/proxy.mjs).
// It is `next start` with one gate in front: a request without the shared
// BACKEND_KEY is a visitor or crawler that found this host, and is sent to
// the same path on the public site (308), so the backend's own address serves
// no second copy of anything and spends almost nothing. /healthz is open for
// the host's health check.
//
//   BACKEND_KEY=... PORT=10000 node scripts/cloudflare/backend.mjs
import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import next from "next";

const KEY = process.env.BACKEND_KEY || "";
const PORT = Number(process.env.PORT || 3000);
// The public origin (lib/site.ts). A bad value is a misconfiguration, so it
// throws at start rather than send visitors somewhere odd.
const SITE = new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://whitespaceindia.pages.dev").origin;

if (!KEY && process.env.NODE_ENV === "production") {
  console.warn("BACKEND_KEY is not set: this server answers anyone.");
}

function keyMatches(given) {
  if (!KEY) return true;
  const a = Buffer.from(String(given || ""));
  const b = Buffer.from(KEY);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Joined as text, never resolved against the origin: `new URL("//evil.com",
// SITE)` is https://evil.com. Leading slashes are collapsed and the result's
// origin checked, so every redirect stays on SITE whatever the path holds.
function publicUrl(reqUrl) {
  const target = new URL(SITE + "/" + String(reqUrl || "/").replace(/^[/\\]+/, ""));
  return target.origin === SITE ? target.href : SITE + "/";
}

// The proxy names the visitor's address and the public host in headers of its
// own (proxy.mjs). They are trusted only on a keyed request, and replace what
// the hosting platform's edge set, which describes Cloudflare, not the visitor.
function adoptProxyHeaders(req) {
  const h = req.headers;
  h["x-real-ip"] = h["x-backend-client-ip"] || "unknown";
  if (h["x-forwarded-host"]) h.host = h["x-forwarded-host"];
  delete h["x-forwarded-for"];
  delete h["x-vercel-forwarded-for"];
  delete h["x-backend-client-ip"];
  delete h["x-backend-key"];
}

const app = next({ dev: false, dir: process.cwd() });
const handle = app.getRequestHandler();
await app.prepare();

http
  .createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain" }).end("ok");
      return;
    }
    if (!keyMatches(req.headers["x-backend-key"])) {
      res.writeHead(308, { location: publicUrl(req.url), "content-type": "text/plain" }).end();
      return;
    }
    adoptProxyHeaders(req);
    handle(req, res);
  })
  .listen(PORT, "0.0.0.0", () => console.log(`backend on :${PORT}`));
