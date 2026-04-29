import type { Metadata } from "next";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL || "https://whitespaceindia-csr.vercel.app";

export const metadata: Metadata = {
  title: "Methodology",
  description:
    "Detailed methodology behind the Philanthropic Opportunity Score (POS). Learn how we process NITI Aayog MPI poverty data and MCA CSR spending data across 651 Indian districts.",
  openGraph: {
    title: "Methodology — Whitespace India CSR",
    description:
      "How we measure the gap between poverty and philanthropic funding. Three public datasets, six pipeline stages, one composite score.",
    url: `${siteUrl}/methodology`,
    images: [{ url: "/og/csr.png", width: 1200, height: 630 }],
    type: "website",
    siteName: "Whitespace India CSR",
  },
  twitter: {
    card: "summary_large_image",
    title: "Methodology — Whitespace India CSR",
    description:
      "How we measure the gap between poverty and philanthropic funding across 651 Indian districts.",
    creator: "@souaboroq",
  },
  alternates: {
    canonical: `${siteUrl}/methodology`,
  },
};

export default function MethodologyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
