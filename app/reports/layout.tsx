import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site";

const siteUrl = SITE_URL;

const PAGE_URL = `${siteUrl}/reports`;

const TITLE = "CSR Reports and District Profiles | Whitespace India";
const DESCRIPTION =
  "Forthcoming CSR research: district whitespace profiles, sector funding analyses and funder studies, grounded in NITI Aayog MPI and MCA CSR data.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { absolute: TITLE },
  description: DESCRIPTION,
  keywords: [
    "CSR research India",
    "district whitespace profile",
    "CSR sector analysis",
    "philanthropic funding India",
    "Whitespace India reports",
    "CSR data analysis",
    "Indian district profile",
    "MCA CSR analysis",
    "NITI Aayog poverty research",
  ],
  openGraph: {
    title: "Reports & Analysis — Whitespace India CSR",
    description:
      "Forthcoming research: district-level whitespace profiles, sector funding analyses, and funder studies grounded in NITI Aayog and MCA data.",
    url: PAGE_URL,
    images: [{ url: "/og/csr-index-2.jpg", width: 1200, height: 630, alt: "CSR Opportunity Index: \u201cWhere CSR should go, district by district\u201d, beside a risograph print of a sapling being watered" }],
    type: "website",
    siteName: "Whitespace India",
    locale: "en_IN",
  },
  twitter: {
    card: "summary_large_image",
    title: "Reports & Analysis — Whitespace India CSR",
    description:
      "District profiling, sector funding analyses, and funder studies for India's CSR landscape.",
    images: [{ url: "/og/csr-index-2.jpg", alt: "CSR Opportunity Index: \u201cWhere CSR should go, district by district\u201d, beside a risograph print of a sapling being watered" }],
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
      "@type": "CollectionPage",
      "@id": `${PAGE_URL}#page`,
      url: PAGE_URL,
      name: TITLE,
      description: DESCRIPTION,
      isPartOf: { "@id": `${siteUrl}/#site` },
      about: { "@id": `${siteUrl}/#org` },
      primaryImageOfPage: { "@type": "ImageObject", url: `${siteUrl}/og/csr-index-2.jpg` },
      inLanguage: "en-IN",
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Whitespace India", item: `${siteUrl}/` },
        { "@type": "ListItem", position: 2, name: "CSR", item: `${siteUrl}/csr` },
        { "@type": "ListItem", position: 3, name: "Reports", item: PAGE_URL },
      ],
    },
  ],
};

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
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
