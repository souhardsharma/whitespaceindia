"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useScroll, useTransform } from "framer-motion";

function CountUp({
  end,
  prefix = "",
  suffix = "",
  decimals = 0,
  duration = 2200,
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

function SubtleBackground() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `
            linear-gradient(rgba(245,166,35,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(245,166,35,0.03) 1px, transparent 1px)
          `,
          backgroundSize: "80px 80px",
          maskImage: "linear-gradient(to bottom, transparent 0%, black 30%, black 60%, transparent 100%)",
          WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 30%, black 60%, transparent 100%)",
        }}
      />
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full"
        style={{
          background: "radial-gradient(circle, rgba(245,166,35,0.06) 0%, transparent 70%)",
        }}
      />
    </div>
  );
}

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.18 } },
};

const fadeUp = {
  hidden: { opacity: 0, y: 40 },
  show: { opacity: 1, y: 0, transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] } },
};

export default function Hero() {
  const containerRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end start"],
  });
  const y = useTransform(scrollYProgress, [0, 1], ["0%", "25%"]);
  const opacity = useTransform(scrollYProgress, [0, 0.5], [1, 0]);

  const scrollToSimulator = () => {
    document.getElementById("simulator")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <section
      ref={containerRef}
      className="relative min-h-screen flex items-center justify-center overflow-hidden bg-[#0B1526]"
    >
      {/* Hero background image with parallax */}
      <motion.div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage: "url('/images/hero-bg.png')",
          y,
          opacity: 0.35,
        }}
      />

      {/* Deep gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#0B1526]/70 via-[#0B1526]/50 to-[#0B1526]" />

      <SubtleBackground />

      <motion.div
        className="relative z-10 text-center px-4 max-w-5xl mx-auto pt-24"
        style={{ opacity }}
        variants={stagger}
        initial="hidden"
        animate="show"
      >
        {/* Badge */}
        <motion.div variants={fadeUp} className="flex justify-center mb-6">
          <span className="inline-flex items-center gap-2 bg-[#F5A623]/10 border border-[#F5A623]/30 text-[#F5A623] text-xs font-semibold tracking-widest uppercase px-4 py-2 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-[#F5A623] animate-pulse" />
            583 Indian Districts Scored
          </span>
        </motion.div>

        {/* Main headline */}
        <motion.h1
          variants={fadeUp}
          className="font-display font-bold leading-[1.35] mb-6"
          style={{ fontSize: "clamp(2.6rem, 7vw, 5.5rem)" }}
        >
          <span className="text-white block">
            Two lakh crore in CSR.
          </span>
          <span
            className="block"
            style={{
              background: "linear-gradient(135deg, #F5A623 0%, #FBBF24 50%, #F97316 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            The poorest districts got the least.
          </span>
        </motion.h1>

        {/* Subheadline */}
        <motion.p
          variants={fadeUp}
          className="text-[#94A3B8] text-lg md:text-xl max-w-2xl mx-auto mb-14 leading-relaxed"
        >
          Find where philanthropic capital is absent. An evidence-based tool for foundation leaders and program officers directing CSR strategy across India.
        </motion.p>

        {/* Stats */}
        <motion.div
          variants={fadeUp}
          className="grid grid-cols-1 sm:grid-cols-3 gap-px mb-14 max-w-2xl mx-auto bg-white/10 rounded-2xl overflow-hidden border border-white/10"
        >
          {[
            {
              end: 34909,
              prefix: "₹",
              suffix: " Cr",
              decimals: 0,
              label: "CSR spent in FY2023-24",
            },
            {
              end: 583,
              prefix: "",
              suffix: "",
              decimals: 0,
              label: "districts scored",
            },
            {
              end: 14.96,
              prefix: "",
              suffix: "%",
              decimals: 2,
              label: "national poverty headcount",
            },
          ].map((stat, i) => (
            <div
              key={stat.label}
              className="bg-[#0B1526]/80 backdrop-blur-sm py-6 px-4 text-center"
              style={{
                borderRight: i < 2 ? "1px solid rgba(255,255,255,0.08)" : undefined,
              }}
            >
              <div
                className="text-3xl md:text-4xl font-bold mb-1"
                style={{
                  background: "linear-gradient(135deg, #F5A623, #FBBF24)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                <CountUp
                  end={stat.end}
                  prefix={stat.prefix}
                  suffix={stat.suffix}
                  decimals={stat.decimals}
                />
              </div>
              <div className="text-xs text-[#94A3B8] uppercase tracking-wider">{stat.label}</div>
            </div>
          ))}
        </motion.div>

        {/* CTA */}
        <motion.div variants={fadeUp} className="flex flex-col sm:flex-row gap-4 justify-center">
          <button
            onClick={scrollToSimulator}
            className="relative overflow-hidden group bg-[#F5A623] text-[#0B1526] font-bold text-base rounded-full px-8 py-4 transition-all duration-300 hover:shadow-[0_0_30px_rgba(245,166,35,0.4)] hover:scale-105"
          >
            <span className="relative z-10">Open Simulator</span>
            <div className="absolute inset-0 bg-gradient-to-r from-[#FBBF24] to-[#F97316] opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
          </button>
          <a
            href="/methodology"
            className="border border-white/20 text-white font-medium text-base rounded-full px-8 py-4 hover:bg-white/5 hover:border-white/40 transition-all duration-300"
          >
            Read the Methodology
          </a>
        </motion.div>

        {/* Scroll indicator */}
        <motion.div
          variants={fadeUp}
          className="mt-16 flex flex-col items-center gap-2"
        >
          <span className="text-xs text-[#94A3B8] tracking-widest uppercase">Scroll to explore</span>
          <motion.div
            className="w-px h-12 bg-gradient-to-b from-[#F5A623]/60 to-transparent"
            animate={{ scaleY: [0, 1, 0], opacity: [0, 1, 0] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
            style={{ transformOrigin: "top" }}
          />
        </motion.div>
      </motion.div>
    </section>
  );
}
