import type { Metadata } from "next";
import ComingSoonScene from "@/components/ComingSoonScene";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL || "https://whitespaceindia-csr.vercel.app";

export const metadata: Metadata = {
  title: "Education — Coming Soon",
  description:
    "Whitespace India Education: an upcoming research initiative mapping educational outcome gaps across Indian districts. Coming later this year.",
  openGraph: {
    title: "Whitespace India Education — Coming Soon",
    description:
      "An upcoming research initiative mapping educational outcome gaps across Indian districts.",
    type: "website",
    siteName: "Whitespace India",
  },
  alternates: { canonical: `${siteUrl}/education` },
};

export default function EducationPage() {
  return <ComingSoonScene title="Education" vertical="education" />;
}
