"use client";

import { useRef } from "react";
import Link from "next/link";
import { motion, useInView } from "framer-motion";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import SubscribeForm from "@/components/SubscribeForm";

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

const PLANNED_REPORTS = [
  {
    tag: "District Profile",
    title: "Whitespace districts: a 44-district atlas",
    body: "Profiles of every district in the top whitespace tier: places where multidimensional poverty sits in the worst quartile and CSR per person in the lowest. Each profile pairs the district's POS components with its sector funding history and dominant donor categories.",
  },
  {
    tag: "Sector Study",
    title: "Where India's CSR education spending actually lands",
    body: "Education absorbs about a third of attributable CSR every year. This report maps that spending against district-level school infrastructure deficits and child-poverty headcounts, then surfaces the widest mismatches.",
  },
  {
    tag: "Funder Analysis",
    title: "The top fifty CSR spenders, mapped",
    body: "The fifty largest corporate donors broken down by district footprint, sector concentration, and the gap between where each spends and where need is highest. Built on ten fiscal years of MCA filings, normalized to constant rupees.",
  },
  {
    tag: "Methodological Note",
    title: "Carve-out districts and the ghost-population problem",
    body: "Over fifty districts in the current MPI list did not exist at the time of Census 2011. This note documents how proportional splitting of parent-district populations affects per-capita CSR estimates and where the residual uncertainty concentrates.",
  },
];

