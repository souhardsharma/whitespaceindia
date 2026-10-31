import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site";

const siteUrl = SITE_URL;

export const metadata: Metadata = {
  title: { absolute: "Education Index Methodology | Whitespace India" },
  description:
    "How the Whitespace India Education index will score and rank 651 districts by access to schools, learning outcomes and infrastructure gaps.",
  alternates: { canonical: `${siteUrl}/education/methodology` },
  openGraph: {
    url: `${siteUrl}/education/methodology`,
    title: "Education Index Methodology | Whitespace India",
    siteName: "Whitespace India",
    type: "website",
    locale: "en_IN",
    images: [{ url: "/og/education-4.jpg", width: 1200, height: 630, alt: "Whitespace India Education: \u201cWhere schools fall behind, district by district\u201d, beside a risograph print of a village schoolhouse and an open book" }],
  },
};

export default function EducationMethodologyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
