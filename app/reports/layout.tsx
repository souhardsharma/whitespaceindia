import type { Metadata } from "next";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL || "https://whitespaceindia-csr.vercel.app";

export const metadata: Metadata = {
  title: "Reports & Analysis",
  description:
    "In-depth CSR research reports, thematic district profiles, and deep-dive analytics on Indian philanthropic whitespaces.",
  openGraph: {
    title: "Reports & Analysis — Whitespace India CSR",
    description:
      "In-depth district profiling, thematic studies, and funder analyses for India's philanthropic landscape.",
    url: `${siteUrl}/reports`,
    images: [{ url: "/images/og-image.png", width: 1200, height: 630 }],
    type: "website",
    siteName: "Whitespace India CSR",
  },
  twitter: {
    card: "summary_large_image",
    title: "Reports & Analysis — Whitespace India CSR",
    description:
      "In-depth district profiling, thematic studies, and funder analyses for India's philanthropic landscape.",
    creator: "@souaboroq",
  },
  alternates: {
    canonical: `${siteUrl}/reports`,
  },
};

export default function ReportsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
