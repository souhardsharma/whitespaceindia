"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import styles from "./page.module.css";
import csrMeta from "@/public/data/csr/meta.json";


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
      <a href="#main-content" className={styles.stickyBrand} aria-label="Back to top">
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
      <span className={styles.stickyTag}>Public data on India&apos;s districts</span>
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
  vert: "csr" | "health" | "energy" | "education" | "instruments";
  num: string;
  title: string;
  meta: string;
  img: string;
  alt: string;
  /** Which part of the 16:9 print survives the tile's cover crop: x for
      the ~1.4:1 desktop tile, y for the ~2.9:1 phone tile. The CSR banner
      sets its own in page.module.css, because it changes with the layout. */
  pos?: string;
  active: boolean;
  accent: "terra" | "cobalt" | "forest" | "ochre" | "graphite";
  aria: string;
};

const VERTS: Vert[] = [
  {
    href: "/csr",
    vert: "csr",
    num: "01",
    title: "CSR",
    meta: "Opportunity Index · Live",
    img: "/landing/csr-horizon-2.webp",
    alt: "A long horizon of pale, dry village plots; a watering can pours on only a few of them",
    active: true,
    accent: "terra",
    aria: `Open the CSR Opportunity Index, which ranks ${csrMeta.total_districts} Indian districts`,
  },
  {
    href: "/health",
    vert: "health",
    num: "02",
    title: "Health",
    meta: "Health care access · Coming soon",
    img: "/landing/health-road-2.webp",
    alt: "A road winds across the hills from a village to a distant clinic",
    pos: "80% 100%",
    active: true,
    accent: "cobalt",
    aria: "Health index, a preview on placeholder data",
  },
  {
    href: "/energy",
    vert: "energy",
    num: "03",
    title: "Energy",
    meta: "Power supply and access · Coming soon",
    img: "/landing/energy-line-2.webp",
    alt: "Power poles cross the hills and stop short of a village; one house is lit by a solar panel",
    pos: "50% 70%",
    active: true,
    accent: "forest",
    aria: "Energy index, a preview on placeholder data",
  },
  {
    href: "/education",
    vert: "education",
    num: "04",
    title: "Education",
    meta: "Schools and learning · Coming soon",
    img: "/landing/education-paths-2.webp",
    alt: "Children walk the footpaths across the hills to a one-room village school",
    pos: "50% 60%",
    active: true,
    accent: "ochre",
    aria: "Education index, a preview on placeholder data",
  },
  {
    href: "/instruments",
    vert: "instruments",
    num: "05",
    title: "Instruments",
    meta: "One project at a time · Live",
    img: "/landing/instruments-lens-2.webp",
    alt: "A magnifying glass held over one house among farms, a mine, a well and a factory",
    pos: "50% 50%",
    active: true,
    accent: "graphite",
    aria: "Open the instruments, which profile one project at a time",
  },
];

