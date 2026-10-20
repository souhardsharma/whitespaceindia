import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site";
import { healthConfig } from "@/lib/health/config";

const siteUrl = SITE_URL;

const PAGE_URL = `${siteUrl}/health`;
const TITLE = "Health — Whitespace India";
const DESCRIPTION =
  "Whitespace India Health: mapping public-health infrastructure gaps across 651 Indian districts. Ranks districts by health access, outcomes severity, and infrastructure shortfalls.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  openGraph: {
    title: "Whitespace India Health",
    description: DESCRIPTION,
    url: PAGE_URL,
    type: "website",
    siteName: "Whitespace India",
    locale: "en_IN",
    images: [{ url: "/og/health-2.jpg", width: 1200, height: 630, alt: "Whitespace India Health: \u201cWhere care is thin, district by district\u201d, beside a risograph print of a health centre on a hill above a village" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Whitespace India Health",
    description: DESCRIPTION,
    images: [{ url: "/og/health-2.jpg", alt: "Whitespace India Health: \u201cWhere care is thin, district by district\u201d, beside a risograph print of a health centre on a hill above a village" }],
  },
  alternates: { canonical: PAGE_URL },
  // Coming soon means synthetic placeholder data behind an overlay: kept out
  // of the index (links still followed) and out of app/sitemap.ts until the
  // config flag is lifted, which restores both.
  robots: healthConfig.comingSoon
    ? { index: false, follow: true }
    : {
        index: true,
        follow: true,
        googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
      },
};

export default function HealthLayout({ children }: { children: React.ReactNode }) {
  return children;
}
