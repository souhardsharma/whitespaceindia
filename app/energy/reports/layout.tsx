import type { Metadata } from "next";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL || "https://whitespaceindia-csr.vercel.app";

export const metadata: Metadata = {
  title: "Reports — Energy — Whitespace India",
  description:
    "Download energy access and transition analysis reports and district-level research briefs from Whitespace India Energy.",
  alternates: { canonical: `${siteUrl}/energy/reports` },
};

export default function EnergyReportsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
