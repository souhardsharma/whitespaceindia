import { stateSlugs } from "@/lib/instruments/server";
import { SITE_URL } from "@/lib/site";

/**
 * A sitemap index over the site's sitemaps.
 *
 * Next writes no index for sitemaps made with generateSitemaps(), so the 35
 * per-state proposal sitemaps were reachable only through robots.txt and
 * Search Console tracked /sitemap.xml alone - the proposal pages, most of the
 * site's URLs, had no submitted sitemap and no coverage report. Submitting
 * this one file covers all of them, and a new filing state joins it on the
 * next build without anyone resubmitting anything.
 */
export function GET() {
  const urls = [
    `${SITE_URL}/sitemap.xml`,
    ...stateSlugs().map((_, i) => `${SITE_URL}/instruments/consent/sitemap/${i}.xml`),
  ];
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <sitemap><loc>${u}</loc></sitemap>`).join("\n") +
    `\n</sitemapindex>\n`;
  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
