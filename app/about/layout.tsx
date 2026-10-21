import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site";

const siteUrl = SITE_URL;

const PAGE_URL = `${siteUrl}/about`;

const TITLE = "About the CSR Opportunity Index | Whitespace India";
const DESCRIPTION =
  "How the CSR Opportunity Index sets the corporate social responsibility spending companies report against poverty in 651 Indian districts, and the public data it is built from.";

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
    title: "About the CSR Opportunity Index",
    description:
      "The index sets the CSR spending companies report in each of 651 districts against NITI Aayog's poverty measure, to show where need is high and recorded spending is low.",
    url: PAGE_URL,
    images: [{ url: "/og/csr-index-3.jpg", width: 1200, height: 630, alt: "CSR Opportunity Index: \u201cWhere CSR should go, district by district\u201d, beside a risograph print of a sapling being watered" }],
    type: "website",
    siteName: "Whitespace India",
    locale: "en_IN",
  },
  twitter: {
    card: "summary_large_image",
    title: "About the CSR Opportunity Index",
    description:
      "How the index sets reported CSR spending against poverty in 651 Indian districts.",
    images: [{ url: "/og/csr-index-3.jpg", alt: "CSR Opportunity Index: \u201cWhere CSR should go, district by district\u201d, beside a risograph print of a sapling being watered" }],
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
      primaryImageOfPage: { "@type": "ImageObject", url: `${siteUrl}/og/csr-index-3.jpg` },
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
