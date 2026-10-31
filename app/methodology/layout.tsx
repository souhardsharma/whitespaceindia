import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site";

const siteUrl = SITE_URL;

const PAGE_URL = `${siteUrl}/methodology`;

const TITLE = "How the CSR Opportunity Score Works | Whitespace India";
const DESCRIPTION =
  "How the Philanthropic Opportunity Score is built, in six stages that turn NITI Aayog poverty data and Ministry of Corporate Affairs CSR filings into one score for each of 651 districts.";

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
    title: "How the Whitespace India CSR score is built",
    description:
      "How we measure the gap between poverty and CSR funding: three public datasets are matched and combined into one Opportunity Score for each of 651 Indian districts.",
    url: PAGE_URL,
    images: [{ url: "/og/csr-index-4.jpg", width: 1200, height: 630, alt: "CSR Opportunity Index: \u201cWhere CSR should go, district by district\u201d, beside a risograph print of a sapling being watered" }],
    type: "article",
    siteName: "Whitespace India",
    locale: "en_IN",
  },
  twitter: {
    card: "summary_large_image",
    title: "How the Whitespace India CSR score is built",
    description:
      "Three public datasets, matched and combined into one Opportunity Score for each of 651 Indian districts.",
    images: [{ url: "/og/csr-index-4.jpg", alt: "CSR Opportunity Index: \u201cWhere CSR should go, district by district\u201d, beside a risograph print of a sapling being watered" }],
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
      headline: "How the Philanthropic Opportunity Score is built",
      name: TITLE,
      description: DESCRIPTION,
      isPartOf: { "@id": `${siteUrl}/#site` },
      author: { "@id": `${siteUrl}/#org` },
      publisher: { "@id": `${siteUrl}/#org` },
      mainEntityOfPage: PAGE_URL,
      image: `${siteUrl}/og/csr-index-4.jpg`,
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
