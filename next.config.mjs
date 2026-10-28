import { withBotId } from "botid/next/config";
import { movedRedirects } from "./lib/moved-hosts.mjs";

/** @type {import('next').NextConfig} */

/**
 * Response headers.
 *
 * This file was empty, so the site shipped with no security headers at all:
 * no Content-Security-Policy, no X-Content-Type-Options, no Referrer-Policy,
 * no X-Frame-Options. That is not a theoretical gap here - the instrument
 * renders proponent-supplied strings from a government register, and it
 * embeds JSON-LD, so the two things worth denying an attacker are script
 * injection and framing.
 *
 * WHY THE CSP LOOKS LOOSER THAN A CSP SHOULD
 * ------------------------------------------
 * `'unsafe-inline'` is in `script-src` because Next's App Router inlines its
 * hydration payload; `'unsafe-eval'` is added only under `next dev`, whose
 * runtime uses `eval`. A nonce-based policy is the right end state and needs the
 * middleware to mint a nonce per request and Next to be told about it; that
 * is a change with its own failure modes and it is not made here. What IS
 * gained today: `object-src 'none'` and `base-uri 'self'` close plugin
 * injection and base-tag hijacking outright, `frame-ancestors 'none'` stops
 * clickjacking, and `connect-src`/`img-src` bound where data can be sent.
 *
 * Stating that honestly matters more than claiming a policy this app does not
 * yet enforce.
 */
const CSP = [
  "default-src 'self'",
  // Next inlines its bootstrap; see above. va.vercel-scripts.com serves the
  // Vercel Analytics and Speed Insights scripts that app/layout.tsx mounts -
  // omitting it did not disable analytics quietly, it broke them with a
  // console error on every page, which is the kind of "hardening" that ships
  // a regression dressed as a fix.
  // 'unsafe-eval' only under `next dev`, whose React Refresh runtime needs
  // it; a production build never evaluates strings, so it is not granted one.
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""} https://va.vercel-scripts.com`,
  // Tailwind and next/font emit inline styles.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  // Its own published JSON, plus where the two analytics scripts report to.
  "connect-src 'self' https://va.vercel-scripts.com https://vitals.vercel-insights.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  // Stops a browser guessing a type for a response we served as JSON.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Belt to frame-ancestors' braces, for anything that predates CSP.
  { key: "X-Frame-Options", value: "DENY" },
  // A district page's URL names the district. Send the origin to third
  // parties, never the path.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // This site asks for none of these.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const EDGE_CACHED_PAGES = ["/instruments/consent/latest"];

// Files the tracer bundles into a function because the code reads from their
// directory, which these routes never open. Every instrument function used to
// carry the whole data folder, 67 MB, and every deployment is kept with them
// (the Hobby plan's Deployment Storage). No function reads sub-districts or
// district outlines - proposal pages are assembled in the browser - and
// nothing reads lookup.json on the server since the runtime index replaced it.
const UNREAD_BY_LISTS = [
  "public/data/instruments/consent/lookup.json",
  "public/data/instruments/consent/subdistricts.json",
  "public/geo/**",
];

// The static files proposal pages are assembled from (proposal_pages.mjs).
// Served from the CDN; no function opens them.
const PROPOSAL_FILES = ["public/view/**"];

// The runtime index (scripts/instruments/runtime_index.mjs) is read through a
// path the tracer finds today; named here so that never depends on its
// heuristics. Without it a proposal render fails loudly (lib/instruments/server.ts).
const RUNTIME_INDEX = [
  ".runtime/instruments/consent/headers.json",
  ".runtime/instruments/consent/ids/*.json",
];

// Next prerenders with one worker per CPU it can see, and each worker loads
// the instrument data: 17 workers peaked at 6.65 GB here. A build container
// that sees the host's cores but is held to 8 GB (Render's, which failed out
// of memory) needs the count set; NEXT_BUILD_CPUS does that. Left unset, the
// default stands - an `undefined` here would replace it, not defer to it.
const BUILD_CPUS = Number(process.env.NEXT_BUILD_CPUS) || 0;

const ON_VERCEL = Boolean(process.env.VERCEL);

const nextConfig = {
  ...(BUILD_CPUS ? { experimental: { cpus: BUILD_CPUS } } : {}),
  // Vercel production redirects every request to the Cloudflare Pages origin
  // (lib/moved-hosts.mjs). Previews still serve the app.
  async redirects() {
    return process.env.VERCEL_ENV === "production" ? movedRedirects() : [];
  },
  // The images are WebPs already sized for the page. Off Vercel there is no
  // optimiser worth paying for: on Pages each /_next/image request would run
  // a function against the daily allowance, so the files are linked directly.
  images: { unoptimized: !ON_VERCEL },
  // BotID's challenge is verified by Vercel and works nowhere else; the
  // browser half loads only where the server half can check it.
  env: { NEXT_PUBLIC_BOTID: ON_VERCEL ? "1" : "" },
  // Metadata in <head> for every client, as a prerendered page has it. Next
  // streams a dynamic page's title and og: tags in after the body to clients
  // it does not list as limited bots - Googlebot and browsers among them - so
  // a page rendered per request would otherwise move its title.
  htmlLimitedBots: /.*/,
  outputFileTracingIncludes: {
    "/api/instruments/consent/**": RUNTIME_INDEX,
  },
  outputFileTracingExcludes: {
    "/**": PROPOSAL_FILES,
    "/instruments/consent/latest": UNREAD_BY_LISTS,
    "/instruments/consent/feed": UNREAD_BY_LISTS,
    "/instruments/consent/district/[code]": UNREAD_BY_LISTS,
    "/api/instruments/consent/**": UNREAD_BY_LISTS,
  },
  // Every proposal is answered by one static page that reads the id from the
  // address (app/instruments/consent/view). Digits only, as proposal ids are:
  // any other path under /instruments/consent is a static 404, not a render.
  async rewrites() {
    return [
      { source: "/instruments/consent/:proposalId(\\d{1,12})", destination: "/instruments/consent/view" },
    ];
  },
  // `next build` lints once ESLint is installed. Scoped to the instrument
  // code, which is linted in CI and is clean; the rest of the site had never
  // been linted before ESLint was added, and linting it is a separate change.
  eslint: {
    dirs: [
      "app/instruments",
      "components/instruments",
      "lib/instruments",
      "app/api/instruments",
    ],
  },
  async headers() {
    return [
      {
        // Every route, including the API ones - except BotID's proxied
        // challenge path, which withBotId gives its own frame-ancestors
        // 'self'. Two CSPs on one response both apply, so ours would have
        // denied the frame BotID's challenge needs.
        source: "/:path((?!149e9513-01fa-4fb0-aad4-566afd725d1b/).*)",
        headers: SECURITY_HEADERS,
      },
      // Pages rendered per request from this deployment's files, kept at
      // Vercel's edge for a day. The CDN keys its cache on the deployment, so
      // the nightly data deploy starts afresh; browsers are not told to keep
      // anything (Vercel-CDN-Cache-Control is consumed by the CDN alone).
      ...EDGE_CACHED_PAGES.map((source) => ({
        source,
        headers: [{ key: "Vercel-CDN-Cache-Control", value: "max-age=86400" }],
      })),
    ];
  },
};

// BotID (instrumentation-client.ts) needs its challenge script and proxy
// served from this origin; withBotId adds those rewrites.
export default withBotId(nextConfig);
