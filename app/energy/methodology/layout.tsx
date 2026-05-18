import type { Metadata } from "next";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL || "https://whitespaceindia-csr.vercel.app";

export const metadata: Metadata = {
  title: "Methodology — Energy — Whitespace India",
  description:
    "How the Whitespace India Energy index scores and ranks 651 districts by supply deficit, access equity, and transition readiness.",
  alternates: { canonical: `${siteUrl}/energy/methodology` },
};

export default function EnergyMethodologyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
