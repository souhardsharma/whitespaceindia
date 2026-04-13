import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Methodology",
  description: "Detailed methodology behind the Philanthropic Opportunity Score (POS). Learn how we process NITI Aayog MPI poverty data and MCA CSR spending data.",
  alternates: {
    canonical: "https://whitespaceindia-csr.vercel.app/methodology",
  },
};

export default function MethodologyLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
