import type { Metadata } from "next";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL || "https://whitespaceindia-csr.vercel.app";

export const metadata: Metadata = {
  title: "About — Health — Whitespace India",
  description:
    "About the Whitespace India Health initiative: methodology, team, and mission behind the public health infrastructure gap analysis.",
  alternates: { canonical: `${siteUrl}/health/about` },
};

export default function HealthAboutLayout({ children }: { children: React.ReactNode }) {
  return children;
}
