import type { Metadata } from "next";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL || "https://whitespaceindia-csr.vercel.app";

const PAGE_URL = `${siteUrl}/education`;
const TITLE = "Education — Whitespace India";
const DESCRIPTION =
  "Whitespace India Education: mapping education infrastructure gaps across 651 Indian districts. Ranks districts by school access, learning outcomes, and infrastructure shortfalls.";

export const metadata: Metadata = {
  title: TITLE,
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
    creator: "@souaboroq",
    images: ["/og/education.png"],
  },
  alternates: { canonical: PAGE_URL },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
};

export default function EducationLayout({ children }: { children: React.ReactNode }) {
  return children;
}
