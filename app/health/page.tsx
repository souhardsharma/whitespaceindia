import type { Metadata } from "next";
import ComingSoonScene from "@/components/ComingSoonScene";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL || "https://whitespaceindia-csr.vercel.app";

export const metadata: Metadata = {
  title: "Health — Coming Soon",
  description:
    "Whitespace India Health: an upcoming research initiative mapping public-health gaps across Indian districts. Coming later this year.",
  openGraph: {
    title: "Whitespace India Health — Coming Soon",
    description:
      "An upcoming research initiative mapping public-health gaps across Indian districts.",
    type: "website",
    siteName: "Whitespace India",
  },
  alternates: { canonical: `${siteUrl}/health` },
};

export default function HealthPage() {
  return <ComingSoonScene title="Health" vertical="health" />;
}
