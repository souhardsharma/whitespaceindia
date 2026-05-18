"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import styles from "./page.module.css";


/* Sticky compressed topbar — appears once the user scrolls past the
   hero. Anchors the brand identity for the rest of the page so the FAQ
   never reads as a different site. Slides in from the top via transform. */
function StickyHeader() {
  const [active, setActive] = useState(false);

  useEffect(() => {
    let raf = 0;
    let ticking = false;
    const threshold = () => window.innerHeight * 0.72;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      raf = requestAnimationFrame(() => {
        setActive(window.scrollY > threshold());
        ticking = false;
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <header
      className={`${styles.stickyHeader} ${active ? styles.stickyActive : ""}`}
      aria-hidden={!active}
    >
      <a href="#top" className={styles.stickyBrand} aria-label="Back to top">
        <span className={styles.stickyMark} aria-hidden="true">
          <BraceMark dotColor="#9b2817" />
        </span>
        <span className={styles.stickyWord}>
          <span className={styles.bWhite}>White</span>
          <span className={styles.bSpace}>space</span>
          <span className={styles.bSlash}>/</span>
          <span className={styles.bIndia}>India</span>
        </span>
      </a>
      <a href="/csr" className={styles.stickyCta}>
        Open the CSR Index
        <span aria-hidden="true">↗</span>
      </a>
    </header>
  );
}

/* Live CSR-in-India news wire — continuously scrolling marquee of real
   headlines from Google News (via /api/news, 30-min server cache).
   Items are duplicated 2x for seamless infinite loop. Each headline is
   clickable; hover pauses the scroll. Pulse dot anchors the "LIVE" label
   on the left of the strip. */
type NewsItem = { title: string; link: string; source: string; pubDate: string };

function NewsTicker() {
  const [items, setItems] = useState<NewsItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/news")
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && Array.isArray(d.items)) setItems(d.items);
      })
      .catch(() => { /* keep fallback */ });
    return () => { cancelled = true; };
  }, []);

  const display = items.length > 0 ? items : [
    { title: "Fetching the latest CSR news from India…", link: "#", source: "", pubDate: "" },
  ];
  /* duplicate the list so the CSS infinite scroll loops seamlessly */
  const looped = [...display, ...display];

  return (
    <div className={styles.tickerSlot} aria-label="Live CSR news from India">
      <span className={styles.tickerLabel}>
        <span className={styles.tickerPulse} aria-hidden="true" />
        Live · CSR India
      </span>
      <div className={styles.tickerWire}>
        <div
          className={styles.tickerTrack}
          style={{
            ["--ticker-duration" as string]: `${Math.max(40, display.length * 8)}s`,
          } as React.CSSProperties}
        >
          {looped.map((item, idx) => (
            item.link === "#" ? (
              <span key={idx} className={styles.tickerItem}>
                <span className={styles.tickerHead}>{item.title}</span>
              </span>
            ) : (
              <a
                key={idx}
                href={item.link}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.tickerItem}
              >
                <span className={styles.tickerHead}>{item.title}</span>
                {item.source ? (
                  <span className={styles.tickerSrc}>· {item.source}</span>
                ) : null}
                <span className={styles.tickerSep} aria-hidden="true">●</span>
              </a>
            )
          ))}
        </div>
      </div>
    </div>
  );
}

/* {?} brace mark — used at multiple scales across the page. */
const BraceMark = ({ dotColor = "#9b2817" }: { dotColor?: string }) => (
  <svg viewBox="32 28 176 184" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M 78 40 C 58 40 56 58 56 76 C 56 98 56 104 44 116 C 44 120 44 120 44 124 C 56 136 56 142 56 164 C 56 182 58 200 78 200" stroke="currentColor" strokeWidth="22" />
    <path d="M 162 40 C 182 40 184 58 184 76 C 184 98 184 104 196 116 C 196 120 196 120 196 124 C 184 136 184 142 184 164 C 184 182 182 200 162 200" stroke="currentColor" strokeWidth="22" />
    <path d="M 98 88 C 98 72 108 62 120 62 C 134 62 144 74 144 88 C 144 104 134 110 126 118 C 120 124 120 130 120 138 L 120 146" stroke="currentColor" strokeWidth="32" />
    <circle cx="120" cy="180" r="18" fill={dotColor} />
  </svg>
);

/* Odometer — count up from 0 to target when first visible.
   Uses RAF + eased curve; respects prefers-reduced-motion. */
