/**
 * The edge rule that turns crawlers away before they reach a function.
 *
 * On 2026-10-27 a free Vercel team passed 301% of its Fast Origin Transfer
 * and every page answered 402. The rule lives in vercel.json, which only
 * Vercel reads, so this suite pins what it can: the file is the shape Vercel
 * accepts, the pattern matches the crawlers named, and it matches nothing a
 * search engine, a link preview or a reader sends.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

type Has = { type: string; key: string; value: string };
type Route = { src: string; has?: Has[]; mitigate?: { action: string } };

const config = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")) as {
  routes?: Route[];
  [key: string]: unknown;
};

const denyRoutes = (config.routes ?? []).filter((r) => r.mitigate?.action === "deny");
const denyRoute = denyRoutes.find((r) => r.has?.some((h) => h.key === "user-agent"));
const junkRoute = denyRoutes.find((r) => !r.has);

/** A `has` value is matched against the whole header, so it is anchored here. */
function userAgentPattern(): RegExp {
  const has = denyRoute?.has?.find((h) => h.type === "header" && h.key === "user-agent");
  assert.ok(has, "the deny route tests the user-agent header");
  return new RegExp(`^(?:${has.value})$`);
}

/** A route's `src` is anchored by Vercel; it is anchored here the same way. */
function junkPattern(): RegExp {
  assert.ok(junkRoute, "a deny route that tests the path alone");
  return new RegExp(junkRoute.src);
}

test("vercel.json carries its deny routes and no key that conflicts with `routes`", () => {
  assert.ok(denyRoute, "a route with mitigate.action = deny");
  assert.equal(denyRoutes.length, 2, "one deny route by user-agent, one by path");
  // `routes` cannot be combined with these in the same vercel.json; Vercel
  // refuses the deployment, which would also stop the nightly data deploy.
  for (const key of ["rewrites", "redirects", "headers", "cleanUrls", "trailingSlash"]) {
    assert.ok(!(key in config), `vercel.json must not set ${key} beside routes`);
  }
});

test("crawlers seen draining the plan are denied", () => {
  const ua = userAgentPattern();
  const seen = [
    "Mozilla/5.0 AppleWebKit/600.2.5 (KHTML, like Gecko) Version/8.0.2 Safari/600.2.5 (Amazonbot/0.1; +https://developer.amazon.com/support/amazonbot)",
    "Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)",
    "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 (compatible; GoogleOther)",
    "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
    "Mozilla/5.0 (compatible; MJ12bot/v1.4.8; http://mj12bot.com/)",
  ];
  for (const s of seen) assert.ok(ua.test(s), `denied: ${s}`);
});

test("search engines, link previews and readers are not denied", () => {
  const ua = userAgentPattern();
  const welcome = [
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    "Mozilla/5.0 (compatible; Applebot/0.1; +http://www.apple.com/go/applebot)",
    "WhatsApp/2.23.20.0",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "Twitterbot/1.0",
    "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    "",
  ];
  for (const s of welcome) assert.ok(!ua.test(s), `not denied: ${JSON.stringify(s)}`);
});

test("a word where a proposal number belongs is denied at the edge", () => {
  // 2026-10-27, 12 hours: /contact, /about and /home under the proposal route
  // drew 15,700 requests, each a function run that ended in notFound().
  const path = junkPattern();
  for (const word of ["contact", "about", "home", "wp-login.php", "admin", "index.html", "Contact"]) {
    assert.ok(path.test(`/instruments/consent/${word}`), `denied: ${word}`);
    assert.ok(path.test(`/instruments/consent/${word}/`), `denied with a slash: ${word}`);
  }
});

test("proposal numbers, the instrument's own pages and everything below them are not denied", () => {
  const path = junkPattern();
  const served = [
    "/instruments/consent",
    "/instruments/consent/",
    "/instruments/consent/1244578275",
    "/instruments/consent/969361",
    "/instruments/consent/latest",
    "/instruments/consent/data",
    "/instruments/consent/feed",
    "/instruments/consent/sitemap/0.xml",
    "/instruments/consent/sitemap.xml",
    "/instruments/consent/district/jaipur",
    "/instruments/consent/register/rajasthan",
    "/instruments/consent/methodology",
    "/instruments/consent/appraisal",
    "/instruments/consent/latest/anything/below",
    "/instruments",
    "/csr",
    "/about",
    "/contact",
    "/api/instruments/consent/search",
  ];
  for (const s of served) assert.ok(!path.test(s), `not denied: ${s}`);
});

test("every page the instrument serves is named in the path rule's exceptions", () => {
  // A new folder under app/instruments/consent is a new URL. Left out of the
  // rule it would answer 403 to everyone, and nothing but this test would say so.
  const path = junkPattern();
  const root = new URL("../../app/instruments/consent/", import.meta.url);
  const own = readdirSync(root).map((n) => n.replace(/\.[^.]+$/, "")).filter((n) => !/^[\[(]/.test(n));
  assert.ok(own.length >= 8, `the folder's entries were read: ${own.join(", ")}`);
  for (const name of own) {
    if (name === "page" || name === "layout") continue;
    assert.ok(!path.test(`/instruments/consent/${name}`), `served, so not denied: ${name}`);
  }
});
