import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site";
import { educationConfig } from "@/lib/education/config";

const siteUrl = SITE_URL;

const PAGE_URL = `${siteUrl}/education`;
const TITLE = "Education — Whitespace India";
const DESCRIPTION =
  "Whitespace India Education: mapping education infrastructure gaps across 651 Indian districts. Ranks districts by school access, learning outcomes, and infrastructure shortfalls.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  openGraph: {
    title: "Whitespace India Education",
    description: DESCRIPTION,
    url: PAGE_URL,
    type: "website",
    siteName: "Whitespace India",
    locale: "en_IN",
    images: [{ url: "/og/education.png", width: 1200, height: 630, alt: "Whitespace India Education" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Whitespace India Education",
    description: DESCRIPTION,
    images: [{ url: "/og/education.png", alt: "Whitespace India Education" }],
  },
  alternates: { canonical: PAGE_URL },
  // Coming soon means synthetic placeholder data behind an overlay: kept out
  // of the index (links still followed) and out of app/sitemap.ts until the
  // config flag is lifted, which restores both.
  robots: educationConfig.comingSoon
    ? { index: false, follow: true }
    : {
        index: true,
        follow: true,
        googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
      },
};

export default function EducationLayout({ children }: { children: React.ReactNode }) {
  return children;
}
