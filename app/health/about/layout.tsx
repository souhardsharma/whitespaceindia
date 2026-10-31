import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site";

const siteUrl = SITE_URL;

export const metadata: Metadata = {
  title: { absolute: "About the Health Index | Whitespace India" },
  description:
    "What the Whitespace India Health index will measure, and the public sources it will draw on.",
  alternates: { canonical: `${siteUrl}/health/about` },
  openGraph: {
    url: `${siteUrl}/health/about`,
    title: "About the Health Index | Whitespace India",
    siteName: "Whitespace India",
    type: "website",
    locale: "en_IN",
    images: [{ url: "/og/health-4.jpg", width: 1200, height: 630, alt: "Whitespace India Health: \u201cWhere care is thin, district by district\u201d, beside a risograph print of a health centre on a hill above a village" }],
  },
};

export default function HealthAboutLayout({ children }: { children: React.ReactNode }) {
  return children;
}
