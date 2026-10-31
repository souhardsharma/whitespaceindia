import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site";

const siteUrl = SITE_URL;

const PAGE_URL = `${siteUrl}/reports`;

const TITLE = "CSR Reports and District Profiles | Whitespace India";
const DESCRIPTION =
  "Reports in preparation on CSR spending and poverty in Indian districts, beginning with an atlas of districts that combine high poverty with little CSR spending, built on NITI Aayog and Ministry of Corporate Affairs data.";

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
    title: "CSR reports from Whitespace India",
    description:
      "Whitespace India is preparing reports on CSR spending and poverty in Indian districts, built on NITI Aayog and Ministry of Corporate Affairs data.",
    url: PAGE_URL,
    images: [{ url: "/og/csr-index-4.jpg", width: 1200, height: 630, alt: "CSR Opportunity Index: \u201cWhere CSR should go, district by district\u201d, beside a risograph print of a sapling being watered" }],
    type: "website",
    siteName: "Whitespace India",
    locale: "en_IN",
  },
  twitter: {
    card: "summary_large_image",
    title: "CSR reports from Whitespace India",
    description:
      "Reports in preparation on where CSR spending goes in India and how it compares with district poverty.",
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
      "@type": "CollectionPage",
      "@id": `${PAGE_URL}#page`,
      url: PAGE_URL,
      name: TITLE,
      description: DESCRIPTION,
      isPartOf: { "@id": `${siteUrl}/#site` },
      about: { "@id": `${siteUrl}/#org` },
      primaryImageOfPage: { "@type": "ImageObject", url: `${siteUrl}/og/csr-index-4.jpg` },
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
