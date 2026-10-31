import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { SITE_URL } from "@/lib/site";

// Self-hosted: next/font/google fetches from Google at build time, and one
// bad answer from it failed a production build (2026-10-21). These are the
// latin variable files Google serves (SIL Open Font License).
const newsreader = localFont({
  src: [
    { path: "./fonts/newsreader.woff2", weight: "300 700", style: "normal" },
    { path: "./fonts/newsreader-italic.woff2", weight: "300 700", style: "italic" },
  ],
  variable: "--font-newsreader",
  adjustFontFallback: "Times New Roman",
});
const publicSans = localFont({
  src: "./fonts/public-sans.woff2",
  weight: "300 700",
  variable: "--font-public-sans",
});
const spaceGrotesk = localFont({
  src: "./fonts/space-grotesk.woff2",
  weight: "300 700",
  variable: "--font-space-grotesk",
});

const siteUrl = SITE_URL;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Whitespace India: India's unattended problems, found in public data",
    template: "%s | Whitespace India",
  },
  description:
    "Whitespace India reads India's public records together to find unattended problems. CSR & Impact Finance and Instruments are live, covering 651 districts and the environmental clearance register; Health, Energy and Education are in preview.",
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
      "Whitespace India builds free tools from India's public records. The CSR Opportunity Index ranks 651 districts by poverty against corporate social responsibility spending, and People & Consent profiles any proposal in the national environmental clearance register.",
    url: siteUrl,
    images: [{ url: "/og/whitespace-india-4.jpg", width: 1200, height: 630, alt: "Whitespace India: \u201cWhere India\u2019s resources land, and where they don\u2019t\u201d, beside a risograph print of coloured blocks and a seedling" }],
    type: "website",
    siteName: "Whitespace India",
    locale: "en_IN",
  },
  twitter: {
    card: "summary_large_image",
    title: "Whitespace India",
    description:
      "Whitespace India builds free tools from India's public records, among them a CSR index of 651 districts and a profile of each environmental clearance proposal.",
    images: [{ url: "/og/whitespace-india-4.jpg", alt: "Whitespace India: \u201cWhere India\u2019s resources land, and where they don\u2019t\u201d, beside a risograph print of coloured blocks and a seedling" }],
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
        "An independent project that reads India's public records against one another to find places where need is high and money or scrutiny is thin, and publishes its method, data and code.",
      sameAs: ["https://www.linkedin.com/in/souhardsharma/", "https://github.com/souhardsharma/whitespaceindia"],
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
    <html lang="en-IN" className={`${newsreader.variable} ${publicSans.variable} ${spaceGrotesk.variable}`}>
      <body className="bg-[#fcf9f4] text-[#1c1c19] font-body antialiased">
        <a href="#main-content" className="skip-link">Skip to main content</a>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(SITE_LD) }}
        />
        {children}
        {/* Both load their script from /_vercel/, which only Vercel serves;
            elsewhere (Cloudflare Pages) they were a 404 on every page. */}
        {process.env.VERCEL && (
          <>
            <Analytics />
            <SpeedInsights />
          </>
        )}
      </body>
    </html>
  );
}
