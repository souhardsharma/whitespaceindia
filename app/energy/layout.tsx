import type { Metadata } from "next";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL || "https://whitespaceindia-csr.vercel.app";

const PAGE_URL = `${siteUrl}/energy`;
const TITLE = "Energy — Whitespace India";
const DESCRIPTION =
  "Whitespace India Energy: mapping energy access and transition gaps across 651 Indian districts. Ranks districts by supply deficit, access equity, and transition readiness.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: "Whitespace India Energy",
    description: DESCRIPTION,
    url: PAGE_URL,
    type: "website",
    siteName: "Whitespace India",
    locale: "en_IN",
    images: [{ url: "/og/csr.png", width: 1200, height: 630, alt: "Whitespace India" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Whitespace India Energy",
    description: DESCRIPTION,
    creator: "@souaboroq",
    images: ["/og/csr.png"],
  },
  alternates: { canonical: PAGE_URL },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
};

export default function EnergyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
