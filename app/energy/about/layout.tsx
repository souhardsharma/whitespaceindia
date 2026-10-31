import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site";

const siteUrl = SITE_URL;

export const metadata: Metadata = {
  title: { absolute: "About the Energy Index | Whitespace India" },
  description:
    "What the Whitespace India Energy index will measure, and the public sources it will draw on.",
  alternates: { canonical: `${siteUrl}/energy/about` },
  openGraph: {
    url: `${siteUrl}/energy/about`,
    title: "About the Energy Index | Whitespace India",
    siteName: "Whitespace India",
    type: "website",
    locale: "en_IN",
    images: [{ url: "/og/energy-4.jpg", width: 1200, height: 630, alt: "Whitespace India Energy: \u201cWhere power falls short, district by district\u201d, beside a risograph print of a house, a power pole and a solar panel on a hill" }],
  },
};

export default function EnergyAboutLayout({ children }: { children: React.ReactNode }) {
  return children;
}
