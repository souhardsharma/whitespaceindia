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
import { readFileSync } from "node:fs";

type Has = { type: string; key: string; value: string };
type Route = { src: string; has?: Has[]; mitigate?: { action: string } };

const config = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")) as {
  routes?: Route[];
  [key: string]: unknown;
};

const denyRoute = config.routes?.find((r) => r.mitigate?.action === "deny");

/** A `has` value is matched against the whole header, so it is anchored here. */
function userAgentPattern(): RegExp {
  const has = denyRoute?.has?.find((h) => h.type === "header" && h.key === "user-agent");
  assert.ok(has, "the deny route tests the user-agent header");
  return new RegExp(`^(?:${has.value})$`);
}

test("vercel.json carries one deny route and no key that conflicts with `routes`", () => {
  assert.ok(denyRoute, "a route with mitigate.action = deny");
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