export default function ReportsPage() {
  return (
    <main id="main-content" className="bg-[#fcf9f4] min-h-screen flex flex-col">
      <Navbar />

      {/* Hero */}
      <section className="relative px-6 md:px-12 lg:px-16 pt-32 md:pt-40 pb-16 md:pb-20 border-b border-[#1c1c19] overflow-hidden">
        <div
          aria-hidden
          className="absolute top-16 left-6 md:left-16 opacity-[0.04] select-none pointer-events-none"
        >
          <span className="font-label text-[8rem] md:text-[14rem] leading-none uppercase tracking-tighter text-[#1c1c19]">
            Reports
          </span>
        </div>

        <div className="relative z-10 max-w-7xl mx-auto">
          <div className="mb-10">
            <span className="font-label text-[10px] md:text-[11px] uppercase tracking-[0.4em] text-[#BD402C]">
              Reports &amp; Analysis
            </span>
            <div className="h-px bg-[#1c1c19] mt-4 w-24" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-10">
            <div className="md:col-span-8">
              <h1 className="font-headline text-5xl sm:text-6xl md:text-7xl lg:text-8xl headline-tight text-[#1c1c19]">
                Reports &amp;<br />
                <span className="italic font-light">analysis.</span>
              </h1>
              <p className="mt-8 md:mt-10 max-w-2xl font-body text-lg md:text-xl leading-relaxed text-[#1c1c19]/90">
                District whitespace profiles, sector funding analyses, and funder
                studies. All built on NITI Aayog poverty data and ten fiscal
                years of MCA CSR filings.
              </p>
            </div>

            <div className="md:col-span-4 flex flex-col gap-6 md:mt-4">
              <div className="border-t border-[#1c1c19] pt-6">
                <span className="font-label text-[10px] uppercase tracking-[0.3em] text-[#1c1c19] block mb-3">
                  Status
                </span>
                <div className="font-label text-2xl font-bold text-[#BD402C] tracking-tighter">
                  Coming Soon
                </div>
                <p className="font-body text-[10px] uppercase tracking-[0.15em] text-[#1c1c19]/55 mt-3 leading-relaxed">
                  First reports listed below.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-6 md:px-12 lg:px-16 py-20 md:py-24 space-y-20">
        {/* What's planned */}
        <FadeIn>
          <section>
            <div className="grid grid-cols-1 md:grid-cols-12 gap-10 mb-10">
              <div className="md:col-span-3">
                <span className="font-label text-[11px] uppercase tracking-[0.3em] text-[#BD402C] block mb-4">
                  01 / In Preparation
                </span>
                <div className="h-px bg-[#1c1c19] w-24" />
              </div>
              <div className="md:col-span-9">
                <h2 className="font-headline text-3xl md:text-5xl headline-tight text-[#1c1c19] mb-4">
                  What&apos;s coming, <span className="italic font-light">in order.</span>
                </h2>
                <p className="font-body text-base text-[#1c1c19]/75 leading-relaxed max-w-2xl">
                  Four reports come first. Each ships as a long-form PDF with
                  an interactive companion on this site.
                </p>
              </div>
            </div>

            <div className="border border-[#1c1c19]">
              {PLANNED_REPORTS.map((r, i) => (
                <article
                  key={r.title}
                  className={`grid grid-cols-1 md:grid-cols-12 gap-6 p-6 md:p-8 ${
                    i % 2 === 1 ? "bg-[#f6f3ee]" : "bg-[#fcf9f4]"
                  } ${i < PLANNED_REPORTS.length - 1 ? "border-b border-[#1c1c19]" : ""}`}
                >
                  <div className="md:col-span-3 flex md:flex-col gap-3 md:gap-4 items-baseline md:items-start">
                    <span className="font-headline text-3xl md:text-4xl italic font-light text-[#BD402C]/40 leading-none">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="font-label text-[10px] uppercase tracking-[0.3em] text-[#BD402C] font-bold">
                      {r.tag}
                    </span>
                  </div>
                  <div className="md:col-span-9">
                    <h3 className="font-headline text-2xl md:text-3xl headline-tight text-[#1c1c19] mb-3">
                      {r.title}
                    </h3>
                    <p className="font-body text-sm md:text-base text-[#1c1c19]/80 leading-relaxed">
                      {r.body}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </FadeIn>

        {/* Read in the meantime */}
        <FadeIn>
          <section>
            <div className="grid grid-cols-1 md:grid-cols-12 gap-10 mb-10">
              <div className="md:col-span-3">
                <span className="font-label text-[11px] uppercase tracking-[0.3em] text-[#BD402C] block mb-4">
                  02 / Available Now
                </span>
                <div className="h-px bg-[#1c1c19] w-24" />
              </div>
              <div className="md:col-span-9">
                <h2 className="font-headline text-3xl md:text-5xl headline-tight text-[#1c1c19] mb-4">
                  Read in the <span className="italic font-light">meantime.</span>
                </h2>
                <p className="font-body text-base text-[#1c1c19]/75 leading-relaxed max-w-2xl">
                  The CSR opportunity index, the full methodology, and the
                  project background are live and free to use.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 border border-[#1c1c19]">
              {[
                {
                  href: "/csr",
                  tag: "Tool",
                  title: "Opportunity Index",
                  body: "Rank every Indian district by the gap between poverty and CSR funding. Generate per-district research briefs.",
                },
                {
                  href: "/methodology",
                  tag: "Reference",
                  title: "Full Methodology",
                  body: "Six pipeline stages, three datasets, normalization choices, and every assumption documented in the open.",
                },
                {
                  href: "/about",
                  tag: "Background",
                  title: "About the Project",
                  body: "The mismatch this project documents, who it serves, and the public data behind it.",
                },
              ].map((c, i) => (
                <Link
                  key={c.href}
                  href={c.href}
                  className={`group block p-6 md:p-8 ${i % 2 === 1 ? "bg-[#f6f3ee]" : "bg-[#fcf9f4]"} ${
                    i < 2 ? "border-b md:border-b-0 md:border-r border-[#1c1c19]" : ""
                  } hover:bg-[#1c1c19] hover:text-[#fcf9f4] transition-colors`}
                >
                  <div className="flex items-start justify-between mb-5">
                    <span className="font-label text-[10px] uppercase tracking-[0.3em] text-[#BD402C] group-hover:text-[#f3c4b4] font-bold">
                      {c.tag}
                    </span>
                    <span className="font-headline text-3xl leading-none italic font-light text-[#1c1c19]/30 group-hover:text-[#fcf9f4]/40">
                      →
                    </span>
                  </div>
                  <h3 className="font-headline text-xl md:text-2xl headline-tight mb-3">
                    {c.title}
                  </h3>
                  <p className="font-body text-sm leading-relaxed opacity-80">
                    {c.body}
                  </p>
                </Link>
              ))}
            </div>
          </section>
        </FadeIn>

        {/* Notify me */}
        <FadeIn>
          <section>
            <div className="border border-[#1c1c19] bg-[#1c1c19] p-8 md:p-12 text-[#fcf9f4]">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-center">
                <div className="md:col-span-7">
                  <span className="font-label text-[10px] uppercase tracking-[0.3em] text-[#fcf9f4]/60 block mb-4">
                    Be Notified
                  </span>
                  <h2 className="font-headline text-3xl md:text-4xl headline-tight mb-3">
                    Reports drop <span className="italic font-light">straight to inbox.</span>
                  </h2>
                  <p className="font-body text-sm md:text-base text-[#fcf9f4]/80 max-w-md leading-relaxed">
                    One short note when a new report or district atlas goes
                    live. Usually once or twice a quarter.
                  </p>
                </div>
                <div className="md:col-span-5">
                  <SubscribeForm variant="full" source="reports" />
                </div>
              </div>
            </div>
          </section>
        </FadeIn>
      </div>

      <Footer />
    </main>
  );
}
