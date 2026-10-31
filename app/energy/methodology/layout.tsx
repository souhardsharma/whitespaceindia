import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site";

const siteUrl = SITE_URL;

export const metadata: Metadata = {
  title: { absolute: "Energy Index Methodology | Whitespace India" },
  description:
    "How the Whitespace India Energy index will score and rank 651 districts by supply deficit, household access and distance from renewable targets.",
  alternates: { canonical: `${siteUrl}/energy/methodology` },
  openGraph: {
    url: `${siteUrl}/energy/methodology`,
    title: "Energy Index Methodology | Whitespace India",
    siteName: "Whitespace India",
    type: "website",
    locale: "en_IN",
    images: [{ url: "/og/energy-4.jpg", width: 1200, height: 630, alt: "Whitespace India Energy: \u201cWhere power falls short, district by district\u201d, beside a risograph print of a house, a power pole and a solar panel on a hill" }],
  },
};

export default function EnergyMethodologyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
