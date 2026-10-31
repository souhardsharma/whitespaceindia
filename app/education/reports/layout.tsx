import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site";

const siteUrl = SITE_URL;

export const metadata: Metadata = {
  title: { absolute: "Education Index Reports | Whitespace India" },
  description:
    "District reports and research briefs from Whitespace India Education, to be published when the index goes live.",
  alternates: { canonical: `${siteUrl}/education/reports` },
  openGraph: {
    url: `${siteUrl}/education/reports`,
    title: "Education Index Reports | Whitespace India",
    siteName: "Whitespace India",
    type: "website",
    locale: "en_IN",
    images: [{ url: "/og/education-4.jpg", width: 1200, height: 630, alt: "Whitespace India Education: \u201cWhere schools fall behind, district by district\u201d, beside a risograph print of a village schoolhouse and an open book" }],
  },
};

export default function EducationReportsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
