import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site";

const siteUrl = SITE_URL;

export const metadata: Metadata = {
  title: { absolute: "About the Education Index | Whitespace India" },
  description:
    "What the Whitespace India Education index will measure, and the public sources it will draw on.",
  alternates: { canonical: `${siteUrl}/education/about` },
  openGraph: {
    url: `${siteUrl}/education/about`,
    title: "About the Education Index | Whitespace India",
    siteName: "Whitespace India",
    type: "website",
    locale: "en_IN",
    images: [{ url: "/og/education-3.jpg", width: 1200, height: 630, alt: "Whitespace India Education: \u201cWhere schools fall behind, district by district\u201d, beside a risograph print of a village schoolhouse and an open book" }],
  },
};

export default function EducationAboutLayout({ children }: { children: React.ReactNode }) {
  return children;
}
