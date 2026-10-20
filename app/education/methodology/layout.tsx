import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site";

const siteUrl = SITE_URL;

export const metadata: Metadata = {
  title: { absolute: "Methodology — Education — Whitespace India" },
  description:
    "How the Whitespace India Education index scores and ranks 651 districts by school access, learning outcomes, and infrastructure gaps.",
  alternates: { canonical: `${siteUrl}/education/methodology` },
  openGraph: {
    url: `${siteUrl}/education/methodology`,
    title: "Methodology — Education — Whitespace India",
    siteName: "Whitespace India",
    type: "website",
    locale: "en_IN",
    images: [{ url: "/og/education.png", width: 1200, height: 630, alt: "Whitespace India Education" }],
  },
};

export default function EducationMethodologyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