function Odometer({ to, duration = 1400 }: { to: number; duration?: number }) {
  const [n, setN] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const started = useRef(false);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { setN(to); return; }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !started.current) {
        started.current = true;
        const start = performance.now();
        const tick = (t: number) => {
          const p = Math.min(1, (t - start) / duration);
          /* cubic-bezier ease-out feel */
          const eased = 1 - Math.pow(1 - p, 3);
          setN(Math.round(to * eased));
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        io.disconnect();
      }
    }, { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, [to, duration]);

  return <span ref={ref}>{n.toLocaleString("en-IN")}</span>;
}


type Vert = {
  href: string;
  vert: "csr" | "health" | "energy" | "education";
  num: string;
  title: string;
  meta: string;
  img: string;
  alt: string;
  active: boolean;
  accent: "terra" | "cobalt" | "forest" | "ochre";
  aria: string;
};

const VERTS: Vert[] = [
  {
    href: "/csr",
    vert: "csr",
    num: "01",
    title: "CSR",
    meta: "Opportunity index",
    img: "/landing/csr-hands.webp",
    alt: "CSR opportunity index across 651 Indian districts",
    active: true,
    accent: "terra",
    aria: "Open the CSR Opportunity Index, 651 Indian districts",
  },
  {
    href: "/health",
    vert: "health",
    num: "02",
    title: "Health",
    meta: "Infrastructure gaps · Coming soon",
    img: "/landing/health-bg.webp",
    alt: "Health infrastructure gap analysis across Indian districts",
    active: true,
    accent: "cobalt",
    aria: "Whitespace India Health — infrastructure gap analysis, coming soon",
  },
  {
    href: "/energy",
    vert: "energy",
    num: "03",
    title: "Energy",
    meta: "Access & transition · Coming soon",
    img: "/landing/energy-bg.webp",
    alt: "Energy access and transition analysis across Indian districts",
    active: true,
    accent: "forest",
    aria: "Whitespace India Energy — access and transition analysis, coming soon",
  },
  {
    href: "/education",
    vert: "education",
    num: "04",
    title: "Education",
    meta: "Outcomes index · Coming soon",
    img: "/landing/education-bg.webp",
    alt: "Education outcomes and access analysis across Indian districts",
    active: true,
    accent: "ochre",
    aria: "Whitespace India Education — outcomes index, coming soon",
  },
];

