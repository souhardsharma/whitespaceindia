import type { Metadata } from "next";
import { Newsreader, Public_Sans, Space_Grotesk, Instrument_Serif } from "next/font/google";
import "./globals.css";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { SITE_URL } from "@/lib/site";

const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-newsreader",
  weight: ["300", "400", "500", "700"],
  style: ["normal", "italic"],
});
const publicSans = Public_Sans({
  subsets: ["latin"],
  variable: "--font-public-sans",
  weight: ["300", "400", "500", "700"],
});
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  weight: ["300", "400", "500", "700"],
});
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  variable: "--font-instrument",
  weight: ["400"],
  style: ["normal", "italic"],
});

const siteUrl = SITE_URL;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Whitespace India | CSR, Health, Education, Energy, Instruments",
    template: "%s | Whitespace India",
  },
  description:
    "Open civic data on where India's resources land, and where they don't: a CSR index across 651 districts and a register of environmental clearance proposals.",
  applicationName: "Whitespace India",
  keywords: [
    "Whitespace India",
    "CSR India",
    "philanthropy India",
    "NITI Aayog MPI",
    "open data India",
    "civic data",
    "MCA CSR data",
    "Indian districts",
    "environmental clearance India",
    "PARIVESH",
    "Scheduled Areas",
    "Gram Sabha consent",
  ],
  authors: [{ name: "Souhard Sharma", url: "https://www.linkedin.com/in/souhardsharma/" }],
  creator: "Souhard Sharma",
  publisher: "Whitespace India",
  formatDetection: { telephone: false, email: false, address: false },
  openGraph: {
    title: "Whitespace India",
    description:
      "Civic data across CSR, Health, Education and Energy, and civic instruments. Live now: the CSR opportunity index across 651 Indian districts, and People & Consent, a screening instrument for environmental clearance proposals.",
    url: siteUrl,
    images: [{ url: "/og/whitespace-india-2.jpg", width: 1200, height: 630, alt: "Whitespace India: \u201cWhere India\u2019s resources land, and where they don\u2019t\u201d, beside a risograph print of coloured blocks and a seedling" }],
    type: "website",
    siteName: "Whitespace India",
    locale: "en_IN",
  },
  twitter: {
    card: "summary_large_image",
    title: "Whitespace India",
    description:
      "Civic data across CSR, Health, Education and Energy, and civic instruments.",
    images: [{ url: "/og/whitespace-india-2.jpg", alt: "Whitespace India: \u201cWhere India\u2019s resources land, and where they don\u2019t\u201d, beside a risograph print of coloured blocks and a seedling" }],
  },
  alternates: { canonical: siteUrl },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
  // The SVG follows the reader's colour scheme; the rasters are for what
  // cannot read one (scripts/make_icons.mjs). Google's results take a
  // favicon of 48 px or more, so the ICO carries 48.
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: { url: "/apple-touch-icon.png", sizes: "180x180" },
  },
  manifest: "/manifest.webmanifest",
  category: "research",
};

/* Site-wide structured data — Organization + WebSite. Appears on every page
   so Google can establish brand identity regardless of entry point. Page-
   specific schema (FAQPage on /, BreadcrumbList on placeholders) lives in
   the page files. */
const SITE_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${siteUrl}/#org`,
      name: "Whitespace India",
      url: `${siteUrl}/`,
      logo: `${siteUrl}/logo.svg`,
      description:
        "Open instruments that show where India's resources are landing and where they aren't, built on government records and free to use.",
      sameAs: ["https://www.linkedin.com/in/souhardsharma/"],
      founder: { "@type": "Person", name: "Souhard Sharma" },
      foundingLocation: { "@type": "Country", name: "India" },
    },
    {
      "@type": "WebSite",
      "@id": `${siteUrl}/#site`,
      url: `${siteUrl}/`,
      name: "Whitespace India",
      publisher: { "@id": `${siteUrl}/#org` },
      inLanguage: "en-IN",
    },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-IN" className={`${newsreader.variable} ${publicSans.variable} ${spaceGrotesk.variable} ${instrumentSerif.variable}`}>
      <body className="bg-[#fcf9f4] text-[#1c1c19] font-body antialiased">
        <a href="#main-content" className="skip-link">Skip to main content</a>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(SITE_LD) }}
        />
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
