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
 * `'unsafe-inline'` and `'unsafe-eval'` are in `script-src` because Next's
 * App Router inlines its hydration payload and its runtime uses `eval` in
 * development. A nonce-based policy is the right end state and needs the
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
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://va.vercel-scripts.com",
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

const nextConfig = {
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
        // Every route, including the API ones.
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
