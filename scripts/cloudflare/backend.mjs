// The Node server behind Cloudflare Pages (scripts/cloudflare/proxy.mjs).
// It is `next start` with one gate in front: a request without the shared
// BACKEND_KEY is answered 404, so the backend's own address serves nothing a
// crawler could index or spend. /healthz is open for the host's health check.
//
//   BACKEND_KEY=... PORT=10000 node scripts/cloudflare/backend.mjs
import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import next from "next";

const KEY = process.env.BACKEND_KEY || "";
const PORT = Number(process.env.PORT || 3000);

if (!KEY && process.env.NODE_ENV === "production") {
  console.warn("BACKEND_KEY is not set: this server answers anyone.");
}

function keyMatches(given) {
  if (!KEY) return true;
  const a = Buffer.from(String(given || ""));
  const b = Buffer.from(KEY);
  return a.length === b.length && timingSafeEqual(a, b);
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
      res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
      return;
    }
    handle(req, res);
  })
  .listen(PORT, "0.0.0.0", () => console.log(`backend on :${PORT}`));
