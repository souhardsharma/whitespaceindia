"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

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

export default function Hero() {
  const scrollToSimulator = () => {
    document.getElementById("simulator")?.scrollIntoView({ behavior: "smooth" });
  };

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
              Over two lakh crore in CSR since 2014.
              <br />
              <span className="italic font-light">
                The poorest districts got the least.
              </span>
            </motion.h1>

            <motion.p
              variants={fadeUp}
              className="mt-10 md:mt-14 max-w-2xl font-body text-lg md:text-xl leading-relaxed text-[#1c1c19]/90"
            >
              An investigative mapping of India&apos;s Corporate Social Responsibility landscape reveals a staggering geographical divide. While capital centers flourish, the aspirational districts remain shadowed by industrial neglect.
            </motion.p>

            {/* CTA row */}
            <motion.div
              variants={fadeUp}
              className="mt-10 md:mt-12 flex flex-col sm:flex-row gap-4"
            >
              <button
                onClick={scrollToSimulator}
                className="group bg-[#BD402C] text-white font-label uppercase tracking-[0.25em] text-xs py-5 px-8 flex justify-between items-center gap-6 hover:bg-[#1c1c19] transition-colors w-full sm:w-auto sm:min-w-[280px]"
              >
                Enter the Ledger
                <svg width="18" height="10" viewBox="0 0 24 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M0 6h22M16 1l5 5-5 5" />
                </svg>
              </button>
              <a
                href="/methodology"
                className="group border border-[#1c1c19] text-[#1c1c19] font-label uppercase tracking-[0.25em] text-xs py-5 px-8 flex justify-between items-center gap-6 hover:bg-[#1c1c19] hover:text-[#fcf9f4] transition-colors w-full sm:w-auto sm:min-w-[280px]"
              >
                Read the Methodology
                <span className="text-[10px] opacity-70">→</span>
              </a>
            </motion.div>
          </div>

          {/* Ledger / Data column */}
          <motion.div
            variants={fadeUp}
            className="md:col-span-4 lg:col-span-3 flex flex-col gap-10 md:gap-12 mt-8 md:mt-0"
          >
            <div className="border-t border-[#1c1c19] pt-6">
              <span className="font-label text-[10px] uppercase tracking-[0.3em] text-[#1c1c19] block mb-5">
                Total Expenditure
              </span>
              <div className="font-label text-3xl lg:text-4xl font-bold text-[#BD402C] tracking-tighter">
                <CountUp end={21878} prefix="₹" suffix=" Cr" />
              </div>
              <div className="mt-4 font-body text-xs text-[#1c1c19]/70 leading-relaxed">
                District-attributable CSR in FY2023-24, from Ministry of Corporate Affairs filings.
              </div>
            </div>

            <div className="border-t border-[#1c1c19] pt-6">
              <span className="font-label text-[10px] uppercase tracking-[0.3em] text-[#1c1c19] block mb-5">
                Coverage Analysis
              </span>
              <div className="font-label text-3xl lg:text-4xl font-bold text-[#BD402C] tracking-tighter">
                <CountUp end={569} suffix=" Districts" />
              </div>
              <div className="mt-4 font-body text-xs text-[#1c1c19]/70 leading-relaxed">
                Scored and ranked across administrative zones with complete data.
              </div>
            </div>

            <div className="border-t border-[#1c1c19] pt-6">
              <span className="font-label text-[10px] uppercase tracking-[0.3em] text-[#1c1c19] block mb-5">
                National Poverty
              </span>
              <div className="font-label text-3xl lg:text-4xl font-bold text-[#BD402C] tracking-tighter">
                <CountUp end={14.46} suffix="%" decimals={2} />
              </div>
              <div className="mt-4 font-body text-xs text-[#1c1c19]/70 leading-relaxed">
                Headcount ratio from NITI Aayog MPI 2023.
              </div>
            </div>
          </motion.div>
        </div>

        {/* Editorial exhibit band */}
        <motion.div
          variants={fadeUp}
          className="mt-24 md:mt-32 grid grid-cols-1 md:grid-cols-12 border border-[#1c1c19]"
        >
          <div className="md:col-span-7 p-10 md:p-14 border-b md:border-b-0 md:border-r border-[#1c1c19] bg-[#f6f3ee]">
            <span className="font-label text-[10px] uppercase tracking-[0.3em] block mb-6 text-[#BD402C]">
              Key Finding // Geographical Disparity
            </span>
            <p className="font-headline text-2xl md:text-3xl leading-tight mb-6 text-[#1c1c19]">
              CSR clusters in Tier-1 corridors while aspirational districts see minimal funding.
            </p>
            <p className="font-body text-sm md:text-base text-[#1c1c19]/80 leading-relaxed">
              Our methodology cross-references Ministry of Corporate Affairs data with NITI Aayog MPI headcount ratios to reveal the widening gap in social capital allocation across 569 districts.
            </p>
          </div>
          <div className="md:col-span-5 p-10 md:p-14 flex flex-col justify-between gap-8">
            <div>
              <span className="font-label text-[10px] uppercase tracking-[0.3em] block mb-6 text-[#1c1c19]/60">
                Key Insight // Bihar vs Maharashtra
              </span>
              <div className="font-label text-[11px] uppercase tracking-widest text-[#1c1c19] mb-2">
                Bihar: Poverty 33.76% / Low CSR
              </div>
              <div className="h-1 bg-[#BD402C] w-[5%] mb-6" />
              <div className="font-label text-[11px] uppercase tracking-widest text-[#1c1c19] mb-2">
                Maharashtra: Poverty 7.81% / High CSR
              </div>
              <div className="h-1 bg-[#1c1c19] w-[95%]" />
            </div>
            <p className="font-body text-xs text-[#1c1c19]/70 leading-relaxed italic">
              Bihar has ~5&times; the poverty rate of Maharashtra, yet receives roughly 22&times; less CSR per person.
            </p>
          </div>
        </motion.div>

        {/* Scroll indicator */}
        <motion.div
          variants={fadeUp}
          className="mt-16 md:mt-20 flex items-center gap-4"
        >
          <span className="font-label text-[10px] uppercase tracking-[0.3em] text-[#1c1c19]/60">
            Scroll to explore
          </span>
          <div className="flex-grow h-px bg-[#1c1c19]/30" />
        </motion.div>
      </motion.div>
    </section>
  );
}
