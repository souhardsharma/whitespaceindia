import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site";

const siteUrl = SITE_URL;

export const metadata: Metadata = {
  title: { absolute: "Reports — Health — Whitespace India" },
  description:
    "Download health infrastructure analysis reports and district-level research briefs from Whitespace India Health.",
  alternates: { canonical: `${siteUrl}/health/reports` },
  openGraph: {
    url: `${siteUrl}/health/reports`,
    title: "Reports — Health — Whitespace India",
    siteName: "Whitespace India",
    type: "website",
    locale: "en_IN",
    images: [{ url: "/og/health-2.jpg", width: 1200, height: 630, alt: "Whitespace India Health: \u201cWhere care is thin, district by district\u201d, beside a risograph print of a health centre on a hill above a village" }],
  },
};

export default function HealthReportsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
