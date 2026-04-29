import type { Metadata } from "next";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL || "https://whitespaceindia-csr.vercel.app";

export const metadata: Metadata = {
  title: "CSR | Where CSR Should Go",
  description:
    "Interactive tool ranking Indian districts by philanthropic opportunity. Combines NITI Aayog MPI poverty data with CSR spending to find where philanthropic capital can create the most impact.",
  openGraph: {
    title: "Whitespace India CSR — Where CSR Should Go",
    description:
      "Discover the districts where philanthropic capital can create the most impact. Free interactive tool for foundation leaders.",
    images: [{ url: "/og/csr.png", width: 1200, height: 630 }],
    type: "website",
    siteName: "Whitespace India CSR",
  },
  twitter: {
    card: "summary_large_image",
    title: "Whitespace India CSR",
    description:
      "Find India's philanthropic whitespaces — districts with high poverty and low CSR funding.",
  },
  alternates: {
    canonical: `${siteUrl}/csr`,
  },
};

export default function CsrLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
