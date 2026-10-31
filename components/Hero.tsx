"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { VerticalConfig } from "@/lib/verticals/types";

const DEFAULT_ACCENT = "#BD402C";

interface HeroMeta {
  total_districts?: number;
  national_hr_official_pct?: number;
  csr_totals?: { total_fy23_24_crore?: number };
  state_stats?: {
    bihar?: { csr_per_person_inr?: number };
    maharashtra?: { csr_per_person_inr?: number };
  };
}

function CountUp({
  end,
  prefix = "",
  suffix = "",
  decimals = 0,
  duration = 2000,
}: {
  end: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  duration?: number;
}) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setInView(true);
      },
      { threshold: 0.5 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!inView) return;
    const start = performance.now();
    const animate = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(eased * end);
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [inView, end, duration]);

  const formatted =
    decimals > 0
      ? count.toFixed(decimals)
      : Math.round(count).toLocaleString("en-IN");

  return (
    <span ref={ref}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.15 } },
};

const fadeUp = {
  hidden: { opacity: 0, y: 28 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] },
  },
};

export default function Hero({
  vertical,
  onEnterLedger,
}: {
  vertical?: VerticalConfig;
  /** Given by the CSR page only; other verticals keep their jump to the ranking. */
  onEnterLedger?: (from: DOMRect) => void;
}) {
  const accent = vertical?.theme.accent ?? DEFAULT_ACCENT;
  const isCsr = !vertical || vertical.slug === "csr";
  const dataPath = vertical?.dataPath ?? "/data/csr";
  const verticalSlug = vertical?.slug ?? "csr";
  const [meta, setMeta] = useState<HeroMeta | null>(null);

  useEffect(() => {
    fetch(`${dataPath}/meta.json`)
      .then((r) => r.json())
      .then((m: HeroMeta) => setMeta(m))
      .catch(() => {});
  }, [dataPath]);

  const scrollToSimulator = () => {
    document.getElementById("simulator")?.scrollIntoView({ behavior: "smooth" });
  };

  const totalDistricts = meta?.total_districts ?? 651;
  const methodologyHref = isCsr ? "/methodology" : `/${verticalSlug}/methodology`;

  const headline = vertical?.heroContent?.headline ?? "Companies have spent over two lakh crore rupees on CSR since 2014.";
  const headlineItalic = vertical?.heroContent?.headlineItalic ?? "This index sets each district’s share against its poverty.";
  const body = vertical?.heroContent?.body ?? "Larger Indian companies must spend part of their profits on corporate social responsibility (CSR) and report where the money went. The CSR Opportunity Index compares the spending reported for each district with the share of its people in poverty, and it calls a district a whitespace district when its spending per person is in the bottom quarter of all districts and its poverty is in the top quarter.";

  /* CSR-specific computed stats */
  const fy24Csr = Math.round(meta?.csr_totals?.total_fy23_24_crore ?? 21878);
  const nationalHr = meta?.national_hr_official_pct ?? 14.96;
  const bhCsrPp = meta?.state_stats?.bihar?.csr_per_person_inr;
  const mhCsrPp = meta?.state_stats?.maharashtra?.csr_per_person_inr;
  const csrRatio = bhCsrPp && mhCsrPp && bhCsrPp > 0 ? Math.round(mhCsrPp / bhCsrPp) : 20;

  return (
    <section className="relative bg-[#fcf9f4] pt-32 md:pt-40 pb-16 md:pb-24 px-6 md:px-12 lg:px-16">
      <motion.div
        className="max-w-7xl mx-auto"
        variants={stagger}
        initial="hidden"
        animate="show"
      >
        {/* Asymmetric hero grid */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-10 md:gap-14 items-start">
          {/* Headline column */}
          <div className="md:col-span-8 lg:col-span-9">
            <motion.h1
              variants={fadeUp}
              className="font-headline text-5xl sm:text-6xl md:text-7xl lg:text-8xl xl:text-9xl headline-tight text-[#1c1c19]"
            >
              {headline}
              <br />
              <span className="italic font-light">
                {headlineItalic}
              </span>
            </motion.h1>

            <motion.p
              variants={fadeUp}
              className="mt-10 md:mt-14 max-w-2xl font-body text-lg md:text-xl leading-relaxed text-[#1c1c19]/90"
            >
              {body}
            </motion.p>

            {/* CTA row */}
            <motion.div
              variants={fadeUp}
              className="mt-10 md:mt-12 flex flex-col sm:flex-row gap-4"
            >
              <button
                onClick={(e) =>
                  onEnterLedger
                    ? onEnterLedger(e.currentTarget.getBoundingClientRect())
                    : scrollToSimulator()
                }
                className="group text-white font-label uppercase tracking-[0.25em] text-xs py-5 px-8 flex justify-between items-center gap-6 hover:bg-[#1c1c19] transition-colors w-full sm:w-auto sm:min-w-[280px]"
                style={{ backgroundColor: accent }}
              >
                {onEnterLedger ? "Enter the ledger" : "District ranking"}
                <svg width="18" height="10" viewBox="0 0 24 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M0 6h22M16 1l5 5-5 5" />
                </svg>
              </button>
              <a
                href={methodologyHref}
                className="group border border-[#1c1c19] text-[#1c1c19] font-label uppercase tracking-[0.25em] text-xs py-5 px-8 flex justify-between items-center gap-6 hover:bg-[#1c1c19] hover:text-[#fcf9f4] transition-colors w-full sm:w-auto sm:min-w-[280px]"
              >
                Methodology
                <span className="text-[10px] opacity-70">→</span>
              </a>
            </motion.div>
          </div>

          {/* Ledger / Data column */}
          <motion.div
            variants={fadeUp}
            className="md:col-span-4 lg:col-span-3 flex flex-col gap-10 md:gap-12 mt-8 md:mt-0"
          >
            {isCsr ? (
              <>
                <div className="border-t border-[#1c1c19] pt-6">
                  <span className="font-label text-[10px] uppercase tracking-[0.3em] text-[#1c1c19] block mb-5">
                    CSR placed in a district, FY2023-24
                  </span>
                  <div className="font-label text-3xl lg:text-4xl font-bold tracking-tighter" style={{ color: accent }}>
                    <CountUp end={fy24Csr} prefix="₹" suffix=" Cr" />
                  </div>
                  <div className="mt-4 font-body text-xs text-[#1c1c19]/70 leading-relaxed">
                    Spending that companies&apos; filings to the Ministry of Corporate Affairs tie to a named district. Spending filed as national, or with no district, is left out.
                  </div>
                </div>

                <div className="border-t border-[#1c1c19] pt-6">
                  <span className="font-label text-[10px] uppercase tracking-[0.3em] text-[#1c1c19] block mb-5">
                    Districts scored
                  </span>
                  <div className="font-label text-3xl lg:text-4xl font-bold tracking-tighter" style={{ color: accent }}>
                    <CountUp end={totalDistricts} suffix=" Districts" />
                  </div>
                  <div className="mt-4 font-body text-xs text-[#1c1c19]/70 leading-relaxed">
                    Districts in NITI Aayog&apos;s poverty index that could be matched to the CSR filings and to Census 2011.
                  </div>
                </div>

                <div className="border-t border-[#1c1c19] pt-6">
                  <span className="font-label text-[10px] uppercase tracking-[0.3em] text-[#1c1c19] block mb-5">
                    Indians in multidimensional poverty
                  </span>
                  <div className="font-label text-3xl lg:text-4xl font-bold tracking-tighter" style={{ color: accent }}>
                    <CountUp end={nationalHr} suffix="%" decimals={2} />
                  </div>
                  <div className="mt-4 font-body text-xs text-[#1c1c19]/70 leading-relaxed">
                    NITI Aayog&apos;s national headcount ratio for 2019-21, from MPI 2023 (based on NFHS-5).
                  </div>
                </div>
              </>
            ) : (
              <>
                {(vertical?.heroStats ?? []).map((stat, i) => (
                  <div key={i} className="border-t border-[#1c1c19] pt-6">
                    <span className="font-label text-[10px] uppercase tracking-[0.3em] text-[#1c1c19] block mb-5">
                      {stat.label}
                    </span>
                    <div className="font-label text-3xl lg:text-4xl font-bold tracking-tighter" style={{ color: accent }}>
                      {stat.value}
                    </div>
                  </div>
                ))}
                <div className="border-t border-[#1c1c19] pt-6">
                  <span className="font-label text-[10px] uppercase tracking-[0.3em] text-[#1c1c19] block mb-5">
                    Districts covered
                  </span>
                  <div className="font-label text-3xl lg:text-4xl font-bold tracking-tighter" style={{ color: accent }}>
                    <CountUp end={totalDistricts} suffix=" Districts" />
                  </div>
                </div>
              </>
            )}
          </motion.div>
        </div>

        {/* Editorial exhibit band — CSR-specific insight panel */}
        {isCsr && (
          <motion.div
            variants={fadeUp}
            className="mt-24 md:mt-32 grid grid-cols-1 md:grid-cols-12 border border-[#1c1c19]"
          >
            <div className="md:col-span-7 p-10 md:p-14 border-b md:border-b-0 md:border-r border-[#1c1c19] bg-[#f6f3ee]">
              <span className="font-label text-[10px] uppercase tracking-[0.3em] block mb-6" style={{ color: accent }}>
                Finding
              </span>
              <p className="font-headline text-2xl md:text-3xl leading-tight mb-6 text-[#1c1c19]">
                Recorded CSR spending per person tends to be lower where poverty is higher.
              </p>
              <p className="font-body text-sm md:text-base text-[#1c1c19]/80 leading-relaxed">
                The index sets the CSR spending reported to the Ministry of Corporate Affairs against NITI Aayog&apos;s poverty headcount in each of {totalDistricts} districts. Across districts the pattern is loose, but between states the difference can be very large.
              </p>
            </div>
            <div className="md:col-span-5 p-10 md:p-14 flex flex-col justify-between gap-8">
              <div>
                <span className="font-label text-[10px] uppercase tracking-[0.3em] block mb-6 text-[#1c1c19]/60">
                  CSR per person, Bihar and Maharashtra
                </span>
                <div className="font-label text-[11px] uppercase tracking-widest text-[#1c1c19] mb-2">
                  Bihar · 33.76% poor · low CSR
                </div>
                <div className="h-1 w-[5%] mb-6" style={{ backgroundColor: accent }} />
                <div className="font-label text-[11px] uppercase tracking-widest text-[#1c1c19] mb-2">
                  Maharashtra · 7.81% poor · high CSR
                </div>
                <div className="h-1 bg-[#1c1c19] w-[95%]" />
              </div>
              <p className="font-body text-xs text-[#1c1c19]/70 leading-relaxed italic">
                Bihar&apos;s poverty headcount is more than four times Maharashtra&apos;s, yet Maharashtra received about {csrRatio} times as much CSR per person.
              </p>
            </div>
          </motion.div>
        )}

        {/* Scroll indicator */}
        <motion.div
          variants={fadeUp}
          className="mt-16 md:mt-20 flex items-center gap-4"
        >
          <span className="font-label text-[10px] uppercase tracking-[0.3em] text-[#1c1c19]/60">
            Ranking and method below
          </span>
          <div className="flex-grow h-px bg-[#1c1c19]/30" />
        </motion.div>
      </motion.div>
    </section>
  );
}
