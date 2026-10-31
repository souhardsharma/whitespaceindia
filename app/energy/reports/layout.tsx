import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site";

const siteUrl = SITE_URL;

export const metadata: Metadata = {
  title: { absolute: "Energy Index Reports | Whitespace India" },
  description:
    "District reports and research briefs from Whitespace India Energy, to be published when the index goes live.",
  alternates: { canonical: `${siteUrl}/energy/reports` },
  openGraph: {
    url: `${siteUrl}/energy/reports`,
    title: "Energy Index Reports | Whitespace India",
    siteName: "Whitespace India",
    type: "website",
    locale: "en_IN",
    images: [{ url: "/og/energy-4.jpg", width: 1200, height: 630, alt: "Whitespace India Energy: \u201cWhere power falls short, district by district\u201d, beside a risograph print of a house, a power pole and a solar panel on a hill" }],
  },
};

export default function EnergyReportsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
