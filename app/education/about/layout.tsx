import type { Metadata } from "next";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL || "https://whitespaceindia-csr.vercel.app";

export const metadata: Metadata = {
  title: "About — Education — Whitespace India",
  description:
    "About the Whitespace India Education initiative: methodology, team, and mission behind the education infrastructure gap analysis.",
  alternates: { canonical: `${siteUrl}/education/about` },
};

export default function EducationAboutLayout({ children }: { children: React.ReactNode }) {
  return children;
}
