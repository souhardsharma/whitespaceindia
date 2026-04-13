"use client";

import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

export const metadata = {
  title: "Reports & Analysis",
  description: "Extensive CSR research reports, thematic case studies, and deep-dive analytics on Indian philanthropic whitespaces.",
  alternates: {
    canonical: "https://whitespaceindia-csr.vercel.app/reports",
  },
};

function FadeIn({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 24 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export default function ReportsPage() {
  return (
    <main className="bg-[#0B1526] min-h-screen flex flex-col">
      <Navbar />

      {/* Page header */}
      <section className="relative pt-32 pb-16 px-4 overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: "url('/images/hero-bg.png')", opacity: 0.08 }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0B1526]/70 to-[#0B1526]" />
        <div className="relative max-w-4xl mx-auto text-center">
          <h1 className="font-display text-5xl md:text-6xl text-white leading-tight mb-4 text-center">
            Reports & Analysis
          </h1>
          <p className="text-xl text-[#94A3B8] max-w-2xl mx-auto leading-relaxed text-center">
            In-depth district profiling and thematic research.
          </p>
        </div>
      </section>

      <div className="flex-1 flex flex-col items-center justify-center px-4 pb-32">
        <FadeIn>
          <div className="bg-white/[0.03] border border-[#F5A623]/30 rounded-2xl p-10 md:p-14 text-center max-w-lg mx-auto shadow-[0_0_30px_rgba(245,166,35,0.05)] relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-[#FBBF24] to-[#F97316]" />
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-[#F5A623]/10 mb-6">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#F5A623" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
            </div>
            <h2 className="font-display text-3xl text-white mb-3 tracking-wide">
              Coming Soon
            </h2>
            <p className="text-[#94A3B8] leading-relaxed">
              We are currently generating extensive research reports for priority states. Check back later for downloadable publications, thematic case studies, and deep-dive analytics.
            </p>
          </div>
        </FadeIn>
      </div>

      <Footer />
    </main>
  );
}
