import type { Metadata } from "next";
import ComingSoonScene from "@/components/ComingSoonScene";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL || "https://whitespaceindia-csr.vercel.app";

const PAGE_URL = `${siteUrl}/health`;
const TITLE = "Health — Coming Soon";
const DESCRIPTION =
  "Whitespace India Health: an upcoming open-data initiative mapping public-health gaps across Indian districts. Built on government records, free to use.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: "Whitespace India Health — Coming Soon",
    description: DESCRIPTION,
    url: PAGE_URL,
    type: "website",
    siteName: "Whitespace India",
    locale: "en_IN",
  },
  twitter: {
    card: "summary_large_image",
    title: "Whitespace India Health — Coming Soon",
    description:
      "An upcoming open-data initiative mapping public-health gaps across Indian districts.",
    creator: "@souaboroq",
  },
  alternates: { canonical: PAGE_URL },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
};

const PAGE_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebPage",
      "@id": `${PAGE_URL}#page`,
      url: PAGE_URL,
      name: "Whitespace India Health",
      description: DESCRIPTION,
      isPartOf: { "@id": `${siteUrl}/#site` },
      about: { "@id": `${siteUrl}/#org` },
      inLanguage: "en-IN",
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Whitespace India", item: `${siteUrl}/` },
        { "@type": "ListItem", position: 2, name: "Health", item: PAGE_URL },
      ],
    },
  ],
};

export default function HealthPage() {
  return (
    <>
      <ComingSoonScene title="Health" vertical="health" />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(PAGE_LD) }}
      />
    </>
  );
}
