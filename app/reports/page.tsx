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
    title: "An atlas of the 44 whitespace districts",
    body: "The atlas will profile each whitespace district, meaning a district where CSR spending per person is in the bottom 25% of all districts in the index and the share of people in multidimensional poverty is in the top 25%. Each profile will set the parts of the district's score beside its CSR spending by sector.",
  },
  {
    tag: "Sector Study",
    title: "Where CSR spending on education goes",
    body: "This report will set the CSR money spent on education in each district against measures of school provision and child poverty, and identify the districts where spending and need diverge most.",
  },
  {
    tag: "Funder Analysis",
    title: "The fifty largest CSR spenders, mapped",
    body: "For each of the fifty companies that spend most on CSR, this study will show which districts and sectors receive the money and how that compares with where poverty is highest. It will use ten fiscal years of Ministry of Corporate Affairs filings, adjusted for inflation.",
  },
  {
    tag: "Methodological Note",
    title: "Districts drawn after Census 2011",
    body: "More than fifty districts in NITI Aayog's poverty index did not exist at the time of Census 2011, so the index has to estimate their 2011 populations by dividing the population of the district they were carved from in proportion. This note will show how much those estimates move each district's CSR per person and where the uncertainty is largest.",
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
              CSR Opportunity Index
            </span>
            <div className="h-px bg-[#1c1c19] mt-4 w-24" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-10">
            <div className="md:col-span-8">
              <h1 className="font-headline text-5xl sm:text-6xl md:text-7xl lg:text-8xl headline-tight text-[#1c1c19]">
                Reports &amp;<br />
                <span className="italic font-light">analysis</span>
              </h1>
              <p className="mt-8 md:mt-10 max-w-2xl font-body text-lg md:text-xl leading-relaxed text-[#1c1c19]/90">
                Whitespace India is preparing a series of reports on CSR spending
                and need, built on NITI Aayog&apos;s poverty index and the CSR
                filings companies make to the Ministry of Corporate Affairs.
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
                  The first four are described below.
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
                  Reports in <span className="italic font-light">preparation</span>
                </h2>
                <p className="font-body text-base text-[#1c1c19]/75 leading-relaxed max-w-2xl">
                  Each report will be published as a long PDF, with an
                  interactive version on this site.
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
                  Already <span className="italic font-light">published</span>
                </h2>
                <p className="font-body text-base text-[#1c1c19]/75 leading-relaxed max-w-2xl">
                  The index itself is free to use, and its method and background
                  are documented alongside it.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 border border-[#1c1c19]">
              {[
                {
                  href: "/csr",
                  tag: "Tool",
                  title: "CSR Opportunity Index",
                  body: "The index ranks 651 districts by their poverty against the CSR spending they receive, and you can download a research brief on any of them.",
                },
                {
                  href: "/methodology",
                  tag: "Reference",
                  title: "Methodology",
                  body: "The methodology sets out each step from the raw data to the score, with the reason for each choice.",
                },
                {
                  href: "/about",
                  tag: "Background",
                  title: "About the index",
                  body: "The about page explains why the index was built and which public data it draws on.",
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
                    Updates
                  </span>
                  <h2 className="font-headline text-3xl md:text-4xl headline-tight mb-3">
                    Hear when a report is <span className="italic font-light">published</span>
                  </h2>
                  <p className="font-body text-sm md:text-base text-[#fcf9f4]/80 max-w-md leading-relaxed">
                    We send one short email, with a link, each time a new report
                    or district atlas is published.
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
