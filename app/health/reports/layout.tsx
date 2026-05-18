import type { Metadata } from "next";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL || "https://whitespaceindia-csr.vercel.app";

export const metadata: Metadata = {
  title: "Reports — Health — Whitespace India",
  description:
    "Download health infrastructure analysis reports and district-level research briefs from Whitespace India Health.",
  alternates: { canonical: `${siteUrl}/health/reports` },
};

export default function HealthReportsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