export default function Landing() {
  return (
    <main className={styles.root} id="top">
      <div className={styles.grain} aria-hidden="true" />
      <StickyHeader />

      {/* ───────────────────────── HERO CONSOLE ───────────────────────── */}
      <section className={styles.hero} aria-label="Whitespace India">

        {/* TOP STRIP — brand left (big, mark+text aligned to cap-height),
            featured insight right (a real fact from the CSR Index). */}
        <header className={styles.topbar}>
          <div className={styles.brandSlot}>
            <span className={styles.brandMark} aria-hidden="true">
              <BraceMark dotColor="#9b2817" />
            </span>
            <h1 className={styles.brandWord}>
              <span className={styles.bWhite}>White</span>
              <span className={styles.bSpace}>space</span>
              <span className={styles.bSlash}>/</span>
              <span className={styles.bIndia}>India</span>
            </h1>
          </div>

          <NewsTicker />
        </header>

        {/* MAIN GRID — left statement, right featured CSR, bottom 3 tiles */}
        <div className={styles.grid}>

          {/* LEFT — statement */}
          <div className={styles.stmtCol}>
            <h2 className={styles.headline}>
              <span className={styles.hLine}><span className={styles.hWord}>India&apos;s public data,</span></span>
              <span className={styles.hLine}><span className={styles.hWord}><span className={styles.hItalic}>made into</span> instruments.</span></span>
            </h2>
            <div className={styles.actions}>
              <Link href="/csr" className={styles.ctaPrimary}>
                <span>Open the CSR Index</span>
                <span className={styles.ctaArrow} aria-hidden="true">↗</span>
              </Link>
            </div>
          </div>

          {/* RIGHT — featured CSR tile */}
          <div className={styles.featureWrap}>
            <Link
              href="/csr"
              className={`${styles.feature} ${styles.featureCsr}`}
              aria-label={VERTS[0].aria}
            >
              <Image
                src={VERTS[0].img}
                alt={VERTS[0].alt}
                fill
                sizes="(max-width: 860px) 92vw, 48vw"
                quality={95}
                priority
                className={styles.featureImg}
              />
              <div className={styles.featureFrame}>
                <div className={styles.featureTopRow}>
                  <span className={styles.featureNum}>01</span>
                  <span className={styles.liveTag}>
                    <span className={styles.liveDot} />
                    Live
                  </span>
                </div>
                <div className={styles.featureBottom}>
                  <h3 className={styles.featureTitle}>CSR Opportunity Index</h3>
                  <div className={styles.featureStats}>
                    <span className={styles.statBig}>
                      <Odometer to={651} />
                      <span className={styles.statUnit}>districts</span>
                    </span>
                    <span className={styles.statDivider} />
                    <span className={styles.statBig}>
                      ₹<Odometer to={26000} duration={1800} />
                      <span className={styles.statUnit}>cr / yr</span>
                    </span>
                  </div>
                  <span className={styles.featureArrow} aria-hidden="true">↗</span>
                </div>
              </div>
            </Link>
          </div>

          {/* BOTTOM — three smaller vertical tiles */}
          <div className={styles.tileRow}>
            {VERTS.slice(1).map((v) => (
              <Link
                key={v.vert}
                href={v.href}
                className={`${styles.tile} ${styles[`accent_${v.accent}`]}`}
                aria-label={v.aria}
              >
                <Image
                  src={v.img}
                  alt={v.alt}
                  fill
                  sizes="(max-width: 860px) 92vw, 33vw"
                  quality={95}
                  className={styles.tileImg}
                />
                <div className={styles.tileFrame}>
                  <div className={styles.tileTopRow}>
                    <span className={styles.tileNum}>{v.num}</span>
                    <span className={styles.tileTag}>{v.meta}</span>
                  </div>
                  <div className={styles.tileBottomRow}>
                    <h3 className={styles.tileTitle}>{v.title}</h3>
                    <span className={styles.tileArrow} aria-hidden="true">↗</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>

        </div>
      </section>

      {/* ───────────── FAQ — asymmetric grid + cycled riso accents ─────────────
          Layout language matches the hero: a 12-col grid, with each Q&A item
          laid out asymmetrically (number narrow / question wide / answer
          offset). Left edge of each item carries a 4-px accent bar cycling
          through the four riso colours (terra, cobalt, forest, ochre) so the
          brand palette persists below the hero. */}
      <section className={styles.faq} id="about" aria-labelledby="faq-heading">
        <header className={styles.faqHeader}>
          <div className={styles.faqEyebrow}>About the project</div>
          <h2 id="faq-heading" className={styles.faqHeading}>
            Frequently <em>asked</em>
          </h2>
        </header>

        <ol className={styles.faqList}>
          {FAQS.map((qa, i) => (
            <li key={i} className={styles.faqItem} data-accent={i % 4}>
              <details className={styles.faqDetails}>
                <summary className={styles.faqSummary}>
                  <span className={styles.faqNumber}>{String(i + 1).padStart(2, "0")}</span>
                  <span className={styles.faqQuestion}>{qa.q}</span>
                  <span className={styles.faqIndicator} aria-hidden="true">+</span>
                </summary>
                <p className={styles.faqAnswer}>{qa.a}</p>
              </details>
            </li>
          ))}
        </ol>

        <div className={styles.faqFooter}>
          <span className={styles.faqFooterText}>© {new Date().getFullYear()} Whitespace India</span>
          <div className={styles.faqFooterLinks}>
            <a href="https://github.com/souhardsharma/whitespaceindia-csr" target="_blank" rel="noopener noreferrer" className={styles.faqFooterLink}>Source on GitHub</a>
            <a href="https://www.linkedin.com/in/souhardsharma/" target="_blank" rel="noopener noreferrer" className={styles.faqFooterLink}>Get in touch</a>
          </div>
        </div>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }}
      />
    </main>
  );
}

const FAQS: { q: string; a: string }[] = [
  {
    q: "What does Whitespace India actually do?",
    a: "We build tools from India's public records, each one a focused instrument for mapping where public capital, attention, and programmatic effort are reaching across the country at a district level. The CSR Opportunity Index is the first instrument live; Health, Education, and Energy are in development.",
  },
  {
    q: "Who are the instruments built for?",
    a: "Grant officers planning a cycle, journalists tracing a story the official record hasn't yet told, researchers asking a district-level question that consulting decks don't answer, and policymakers who want evidence sitting under their next decision.",
  },
  {
    q: "Where does the data come from?",
    a: "Everything we publish comes from India's public records, accessed primarily through aggregation platforms like IndiaStat and Dataful that consolidate the underlying ministry filings, statistical releases, and survey data for each domain.",
  },
  {
    q: "What's next on the roadmap?",
    a: "Health is the next instrument because its source data is in the cleanest shape today, followed by Education and then Energy. Each domain is treated independently, with its own composite index and its own methodology calibrated to the signals that matter inside that sector.",
  },
];

const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQS.map((qa) => ({
    "@type": "Question",
    name: qa.q,
    acceptedAnswer: { "@type": "Answer", text: qa.a },
  })),
};
