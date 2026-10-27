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
        // so letting a crawler fetch it costs nothing.
        //
        // "?_rsc=" is the React Server Components payload a <Link> prefetch
        // asks for: the same page again in another format. Crawlers that run
        // JavaScript requested it for every proposal they saw linked, and on
        // a free Vercel plan each one is an on-demand render.
        disallow: ["/api/", "/_next/image", "/*?_rsc=", "/*&_rsc="],
      },
      {
        // Google's non-Search crawler (research and product fetches). It
        // feeds no search result and crawled ~90,000 proposal pages in a day,
        // exhausting the plan's origin transfer. Googlebot is unaffected.
        userAgent: ["GoogleOther", "GoogleOther-Image", "GoogleOther-Video"],
        disallow: "/",
      },
    ],
    // One index naming the site's own sitemap and the per-state proposal
    // sitemaps (app/sitemap-index.xml/route.ts), so a new filing state needs
    // no change here.
    sitemap: `${BASE_URL}/sitemap-index.xml`,
  };
}
