import type { MetadataRoute } from "next";

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
        disallow: ["/api/", "/_next/"],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
    host: BASE_URL,
  };
}
