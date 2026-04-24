import { MetadataRoute } from "next";

const BASE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || "https://whitespaceindia-csr.vercel.app";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: BASE_URL,
      lastModified: "2026-04-22",
      changeFrequency: "monthly",
      priority: 1.0,
    },
    {
      url: `${BASE_URL}/methodology`,
      lastModified: "2026-04-22",
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/about`,
      lastModified: "2026-04-22",
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${BASE_URL}/reports`,
      lastModified: "2026-04-22",
      changeFrequency: "monthly",
      priority: 0.6,
    },
  ];
}
