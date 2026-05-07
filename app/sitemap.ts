import { MetadataRoute } from "next";

const BASE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || "https://whitespaceindia-csr.vercel.app";

/**
 * lastModified should be stable per-deployment. We prefer the commit author
 * date (set automatically by Vercel) so the sitemap only changes when the
 * underlying content actually changed. Falling back to "now" on every render
 * causes Google to discount the freshness signal — every page would always
 * look "just updated", which is a known low-quality pattern.
 */
const LAST_MODIFIED = (() => {
  const raw =
    process.env.VERCEL_GIT_COMMIT_AUTHOR_DATE ||
    process.env.NEXT_PUBLIC_BUILD_TIME;
  if (raw) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
})();

export default function sitemap(): MetadataRoute.Sitemap {
  // Priority is relative within this sitemap, not absolute. The CSR app and
  // landing are top-tier (real, fully-built pages); methodology/about are
  // secondary anchors; reports is a roadmap page; the placeholder verticals
  // are lowest because they're "coming soon" cards.
  return [
    {
      url: `${BASE_URL}/`,
      lastModified: LAST_MODIFIED,
      changeFrequency: "monthly",
      priority: 1.0,
    },
    {
      url: `${BASE_URL}/csr`,
      lastModified: LAST_MODIFIED,
      changeFrequency: "monthly",
      priority: 0.95,
    },
    {
      url: `${BASE_URL}/methodology`,
      lastModified: LAST_MODIFIED,
      changeFrequency: "monthly",
      priority: 0.85,
    },
    {
      url: `${BASE_URL}/about`,
      lastModified: LAST_MODIFIED,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/reports`,
      lastModified: LAST_MODIFIED,
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      url: `${BASE_URL}/health`,
      lastModified: LAST_MODIFIED,
      changeFrequency: "yearly",
      priority: 0.4,
    },
    {
      url: `${BASE_URL}/education`,
      lastModified: LAST_MODIFIED,
      changeFrequency: "yearly",
      priority: 0.4,
    },
    {
      url: `${BASE_URL}/energy`,
      lastModified: LAST_MODIFIED,
      changeFrequency: "yearly",
      priority: 0.4,
    },
  ];
}
