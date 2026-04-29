import { MetadataRoute } from "next";

const BASE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || "https://whitespaceindia-csr.vercel.app";

// lastModified reflects the last deployment time (set per-build via env or
// defaulting to now) rather than a hardcoded date that rots silently.
const LAST_MODIFIED =
  process.env.VERCEL_GIT_COMMIT_AUTHOR_DATE ||
  process.env.NEXT_PUBLIC_BUILD_TIME ||
  new Date().toISOString();

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: BASE_URL, lastModified: LAST_MODIFIED, changeFrequency: "monthly", priority: 1.0 },
    { url: `${BASE_URL}/csr`, lastModified: LAST_MODIFIED, changeFrequency: "monthly", priority: 0.95 },
    { url: `${BASE_URL}/methodology`, lastModified: LAST_MODIFIED, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE_URL}/about`, lastModified: LAST_MODIFIED, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE_URL}/reports`, lastModified: LAST_MODIFIED, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE_URL}/health`, lastModified: LAST_MODIFIED, changeFrequency: "yearly", priority: 0.4 },
    { url: `${BASE_URL}/education`, lastModified: LAST_MODIFIED, changeFrequency: "yearly", priority: 0.4 },
    { url: `${BASE_URL}/energy`, lastModified: LAST_MODIFIED, changeFrequency: "yearly", priority: 0.4 },
  ];
}
