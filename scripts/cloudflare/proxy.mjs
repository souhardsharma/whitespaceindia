// Cloudflare Pages serves the prerendered site; the routes Next renders per
// request (the instrument APIs, /latest, /feed, brief, subscribe) are passed
// to the Node server at BACKEND_ORIGIN (scripts/cloudflare/backend.mjs).
//
// The backend answers only requests carrying BACKEND_KEY, so its own address
// cannot be crawled as a second copy of the site or spend its bandwidth.
//
// The caller's address is handed on as x-real-ip, which clientIp()
// (lib/request-identity.ts) reads before X-Forwarded-For. It comes from
// CF-Connecting-IP, which Cloudflare's edge sets and a client cannot; any
// client-sent copy of the headers clientIp trusts is dropped first, or one
// header would let a caller name whose rate-limit bucket it spends.
const DROP = ["x-real-ip", "x-vercel-forwarded-for", "x-forwarded-for", "x-backend-key", "host"];

export function backendRequest(request, env) {
  const url = new URL(request.url);
  const target = new URL(url.pathname + url.search, env.BACKEND_ORIGIN);
  const headers = new Headers(request.headers);
  for (const h of DROP) headers.delete(h);
  const ip = request.headers.get("cf-connecting-ip");
  if (ip) headers.set("x-real-ip", ip);
  headers.set("x-forwarded-host", url.host);
  headers.set("x-forwarded-proto", url.protocol.replace(":", ""));
  if (env.BACKEND_KEY) headers.set("x-backend-key", env.BACKEND_KEY);
  const init = { method: request.method, headers, redirect: "manual" };
  if (!["GET", "HEAD"].includes(request.method)) init.body = request.body;
  return new Request(target, init);
}

export async function proxy({ request, env }) {
  if (!env.BACKEND_ORIGIN) {
    return new Response("This part of the site is offline for now.", { status: 503 });
  }
  try {
    return await fetch(backendRequest(request, env));
  } catch {
    // The free backend sleeps when idle and can be restarting; say so rather
    // than hand the browser Cloudflare's generic error page.
    return new Response("This part of the site is waking up. Try again in a minute.", {
      status: 503,
      headers: { "Retry-After": "60" },
    });
  }
}
