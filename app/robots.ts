import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

const BASE_URL = SITE_URL;

/**
 * Dynamic robots.txt. Replaces the static public/robots.txt so the sitemap
 * URL follows the site's one origin (lib/site.ts) instead
 * of being hardcoded to a single host.
 *
 * If both files coexist Next.js prefers app/robots.ts and ignores the static
 * one — public/robots.txt has been removed accordingly.
 */
// Never fetched by any page, and each is a server render per query string:
// the change log's filters (~620 district pages link one) and its feed.
const RENDERED_PER_QUERY = ["/instruments/consent/latest?", "/instruments/consent/feed?"];

const EVERYONE_DISALLOWED = ["/api/", "/_next/image", "/*?_rsc=", "/*&_rsc=", ...RENDERED_PER_QUERY,
  // The static file every proposal is served from, under its own name.
  "/instruments/consent/view"];

// Every proposal page, /instruments/consent/<digits>, and the files it is
// assembled from. robots.txt has no character classes, so one prefix a digit.
const PROPOSAL_PAGES = [..."0123456789"].map((d) => `/instruments/consent/${d}`).concat("/view/");

/**
 * Crawlers that feed no search result and walk every URL they find. A static
 * page costs no compute, but each fetch is still one of the Hobby plan's
 * million monthly edge requests, and one walk of the register is ~92,000.
 * They keep the district pages, the methodology and the data downloads.
 */
const MASS_CRAWLERS = [
  "Amazonbot", "GPTBot", "ClaudeBot", "anthropic-ai", "CCBot", "Bytespider",
  "meta-externalagent", "FacebookBot", "PerplexityBot", "cohere-ai", "Diffbot",
  "ImagesiftBot", "Timpibot", "omgili",
];

/** Search-marketing crawlers: they index sites for paying customers, not readers. */
const SEO_TOOLS = [
  "SemrushBot", "AhrefsBot", "MJ12bot", "DotBot", "DataForSeoBot", "BLEXBot",
  "PetalBot", "barkrowler",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // NOT "/_next/". Next serves every stylesheet and script from
        // /_next/static/, so disallowing that prefix blocked the
        // render-critical resources of all 642 sitemap URLs - Google renders
        // the pages with no CSS and no JS and reports "Page resources
        // couldn't be loaded" site-wide. robots.txt matching is
        // longest-prefix, so "Disallow: /_next/" beat "Allow: /" for every
        // bundle. Only the image optimiser is excluded, which is a genuine
        // crawl-budget sink; /_next/static is content-hashed and immutable,
        // so letting a crawler fetch it costs nothing. For the same reason
        // /view/ stays open here: Googlebot renders a proposal from it.
        //
        // "?_rsc=" is the React Server Components payload a <Link> prefetch
        // asks for: the same page again in another format. Crawlers that run
        // JavaScript requested it for every proposal they saw linked, and on
        // a free Vercel plan each one is an on-demand render.
        disallow: EVERYONE_DISALLOWED,
      },
      {
        // A crawler named in a group of its own ignores the "*" group, so
        // each group repeats what everyone is kept out of.
        userAgent: MASS_CRAWLERS,
        allow: "/",
        disallow: [...EVERYONE_DISALLOWED, ...PROPOSAL_PAGES],
      },
      {
        // Google's non-Search crawler (research and product fetches). It
        // feeds no search result and crawled ~90,000 proposal pages in a day,
        // exhausting the plan's origin transfer. Googlebot is unaffected.
        userAgent: ["GoogleOther", "GoogleOther-Image", "GoogleOther-Video", ...SEO_TOOLS],
        disallow: "/",
      },
    ],
    // One index naming the site's own sitemap and the per-state proposal
    // sitemaps (app/sitemap-index.xml/route.ts), so a new filing state needs
    // no change here.
    sitemap: `${BASE_URL}/sitemap-index.xml`,
  };
}
