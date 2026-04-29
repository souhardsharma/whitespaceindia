import type { Metadata } from "next";
import ComingSoonScene from "@/components/ComingSoonScene";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL || "https://whitespaceindia-csr.vercel.app";

export const metadata: Metadata = {
  title: "Energy — Coming Soon",
  description:
    "Whitespace India Energy: an upcoming research initiative mapping energy access gaps across Indian districts. Coming later this year.",
  openGraph: {
    title: "Whitespace India Energy — Coming Soon",
    description:
      "An upcoming research initiative mapping energy access gaps across Indian districts.",
    type: "website",
    siteName: "Whitespace India",
  },
  alternates: { canonical: `${siteUrl}/energy` },
};

export default function EnergyPage() {
  return <ComingSoonScene title="Energy" vertical="energy" />;
}
