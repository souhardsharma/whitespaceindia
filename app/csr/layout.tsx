import type { Metadata } from "next";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL || "https://whitespaceindia-csr.vercel.app";

const PAGE_URL = `${siteUrl}/csr`;

const TITLE = "CSR Opportunity Index | Whitespace India CSR — Where CSR Should Go in India";
const DESCRIPTION =
  "Interactive opportunity index ranking 651 Indian districts by the gap between multidimensional poverty and CSR funding. Built on NITI Aayog MPI 2023 and ten fiscal years of MCA CSR filings — adjust weights, filter by sector, and generate per-district research briefs. Free and open.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { absolute: TITLE },
  description: DESCRIPTION,
  keywords: [
    "CSR India",
    "CSR opportunity index",
    "Philanthropic Opportunity Score",
    "POS",
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
    title: "Whitespace India CSR — Where CSR Should Go",
    description:
      "Discover the Indian districts where philanthropic capital can create the most impact. Interactive opportunity index across 651 districts, free for foundations, donors, and researchers.",
    url: PAGE_URL,
    images: [{ url: "/og/csr.png", width: 1200, height: 630, alt: "Whitespace India CSR Opportunity Index" }],
    type: "website",
    siteName: "Whitespace India CSR",
    locale: "en_IN",
  },
  twitter: {
    card: "summary_large_image",
    title: "Whitespace India CSR — Where CSR Should Go",
    description:
      "Find India's philanthropic whitespaces — districts with high poverty and low CSR funding.",
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
      image: `${siteUrl}/og/csr.png`,
      inLanguage: "en-IN",
    },
    {
      "@type": "Dataset",
      "@id": `${PAGE_URL}#dataset`,
      name: "India CSR Opportunity Score (POS) — 651 districts",
      description:
        "District-level Philanthropic Opportunity Score for 651 Indian districts, combining NITI Aayog MPI poverty data, ten fiscal years of MCA CSR filings, and Census 2011 population.",
      license: "https://creativecommons.org/licenses/by/4.0/",
      isAccessibleForFree: true,
      creator: { "@id": `${siteUrl}/#org` },
      keywords: ["CSR", "India", "philanthropy", "NITI Aayog", "MPI", "MCA"],
      spatialCoverage: { "@type": "Country", name: "India" },
      temporalCoverage: "2014-04-01/2024-03-31",
      url: PAGE_URL,
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
