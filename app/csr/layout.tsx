import type { Metadata } from "next";
import { TOTAL_DISTRICTS } from "@/lib/csr/findings";
import { SITE_URL } from "@/lib/site";

const siteUrl = SITE_URL;

const PAGE_URL = `${siteUrl}/csr`;

const TITLE = `CSR Investment in India: Opportunity Index for ${TOTAL_DISTRICTS} Districts`;
const DESCRIPTION =
  `Where CSR investment in India falls short: the CSR Opportunity Index ranks ${TOTAL_DISTRICTS} districts by poverty (NITI Aayog MPI 2023) against ten years of company CSR spending in Ministry of Corporate Affairs filings. Change the weights or score a single sector.`;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { absolute: TITLE },
  description: DESCRIPTION,
  keywords: [
    "CSR India",
    "CSR opportunity index",
    "CSR opportunity score",
    "where to spend CSR",
    "CSR per district India",
    "NITI Aayog MPI",
    "MCA CSR data",
    "Indian district poverty",
    "philanthropy India",
    "whitespace district",
    "CSR strategy India",
  ],
  openGraph: {
    title: `CSR Opportunity Index: poverty and CSR spending in ${TOTAL_DISTRICTS} districts`,
    description:
      `A free, interactive index that sets the CSR spending companies report in each of ${TOTAL_DISTRICTS} Indian districts against the district's poverty, to show where need is high and recorded spending is low.`,
    url: PAGE_URL,
    images: [{ url: "/og/csr-index-5.jpg", width: 1200, height: 630, alt: "CSR Opportunity Index: \u201cWhere CSR should go, district by district\u201d, beside a risograph print of a sapling being watered" }],
    type: "website",
    siteName: "Whitespace India",
    locale: "en_IN",
  },
  twitter: {
    card: "summary_large_image",
    title: `CSR Opportunity Index: poverty and CSR spending in ${TOTAL_DISTRICTS} districts`,
    description:
      "An index of Indian districts where poverty is high and recorded CSR spending is low.",
    images: [{ url: "/og/csr-index-5.jpg", alt: "CSR Opportunity Index: \u201cWhere CSR should go, district by district\u201d, beside a risograph print of a sapling being watered" }],
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
      "@type": "WebApplication",
      "@id": `${PAGE_URL}#app`,
      url: PAGE_URL,
      name: "Whitespace India CSR Opportunity Index",
      description: DESCRIPTION,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Any",
      browserRequirements: "Requires JavaScript",
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "INR" },
      publisher: { "@id": `${siteUrl}/#org` },
      isPartOf: { "@id": `${siteUrl}/#site` },
      image: `${siteUrl}/og/csr-index-5.jpg`,
      inLanguage: "en-IN",
    },
    {
      "@type": "Dataset",
      "@id": `${PAGE_URL}#dataset`,
      name: `CSR Opportunity Index: opportunity scores for ${TOTAL_DISTRICTS} Indian districts`,
      description:
        `A district-level score for ${TOTAL_DISTRICTS} Indian districts that combines NITI Aayog's MPI 2023 poverty headcount with ten fiscal years of CSR filings to the Ministry of Corporate Affairs and Census 2011 population.`,
      license: "https://creativecommons.org/licenses/by/4.0/",
      isAccessibleForFree: true,
      creator: { "@id": `${siteUrl}/#org` },
      keywords: ["CSR", "India", "philanthropy", "NITI Aayog", "MPI", "MCA"],
      spatialCoverage: { "@type": "Place", name: "India" },
      temporalCoverage: "2014-04-01/2024-03-31",
      url: PAGE_URL,
      // The page's one Dataset. A second, built in page.tsx with another name
      // and date range, described the same files.
      distribution: [
        { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: `${siteUrl}/data/csr/whitespace_master.json` },
        { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: `${siteUrl}/data/csr/sector_scores.json` },
      ],
      citation: [
        "National Multidimensional Poverty Index 2023 (NITI Aayog), https://niti.gov.in/sites/default/files/2023-07/National-Multidimentional-Poverty-Index-2023-Final-17th-July.pdf",
        "CSR District-Level Spending Data (Ministry of Corporate Affairs), https://www.csr.gov.in/",
        "CSR District-Level Dataset via Dataful.in (Dataset 1612), https://dataful.in/datasets/1612",
      ],
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Whitespace India", item: `${siteUrl}/` },
        { "@type": "ListItem", position: 2, name: "CSR", item: PAGE_URL },
      ],
    },
  ],
};

export default function CsrLayout({ children }: { children: React.ReactNode }) {
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
