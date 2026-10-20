import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site";
import { energyConfig } from "@/lib/energy/config";

const siteUrl = SITE_URL;

const PAGE_URL = `${siteUrl}/energy`;
const TITLE = "Energy — Whitespace India";
const DESCRIPTION =
  "Whitespace India Energy: mapping energy access and transition gaps across 651 Indian districts. Ranks districts by supply deficit, access equity, and transition readiness.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  openGraph: {
    title: "Whitespace India Energy",
    description: DESCRIPTION,
    url: PAGE_URL,
    type: "website",
    siteName: "Whitespace India",
    locale: "en_IN",
    images: [{ url: "/og/energy.png", width: 1200, height: 630, alt: "Whitespace India Energy" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Whitespace India Energy",
    description: DESCRIPTION,
    images: [{ url: "/og/energy.png", alt: "Whitespace India Energy" }],
  },
  alternates: { canonical: PAGE_URL },
  // Coming soon means synthetic placeholder data behind an overlay: kept out
  // of the index (links still followed) and out of app/sitemap.ts until the
  // config flag is lifted, which restores both.
  robots: energyConfig.comingSoon
    ? { index: false, follow: true }
    : {
        index: true,
        follow: true,
        googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
      },
};

export default function EnergyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
