import { Metadata } from "next";

export const metadata: Metadata = {
  title: "About",
  description: "About Whitespace India CSR: Quantifying the gap between where philanthropic money goes and where people need it most.",
  alternates: {
    canonical: "https://whitespaceindia-csr.vercel.app/about",
  },
};

export default function AboutLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
