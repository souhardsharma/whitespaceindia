import type { Metadata } from "next";
import { Newsreader, Public_Sans, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";

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

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://whitespaceindia-csr.vercel.app");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Whitespace India | CSR · Health · Education · Energy",
    template: "%s | Whitespace India",
  },
  description:
    "Open instruments that show where India's resources are landing, and where they aren't. Four research initiatives across CSR, Health, Education, and Energy, built entirely on government records and free for anyone to use.",
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
  ],
  authors: [{ name: "Souhard Sharma", url: "https://www.linkedin.com/in/souhardsharma/" }],
  creator: "Souhard Sharma",
  publisher: "Whitespace India",
  formatDetection: { telephone: false, email: false, address: false },
  openGraph: {
    title: "Whitespace India",
    description:
      "Civic data systems across CSR, Health, Education, and Energy. Shipping now: CSR opportunity index across 651 Indian districts.",
    url: siteUrl,
    images: [{ url: "/og/csr.jpg", width: 1200, height: 630, alt: "Whitespace India" }],
    type: "website",
    siteName: "Whitespace India",
    locale: "en_IN",
  },
  twitter: {
    card: "summary_large_image",
    title: "Whitespace India",
    description:
      "Civic data systems across CSR, Health, Education, and Energy.",
    creator: "@souaboroq",
    images: ["/og/csr.jpg"],
  },
  alternates: { canonical: siteUrl },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    shortcut: "/favicon.svg",
    apple: "/favicon.svg",
  },
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
    <html lang="en" className={`${newsreader.variable} ${publicSans.variable} ${spaceGrotesk.variable}`}>
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
