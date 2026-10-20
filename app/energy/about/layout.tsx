import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site";

const siteUrl = SITE_URL;

export const metadata: Metadata = {
  title: { absolute: "About — Energy — Whitespace India" },
  description:
    "About the Whitespace India Energy initiative: methodology, team, and mission behind the energy access and transition gap analysis.",
  alternates: { canonical: `${siteUrl}/energy/about` },
  openGraph: {
    url: `${siteUrl}/energy/about`,
    title: "About — Energy — Whitespace India",
    siteName: "Whitespace India",
    type: "website",
    locale: "en_IN",
    images: [{ url: "/og/energy-2.jpg", width: 1200, height: 630, alt: "Whitespace India Energy: \u201cWhere power falls short, district by district\u201d, beside a risograph print of a house, a power pole and a solar panel on a hill" }],
  },
};

export default function EnergyAboutLayout({ children }: { children: React.ReactNode }) {
  return children;
}
