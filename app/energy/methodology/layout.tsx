import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site";

const siteUrl = SITE_URL;

export const metadata: Metadata = {
  title: { absolute: "Methodology — Energy — Whitespace India" },
  description:
    "How the Whitespace India Energy index scores and ranks 651 districts by supply deficit, access equity, and transition readiness.",
  alternates: { canonical: `${siteUrl}/energy/methodology` },
  openGraph: {
    url: `${siteUrl}/energy/methodology`,
    title: "Methodology — Energy — Whitespace India",
    siteName: "Whitespace India",
    type: "website",
    locale: "en_IN",
    images: [{ url: "/og/energy.png", width: 1200, height: 630, alt: "Whitespace India Energy" }],
  },
};

export default function EnergyMethodologyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
