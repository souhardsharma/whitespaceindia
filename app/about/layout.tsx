import type { Metadata } from "next";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL || "https://whitespaceindia-csr.vercel.app";

const PAGE_URL = `${siteUrl}/about`;

const TITLE = "About | Whitespace India CSR — The Philanthropic Opportunity Score";
const DESCRIPTION =
  "Why Whitespace India CSR exists, who built it, and how it quantifies the gap between where CSR money goes in India and where it is most needed across 651 districts. Built on NITI Aayog MPI poverty data, MCA CSR filings, and Census 2011 — fully open and reproducible.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { absolute: TITLE },
  description: DESCRIPTION,
  keywords: [
    "About Whitespace India",
    "CSR opportunity index",
    "Philanthropic Opportunity Score",
    "POS score India",
    "CSR vs poverty India",
    "NITI Aayog MPI",
    "MCA CSR data",
    "district level CSR India",
    "Bihar CSR per person",
    "Maharashtra CSR per person",
    "Souhard Sharma",
  ],
  openGraph: {
    title: "About — Whitespace India CSR",
    description:
      "Quantifying the gap between where philanthropic money goes in India and where people need it most. Three public datasets, one composite Opportunity Score.",
    url: PAGE_URL,
    images: [{ url: "/og/csr.png", width: 1200, height: 630, alt: "About Whitespace India CSR" }],
    type: "website",
    siteName: "Whitespace India CSR",
    locale: "en_IN",
  },
  twitter: {
    card: "summary_large_image",
    title: "About — Whitespace India CSR",
    description:
      "Why this tool exists and how it measures India's philanthropic funding gap across 651 districts.",
    creator: "@souaboroq",
    images: ["/og/csr.png"],
  },
  alternates: { canonical: PAGE_URL },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};

const PAGE_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "AboutPage",
      "@id": `${PAGE_URL}#page`,
      url: PAGE_URL,
      name: TITLE,
      description: DESCRIPTION,
      isPartOf: { "@id": `${siteUrl}/#site` },
      about: { "@id": `${siteUrl}/#org` },
      primaryImageOfPage: { "@type": "ImageObject", url: `${siteUrl}/og/csr.png` },
      inLanguage: "en-IN",
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Whitespace India", item: `${siteUrl}/` },
        { "@type": "ListItem", position: 2, name: "CSR", item: `${siteUrl}/csr` },
        { "@type": "ListItem", position: 3, name: "About", item: PAGE_URL },
      ],
    },
  ],
};

export default function AboutLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(PAGE_LD) }}
      />
      {children}
    </>
  );
}
