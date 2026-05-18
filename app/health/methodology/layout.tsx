import type { Metadata } from "next";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL || "https://whitespaceindia-csr.vercel.app";

export const metadata: Metadata = {
  title: "Methodology — Health — Whitespace India",
  description:
    "How the Whitespace India Health index scores and ranks 651 districts by health access, outcomes, and infrastructure gaps.",
  alternates: { canonical: `${siteUrl}/health/methodology` },
};

export default function HealthMethodologyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
