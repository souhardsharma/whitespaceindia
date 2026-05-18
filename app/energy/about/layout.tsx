import type { Metadata } from "next";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL || "https://whitespaceindia-csr.vercel.app";

export const metadata: Metadata = {
  title: "About — Energy — Whitespace India",
  description:
    "About the Whitespace India Energy initiative: methodology, team, and mission behind the energy access and transition gap analysis.",
  alternates: { canonical: `${siteUrl}/energy/about` },
};

export default function EnergyAboutLayout({ children }: { children: React.ReactNode }) {
  return children;
}
