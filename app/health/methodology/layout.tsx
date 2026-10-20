import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site";

const siteUrl = SITE_URL;

export const metadata: Metadata = {
  title: { absolute: "Methodology — Health — Whitespace India" },
  description:
    "How the Whitespace India Health index scores and ranks 651 districts by health access, outcomes, and infrastructure gaps.",
  alternates: { canonical: `${siteUrl}/health/methodology` },
  openGraph: {
    url: `${siteUrl}/health/methodology`,
    title: "Methodology — Health — Whitespace India",
    siteName: "Whitespace India",
    type: "website",
    locale: "en_IN",
    images: [{ url: "/og/health.png", width: 1200, height: 630, alt: "Whitespace India Health" }],
  },
};

export default function HealthMethodologyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
