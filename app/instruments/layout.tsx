import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site";

const siteUrl = SITE_URL;

const PAGE_URL = `${siteUrl}/instruments`;
const TITLE = "Instruments — Whitespace India";
const DESCRIPTION =
  "Per-case instruments built from India's public records. Bring one project, filing or place and get what the record holds about it. First: People & Consent.";

export const metadata: Metadata = {
  // `absolute`, so the root layout's "| Whitespace India" template does not
  // append a second brand: the shelf read "Instruments — Whitespace India |
  // Whitespace India" in tabs and results. Matches app/csr/layout.tsx.
  title: { absolute: TITLE },
  description: DESCRIPTION,
  keywords: [
    "environmental clearance India",
    "PARIVESH",
    "free prior informed consent India",
    "Fifth Schedule Scheduled Areas",
    "PESA 1996",
    "Forest Rights Act 2006",
    "RFCTLARR 2013",
    "social impact assessment India",
    "land acquisition India",
    "district socio-economic profile",
  ],
  openGraph: {
    title: "Whitespace India — Instruments",
    description: DESCRIPTION,
    url: PAGE_URL,
    type: "website",
    siteName: "Whitespace India",
    locale: "en_IN",
    images: [
      {
        url: "/og/instruments-3.jpg",
        width: 1200,
        height: 630,
        alt: "Whitespace India Instruments: \u201cBring one case, see what the record holds\u201d, beside a graphite risograph print of a magnifying glass over a row of everyday objects",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Whitespace India — Instruments",
    description: DESCRIPTION,
    images: [{ url: "/og/instruments-3.jpg", alt: "Whitespace India Instruments: \u201cBring one case, see what the record holds\u201d, beside a graphite risograph print of a magnifying glass over a row of everyday objects" }],
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
    },
  },
};

/* The shelf's own JSON-LD now lives on the shelf PAGE, not here.
   A layout wraps every route beneath it and cannot know which one is
   rendering, so a graph declared here was emitted verbatim on all 626
   instrument pages: each one announced itself as the Instruments
   CollectionPage with a breadcrumb ending at /instruments, contradicting its
   own canonical URL. See lib/instruments/metadata.ts -> pageLd(). */

export default function InstrumentsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Proposal titles are the register's free text, and some carry long runs
  // with no space in them - survey and CTS numbers joined by commas and
  // slashes. One such title on Thane's page pushed a 320px phone to 569px of
  // horizontal scroll. `break-word` breaks a run only when it cannot fit its
  // line; unlike `anywhere` it leaves min-content sizing alone, so grid
  // columns of figures do not collapse and split a number.
  // `instrument-root` scopes the 44px control-height rule in globals.css to
  // these pages, so the indexes keep their own convention.
  return <div className="break-words instrument-root">{children}</div>;
}
