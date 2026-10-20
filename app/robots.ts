import type { MetadataRoute } from "next";
import { stateSlugs } from "@/lib/instruments/server";

const BASE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || "https://whitespaceindia-csr.vercel.app";

/**
 * Dynamic robots.txt. Replaces the static public/robots.txt so the sitemap
 * URL automatically tracks NEXT_PUBLIC_SITE_URL across environments instead
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
        disallow: ["/api/", "/_next/image"],
      },
    ],
    // The site's own pages, then one sitemap per filing state for the
    // proposal pages (app/instruments/consent/sitemap.ts). Next does not write
    // a sitemap index for generated sitemaps, so they are listed here.
    sitemap: [
      `${BASE_URL}/sitemap.xml`,
      ...stateSlugs().map((_, i) => `${BASE_URL}/instruments/consent/sitemap/${i}.xml`),
    ],
    host: BASE_URL,
  };
}
