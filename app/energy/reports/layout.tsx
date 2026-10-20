import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site";

const siteUrl = SITE_URL;

export const metadata: Metadata = {
  title: { absolute: "Reports — Energy — Whitespace India" },
  description:
    "Download energy access and transition analysis reports and district-level research briefs from Whitespace India Energy.",
  alternates: { canonical: `${siteUrl}/energy/reports` },
  openGraph: {
    url: `${siteUrl}/energy/reports`,
    title: "Reports — Energy — Whitespace India",
    siteName: "Whitespace India",
    type: "website",
    locale: "en_IN",
    images: [{ url: "/og/energy.png", width: 1200, height: 630, alt: "Whitespace India Energy" }],
  },
};

export default function EnergyReportsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
