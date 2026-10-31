import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site";
import { healthConfig } from "@/lib/health/config";

const siteUrl = SITE_URL;

const PAGE_URL = `${siteUrl}/health`;
const TITLE = "Health Index (Preview) | Whitespace India";
const DESCRIPTION =
  "Whitespace India Health, a planned index of public health gaps across 651 Indian districts, ranked by access to care, the severity of health outcomes and infrastructure shortfalls. In preview on placeholder data.";

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
    images: [{ url: "/og/health-4.jpg", width: 1200, height: 630, alt: "Whitespace India Health: \u201cWhere care is thin, district by district\u201d, beside a risograph print of a health centre on a hill above a village" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Whitespace India Health",
    description: DESCRIPTION,
    images: [{ url: "/og/health-4.jpg", alt: "Whitespace India Health: \u201cWhere care is thin, district by district\u201d, beside a risograph print of a health centre on a hill above a village" }],
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
