/**
 * The Cloudflare Pages proxy (scripts/cloudflare/proxy.mjs) in front of the
 * Node backend: the rate limits key on the caller Cloudflare saw, never on a
 * header the caller typed, only the proxy holds the backend's key, and a
 * public GET is read from the backend once an hour per location, not per
 * request.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { backendRequest, isCacheable, proxy, CACHE_SECONDS } from "../../scripts/cloudflare/proxy.mjs";
import { clientIp } from "../request-identity.ts";

const env = { BACKEND_ORIGIN: "https://backend.example", BACKEND_KEY: "k3y" };

function incoming(headers: Record<string, string>): Request {
  return new Request("https://whitespaceindia.pages.dev/api/instruments/consent/search?q=coal", { headers });
}

test("the backend sees the address Cloudflare connected from", () => {
  const out = backendRequest(incoming({ "cf-connecting-ip": "203.0.113.7" }), env);
  assert.equal(clientIp(out), "203.0.113.7");
});

test("address headers a caller sends are dropped, not passed on", () => {
  const out = backendRequest(
    incoming({
      "cf-connecting-ip": "203.0.113.7",
      "x-real-ip": "1.1.1.1",
      "x-vercel-forwarded-for": "2.2.2.2",
      "x-forwarded-for": "3.3.3.3",
    }),
    env,
  );
  assert.equal(out.headers.get("x-vercel-forwarded-for"), null);
  assert.equal(out.headers.get("x-forwarded-for"), null);
  assert.equal(clientIp(out), "203.0.113.7");
});

test("the key is the proxy's own, whatever the caller sent", () => {
  const out = backendRequest(incoming({ "x-backend-key": "guess" }), env);
  assert.equal(out.headers.get("x-backend-key"), "k3y");
});

test("path and query reach the backend unchanged", () => {
  const out = backendRequest(incoming({}), env);
  assert.equal(out.url, "https://backend.example/api/instruments/consent/search?q=coal");
});

test("the address the backend adopts is the one Cloudflare saw, never the caller's", () => {
  const out = backendRequest(
    incoming({ "cf-connecting-ip": "203.0.113.7", "x-backend-client-ip": "1.1.1.1" }),
    env,
  );
  assert.equal(out.headers.get("x-backend-client-ip"), "203.0.113.7");
});

test("only a page or file is cached, never a form post or an RSC payload", () => {
  assert.equal(isCacheable(incoming({})), true);
  assert.equal(isCacheable(new Request("https://x.dev/api/brief", { method: "POST", body: "{}" })), false);
  assert.equal(isCacheable(incoming({ rsc: "1" })), false);
  assert.equal(isCacheable(new Request("https://x.dev/instruments/consent/latest?_rsc=abc")), false);
});

// Cloudflare's cache and fetch, reduced to what proxy() uses.
function edge(backend: () => Response) {
  const store = new Map<string, Response>();
  const pending: Promise<unknown>[] = [];
  let calls = 0;
  Object.assign(globalThis, {
    caches: {
      default: {
        match: async (r: Request) => store.get(r.url)?.clone(),
        put: async (r: Request, res: Response) => void store.set(r.url, res),
      },
    },
  });
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls++;
    return backend();
  }) as typeof fetch;
  return {
    run: (request: Request) => proxy({ request, env, waitUntil: (p: Promise<unknown>) => pending.push(p) }),
    settle: () => Promise.all(pending),
    calls: () => calls,
    store,
    restore: () => {
      globalThis.fetch = realFetch;
    },
  };
}

test("a GET is read from the backend once and then from the edge, with the backend's own headers", async () => {
  const e = edge(() => new Response("<html>latest</html>", {
    headers: {
      "cache-control": "private, no-store", vary: "rsc", "content-type": "text/html", "content-encoding": "br",
    },
  }));
  try {
    const first = await e.run(incoming({}));
    assert.equal(first.headers.get("x-proxy-cache"), "miss");
    assert.equal(await first.text(), "<html>latest</html>");
    await e.settle();
    const stored = e.store.values().next().value!;
    assert.equal(stored.headers.get("cache-control"), `public, max-age=${CACHE_SECONDS}`);
    // fetch() decodes the body; a stored encoding claim would make a hit unreadable.
    assert.equal(stored.headers.get("content-encoding"), null);

    const second = await e.run(incoming({}));
    assert.equal(second.headers.get("x-proxy-cache"), "hit");
    assert.equal(second.headers.get("cache-control"), "private, no-store");
    assert.equal(second.headers.get("x-origin-cache-control"), null);
    assert.equal(await second.text(), "<html>latest</html>");
    assert.equal(e.calls(), 1);
  } finally {
    e.restore();
  }
});

test("an error or a cookie is never cached", async () => {
  for (const make of [
    () => new Response("down", { status: 500 }),
    () => new Response("ok", { headers: { "set-cookie": "a=b" } }),
  ]) {
    const e = edge(make);
    try {
      await e.run(incoming({}));
      await e.settle();
      assert.equal(e.store.size, 0);
    } finally {
      e.restore();
    }
  }
});
