import type { Metadata } from "next";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL || "https://whitespaceindia-csr.vercel.app";

const PAGE_URL = `${siteUrl}/methodology`;

const TITLE = "Methodology | Philanthropic Opportunity Score (POS) — Whitespace India CSR";
const DESCRIPTION =
  "The full methodology behind the Philanthropic Opportunity Score: six pipeline stages from raw NITI Aayog MPI poverty data and MCA CSR filings to a composite district-level score. Includes name reconciliation, post-2011 carve-out recasting, population tiering, normalization, and weighted aggregation across 651 Indian districts.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { absolute: TITLE },
  description: DESCRIPTION,
  keywords: [
    "Philanthropic Opportunity Score methodology",
    "POS methodology",
    "CSR methodology India",
    "NITI Aayog MPI",
    "MCA CSR data",
    "Census 2011 India",
    "composite indicator",
    "OECD composite indicators",
    "min-max normalization",
    "district fuzzy matching",
    "Alkire-Foster method",
    "rapidfuzz fuzzy match",
  ],
  openGraph: {
    title: "Methodology — Whitespace India CSR",
    description:
      "How we measure the gap between poverty and philanthropic funding. Six pipeline stages, three public datasets, one composite Opportunity Score across 651 Indian districts.",
    url: PAGE_URL,
    images: [{ url: "/og/csr.png", width: 1200, height: 630, alt: "Methodology — Whitespace India CSR" }],
    type: "article",
    siteName: "Whitespace India CSR",
    locale: "en_IN",
  },
  twitter: {
    card: "summary_large_image",
    title: "Methodology — Whitespace India CSR",
    description:
      "Six pipeline stages, three public datasets, one composite POS score across 651 Indian districts.",
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
      "@type": "TechArticle",
      "@id": `${PAGE_URL}#article`,
      url: PAGE_URL,
      headline: "Philanthropic Opportunity Score — Methodology",
      name: TITLE,
      description: DESCRIPTION,
      isPartOf: { "@id": `${siteUrl}/#site` },
      author: { "@id": `${siteUrl}/#org` },
      publisher: { "@id": `${siteUrl}/#org` },
      mainEntityOfPage: PAGE_URL,
      image: `${siteUrl}/og/csr.png`,
      inLanguage: "en-IN",
      proficiencyLevel: "Expert",
      about: [
        { "@type": "Thing", name: "Corporate Social Responsibility in India" },
        { "@type": "Thing", name: "Multidimensional Poverty Index" },
        { "@type": "Thing", name: "Composite indicators" },
      ],
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Whitespace India", item: `${siteUrl}/` },
        { "@type": "ListItem", position: 2, name: "CSR", item: `${siteUrl}/csr` },
        { "@type": "ListItem", position: 3, name: "Methodology", item: PAGE_URL },
      ],
    },
  ],
};

export default function MethodologyLayout({ children }: { children: React.ReactNode }) {
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
