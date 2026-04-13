import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Reports & Analysis",
  description: "Extensive CSR research reports, thematic case studies, and deep-dive analytics on Indian philanthropic whitespaces.",
  alternates: {
    canonical: "https://whitespaceindia-csr.vercel.app/reports",
  },
};

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