export default function Landing() {
  return (
    <main className={styles.root} id="main-content">
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

        {/* MAIN GRID — full-width headline, then 2×2 tile grid */}
        <div className={styles.grid}>

          {/* HEADLINE — spans full width */}
          <div className={styles.stmtCol}>
            <h2 className={styles.headline}>
              <span className={styles.hPublic}>Public</span>
              <span className={styles.hBrace}>{'{'}</span>
              <span className={styles.hNoun}>Data</span>
              <span className={styles.hDot} aria-hidden="true">·</span>
              <span className={styles.hBrand}>Whitespaces</span>
              <span className={styles.hDot} aria-hidden="true">·</span>
              <span className={styles.hNoun}>Instruments</span>
              <span className={styles.hBrace}>{'}'}</span>
            </h2>
          </div>

          {/* 2×2 TILE GRID — all four verticals at equal size */}
          <div className={styles.tileGrid}>
            {/* CSR — featured tile with stats */}
            <Link
              href="/csr"
              className={`${styles.tile} ${styles.tileCsr}`}
              aria-label={VERTS[0].aria}
            >
              <Image
                src={VERTS[0].img}
                alt={VERTS[0].alt}
                fill
                sizes="(max-width: 860px) 92vw, 96vw"
                quality={95}
                priority
                className={styles.tileImg}
              />
              {/* The banner's text prints in ink on its sky, the one part of the
                  print that is empty at every width (about 2.2:1 on a phone to
                  3.8:1 on a tablet). On the ground it fitted only on desktop. */}
              <div className={styles.tileFrameCsr}>
                <div className={styles.tileTopRow}>
                  <span className={styles.tileNum}>01</span>
                  <span className={styles.liveTag}>
                    <span className={styles.liveDot} />
                    Live
                  </span>
                </div>
                <div className={styles.csrHeading}>
                  <div>
                    <h3 className={styles.tileTitle}>CSR Opportunity Index</h3>
                    <div className={styles.tileStats}>
                      <span className={styles.statBig}>
                        <Odometer to={csrMeta.total_districts} />
                        <span className={styles.statUnit}>districts ranked</span>
                      </span>
                      <span className={styles.statDivider} />
                      <span className={styles.statBig}>
                        ₹<Odometer to={26000} duration={1800} />
                        <span className={styles.statUnit}>crore a year</span>
                      </span>
                    </div>
                  </div>
                </div>
                <span className={`${styles.tileArrow} ${styles.csrArrow}`} aria-hidden="true">↗</span>
              </div>
            </Link>

            {/* Remaining 3 verticals */}
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
                  priority
                  className={styles.tileImg}
                  style={{ objectPosition: v.pos }}
                />
                <div className={styles.tileFrame}>
                  <div className={styles.tileTopRow}>
                    <span className={styles.tileNum}>{v.num}</span>
                  </div>
                  {/* Meta sits under the title, not opposite the number. At four
                      columns the top row has zero slack — measured: 33 px badge
                      plus a 259 px tag in 292 px — so the tag wrapped. Below the
                      title it also reads better, pairing each name with its
                      descriptor. */}
                  <div className={styles.tileBottomRow}>
                    <div className={styles.tileHeading}>
                      <h3 className={styles.tileTitle}>{v.title}</h3>
                      <span className={styles.tileMeta}>{v.meta}</span>
                    </div>
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
          through the five tile inks (terra, cobalt, forest, ochre, graphite)
          so the brand palette persists below the hero. */}
      <section className={styles.faq} id="about" aria-labelledby="faq-heading">
        <header className={styles.faqHeader}>
          <div className={styles.faqEyebrow}>About the project</div>
          <h2 id="faq-heading" className={styles.faqHeading}>
            Frequently asked <em>questions</em>
          </h2>
        </header>

        <ol className={styles.faqList}>
          {FAQS.map((qa, i) => (
            <li key={i} className={styles.faqItem} data-accent={i % 5}>
              <details className={styles.faqDetails}>
                <summary className={styles.faqSummary}>
                  <span className={styles.faqNumber}>{String(i + 1).padStart(2, "0")}</span>
                  <span className={styles.faqQuestion}>{qa.q}</span>
                  <span className={styles.faqIndicator} aria-hidden="true">+</span>
                </summary>
                <p className={styles.faqAnswer}>
                  {qa.a}
                  {qa.more ? (
                    <>
                      {" "}
                      <Link href={qa.more.href} prefetch={false} className={styles.faqMore}>
                        {qa.more.label}
                        <span aria-hidden="true"> &#8599;</span>
                      </Link>
                    </>
                  ) : null}
                </p>
              </details>
            </li>
          ))}
        </ol>

        <div className={styles.faqFooter}>
          <span className={styles.faqFooterText}>© {new Date().getFullYear()} Whitespace India</span>
          <div className={styles.faqFooterLinks}>
            <a href="https://github.com/souhardsharma/whitespaceindia" target="_blank" rel="noopener noreferrer" className={styles.faqFooterLink}>Source on GitHub</a>
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

/* What a first-time visitor needs to decide whether to trust and use the site.
   Every claim here is checkable against the site itself: what is live, what is
   placeholder, where each number comes from and what it may be reused for.
   The structured data below is built from this array, so the two cannot drift. */
type Faq = { q: string; a: string; more?: { href: string; label: string } };

const PAN_INDIA_SHARE = Math.round(csrMeta.csr_totals.pan_india_pct);

const FAQS: Faq[] = [
  {
    q: "What is Whitespace India?",
    a: "Whitespace India reads India's public records against one another to find problems that no single record shows. The Census counts who lives in each district, NITI Aayog measures how many of them are poor, companies report where they spend their CSR money, and the environment ministry logs every project that applies for environmental clearance. Each of these records is usually read on its own. Set side by side, they point to places where need is high and the money or attention reaching it is thin, and we call those gaps white spaces. We publish the evidence for each one together with the data and the method, so that researchers, journalists, funders, officials and the people who live there can check our reading and take the work further.",
  },
  {
    q: "What counts as a white space?",
    a: `A white space is a place where the evidence of need is strong and the recorded response to it is weak. In the CSR index, a district meets that test when it falls in the poorest quarter of districts on NITI Aayog's poverty measure and in the bottom quarter on CSR spending per person. Being on that list is a reason to look closer, and the explanation can turn out to be ordinary. Money may arrive through channels the filings do not record, or conditions may have changed since the data was collected. Finding out which is the work we hope others will pick up.`,
    more: { href: "/csr", label: "See the districts" },
  },
  {
    q: "Who is it for?",
    a: "It is meant for anyone who needs to know where a problem lies before deciding what to do about it. A researcher can use the index to choose districts for fieldwork, and a company or foundation can see where its CSR money has not gone. When a mine or a dam is proposed, a journalist or a member of the village assembly can look up the project and see who lives where it would be built. Everything on the site can also be downloaded for work we have not thought of.",
  },
  {
    q: "What is the difference between an index and an instrument?",
    a: "They work at different scales. An index scores every district on one question and ranks them, and you can change the weights behind the score to see how the ranking moves. The CSR Opportunity Index is the first of these. An instrument starts from a single case and builds its profile with no score or ranking attached, and People & Consent, which profiles one proposed project at a time, is the first of those. The index helps when you are deciding where to look, and the instrument helps once a particular project is in front of you.",
  },
  {
    q: "How does the CSR index rank a district?",
    a: `A district's score combines three measures. Poverty is the share of people NITI Aayog counted as multidimensionally poor in its 2023 index. The funding gap takes the CSR spending recorded in a district over the financial years 2021-22 to 2023-24, divides it by the district's population, and compares the result with the median for districts of similar population, so that a small district is judged against small districts. Persistence is the share of a district's 2015-16 poverty that was still there in 2019-21. Poverty and the gap each carry 40% of the score and persistence 20%, and you can change these weights yourself. About ${PAN_INDIA_SHARE}% of all CSR money in the filings is reported as "Pan India" or names no district, so it cannot be placed, and every district total in the index should be read as a floor.`,
    more: { href: "/methodology", label: "Read the method" },
  },
  {
    q: "What does People & Consent show about a proposal?",
    a: "It starts by placing the project. The district and sub-district come from the developer's own application form on PARIVESH, the environment ministry's clearance portal, and are checked against the site coordinates where the form gives them. The profile then describes the people who live there, using the 2011 Census for population, the Scheduled Tribe and Scheduled Caste shares, literacy, the number of workers who depend on land, and the schools and health posts in the area. It says whether the site lies in a Fifth Schedule Area, where the PESA Act of 1996 gives the gram sabha a legal role in decisions about land and local resources, and lists the forest, wildlife and coastal clearances the form declares. It also records how long the proposal has been under appraisal. The profile takes no position on whether the project should go ahead.",
    more: { href: "/instruments/consent", label: "Look up a proposal" },
  },
  {
    q: "How current is it?",
    a: "The clearance register is read again every night, and each instrument page states when its copy was last checked. The CSR index is a fixed edition built on spending from 2021-22 to 2023-24. Population figures come from the 2011 Census, which is still the most recent one India has published, so they describe the people who lived in a place in 2011 and are labelled with that year wherever they appear.",
  },
  {
    q: "Where does the data come from?",
    a: "All of it comes from public records, most of them published by the government and a few made usable by research groups. The CSR index draws on NITI Aayog's Multidimensional Poverty Index, the CSR filings companies make to the Ministry of Corporate Affairs (as compiled by Dataful.in), and the 2011 Census. People & Consent reads the PARIVESH register, each proposal's application form and its appraisal history directly from the portal. To these it adds the 2011 Census and the 2011 Socio Economic and Caste Census as cleaned in the SHRUG research dataset, district boundaries for 2011 from datameet, and the Presidential Orders that define the Scheduled Areas. Each figure on an instrument page names its source and year.",
  },
  {
    q: "Can I reuse the data?",
    a: "Yes, as long as you credit Whitespace India. The data is published under CC BY 4.0, which allows commercial use. The one exception is the district and sub-district profiles in People & Consent, which carry figures from SHRUG and keep its CC BY-NC-SA 4.0 licence, so they cannot be used commercially. The code is open source under AGPL-3.0, and the data page lists each file with its licence.",
    more: { href: "/instruments/consent/data", label: "Every file and its licence" },
  },
  {
    q: "What about Health, Energy and Education?",
    a: "These are planned indexes. Their pages show how each will work, but the numbers on them are placeholders that describe no actual district, and for that reason the pages are kept out of search results. Each will go live once its data and method are ready, and no order or date has been set.",
  },
  {
    q: "Who runs it?",
    a: "Whitespace India is built and maintained independently by Souhard Sharma. It has no official status, and the figures on it are the project's own calculations from official sources. Corrections are welcome through GitHub or LinkedIn, both linked below.",
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
