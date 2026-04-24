import type { Metadata } from "next";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL || "https://whitespaceindia-csr.vercel.app";

export const metadata: Metadata = {
  title: "About",
  description:
    "About the Whitespace India CSR project — quantifying the gap between where philanthropic money goes and where people need it most, across 651 Indian districts.",
  openGraph: {
    title: "About — Whitespace India CSR",
    description:
      "Who built this tool, why it matters, and how we measure the philanthropic funding gap across India.",
    url: `${siteUrl}/about`,
    images: [{ url: "/images/og-image.png", width: 1200, height: 630 }],
    type: "website",
    siteName: "Whitespace India CSR",
  },
  twitter: {
    card: "summary_large_image",
    title: "About — Whitespace India CSR",
    description:
      "Who built this tool, why it matters, and how we measure the philanthropic funding gap across India.",
    creator: "@souaboroq",
  },
  alternates: {
    canonical: `${siteUrl}/about`,
  },
};

export default function AboutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
