import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site";

const siteUrl = SITE_URL;

export const metadata: Metadata = {
  title: { absolute: "About — Education — Whitespace India" },
  description:
    "About the Whitespace India Education initiative: methodology, team, and mission behind the education infrastructure gap analysis.",
  alternates: { canonical: `${siteUrl}/education/about` },
  openGraph: {
    url: `${siteUrl}/education/about`,
    title: "About — Education — Whitespace India",
    siteName: "Whitespace India",
    type: "website",
    locale: "en_IN",
    images: [{ url: "/og/education.png", width: 1200, height: 630, alt: "Whitespace India Education" }],
  },
};

export default function EducationAboutLayout({ children }: { children: React.ReactNode }) {
  return children;
}
