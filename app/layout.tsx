import type { Metadata } from "next";
import { Karla, Lora } from "next/font/google";
import "./globals.css";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";

const karla = Karla({
  subsets: ["latin"],
  variable: "--font-karla",
  weight: ["400", "500", "600", "700"],
});
const lora = Lora({
  subsets: ["latin"],
  variable: "--font-lora",
  weight: ["400", "600", "700"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://whitespaceindia-csr.vercel.app"),
  title: {
    default: "Whitespace India CSR | Where CSR Should Go",
    template: "%s | Whitespace India CSR",
  },
  description:
    "Interactive tool ranking Indian districts by philanthropic opportunity. Combines NITI Aayog MPI poverty data with CSR spending to find where philanthropic capital can create the most impact.",
  keywords: [
    "CSR India",
    "MPI India districts",
    "philanthropic opportunity India",
    "NITI Aayog MPI 2023",
    "CSR spending gap India",
  ],
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
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${karla.variable} ${lora.variable}`}>
      <body className="bg-[#0B1526] text-white font-sans antialiased">
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
