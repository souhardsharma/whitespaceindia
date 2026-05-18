import type { Metadata } from "next";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL || "https://whitespaceindia-csr.vercel.app";

export const metadata: Metadata = {
  title: "Reports — Education — Whitespace India",
  description:
    "Download education infrastructure analysis reports and district-level research briefs from Whitespace India Education.",
  alternates: { canonical: `${siteUrl}/education/reports` },
};

export default function EducationReportsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
