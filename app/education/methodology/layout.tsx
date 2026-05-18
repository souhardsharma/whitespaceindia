import type { Metadata } from "next";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL || "https://whitespaceindia-csr.vercel.app";

export const metadata: Metadata = {
  title: "Methodology — Education — Whitespace India",
  description:
    "How the Whitespace India Education index scores and ranks 651 districts by school access, learning outcomes, and infrastructure gaps.",
  alternates: { canonical: `${siteUrl}/education/methodology` },
};

export default function EducationMethodologyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
