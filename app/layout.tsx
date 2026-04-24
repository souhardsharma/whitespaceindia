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
  process.env.NEXT_PUBLIC_SITE_URL || "https://whitespaceindia-csr.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Whitespace India CSR | Where CSR Should Go",
    template: "%s | Whitespace India CSR",
  },
  description:
    "Interactive tool ranking Indian districts by philanthropic opportunity. Combines NITI Aayog MPI poverty data with CSR spending to find where philanthropic capital can create the most impact.",
  openGraph: {
    title: "Whitespace India CSR - Find Where CSR Should Go",
    description:
      "Discover the districts where philanthropic capital can create the most impact. Free interactive tool for foundation leaders.",
    images: [{ url: "/images/og-image.png", width: 1200, height: 630 }],
    type: "website",
    siteName: "Whitespace India CSR",
  },
  twitter: {
    card: "summary_large_image",
    title: "Whitespace India CSR",
    description:
      "Find India's philanthropic whitespaces - districts with high poverty and low CSR funding.",
    creator: "@souaboroq",
  },
  alternates: {
    canonical: siteUrl,
  },
  robots: { index: true, follow: true },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    shortcut: "/favicon.svg",
    apple: "/favicon.svg",
  },
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
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
