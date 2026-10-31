import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site";

const siteUrl = SITE_URL;

export const metadata: Metadata = {
  title: { absolute: "Health Index Methodology | Whitespace India" },
  description:
    "How the Whitespace India Health index will score and rank 651 districts by access to care, health outcomes and infrastructure gaps.",
  alternates: { canonical: `${siteUrl}/health/methodology` },
  openGraph: {
    url: `${siteUrl}/health/methodology`,
    title: "Health Index Methodology | Whitespace India",
    siteName: "Whitespace India",
    type: "website",
    locale: "en_IN",
    images: [{ url: "/og/health-4.jpg", width: 1200, height: 630, alt: "Whitespace India Health: \u201cWhere care is thin, district by district\u201d, beside a risograph print of a health centre on a hill above a village" }],
  },
};

export default function HealthMethodologyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
