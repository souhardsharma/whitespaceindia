"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import styles from "./page.module.css";

/* Brace mark: same paths as the CSR navbar's public/logo.svg, inlined here
   so the dot color can be themed per layer (ink layer vs cream layer of the
   split wordmark). Strokes use currentColor so they follow the parent
   layer's color. ViewBox matches the source SVG exactly. */
const BraceMark = ({ dotColor }: { dotColor: string }) => (
  <span className={styles.brace}>
    <svg viewBox="32 28 176 184" xmlns="http://www.w3.org/2000/svg" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M 78 40 C 58 40 56 58 56 76 C 56 98 56 104 44 116 C 44 120 44 120 44 124 C 56 136 56 142 56 164 C 56 182 58 200 78 200" stroke="currentColor" strokeWidth="20" />
      <path d="M 162 40 C 182 40 184 58 184 76 C 184 98 184 104 196 116 C 196 120 196 120 196 124 C 184 136 184 142 184 164 C 184 182 182 200 162 200" stroke="currentColor" strokeWidth="20" />
      <path d="M 98 88 C 98 72 108 62 120 62 C 134 62 144 74 144 88 C 144 104 134 110 126 118 C 120 124 120 130 120 138 L 120 146" stroke="currentColor" strokeWidth="30" />
      <circle cx="120" cy="180" r="16" fill={dotColor} />
    </svg>
  </span>
);

const BrandWordmark = ({ dotColor }: { dotColor: string }) => (
  <>
    <div className={styles.row}>
      <BraceMark dotColor={dotColor} />
      <span className={styles.wi}>
        <span className={styles.white}>White</span>
        <span className={styles.space}>space</span>
      </span>
    </div>
    <div className={styles.tag} aria-hidden="true">
      <span className={styles.word}>
        {"INDIA".split("").map((ch, i) => (
          <span key={i} className={styles.ch}>{ch}</span>
        ))}
      </span>
      <span className={styles.rule} />
    </div>
  </>
);

export default function Landing() {
  const deckRef = useRef<HTMLDivElement>(null);
  const brandRef = useRef<HTMLDivElement>(null);
  const creamRef = useRef<HTMLDivElement>(null);
  const csrRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const deck = deckRef.current;
    const brand = brandRef.current;
    const cream = creamRef.current;
    if (!deck || !brand || !cream) return;

    const updateLogoClip = () => {
      const csr = csrRef.current;
      if (!csr) {
        cream.style.clipPath = "inset(0 0 0 100%)";
        return;
      }
      const bRect = brand.getBoundingClientRect();
      const rRect = csr.getBoundingClientRect();
      const leftEdge = Math.max(bRect.left, rRect.left);
      const rightEdge = Math.min(bRect.right, rRect.right);
      if (rightEdge <= leftEdge) {
        cream.style.clipPath = "inset(0 0 0 100%)";
        return;
      }
      const leftPct = ((leftEdge - bRect.left) / bRect.width) * 100;
      const rightPct = ((bRect.right - rightEdge) / bRect.width) * 100;
      cream.style.clipPath = `inset(0 ${rightPct}% 0 ${leftPct}%)`;
    };

    const onMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const card = target.closest(`.${styles.card}`);
      if (!card) return;
      deck.classList.add(styles.hasHover);
      const v = (card as HTMLElement).dataset.vert;
      if (v === "csr") updateLogoClip();
      else cream.style.clipPath = "inset(0 0 0 100%)";
    };
    const onMouseLeave = () => {
      deck.classList.remove(styles.hasHover);
      updateLogoClip();
    };

    deck.addEventListener("mouseover", onMouseOver);
    deck.addEventListener("mouseleave", onMouseLeave);
    window.addEventListener("resize", updateLogoClip);
    requestAnimationFrame(() => requestAnimationFrame(updateLogoClip));

    return () => {
      deck.removeEventListener("mouseover", onMouseOver);
      deck.removeEventListener("mouseleave", onMouseLeave);
      window.removeEventListener("resize", updateLogoClip);
    };
  }, []);

  return (
    <main className={styles.root}>
      <div className={styles.grain} />

      <div className={styles.brand} ref={brandRef} aria-label="Whitespace India">
        <div className={`${styles.brandLayer} ${styles.brandLayerInk}`}>
          <BrandWordmark dotColor="#9b2817" />
        </div>
        <div className={`${styles.brandLayer} ${styles.brandLayerCream}`} ref={creamRef} aria-hidden="true">
          <BrandWordmark dotColor="#f3c4b4" />
        </div>
      </div>

      <div className={styles.stage}>
        <div className={styles.deck} ref={deckRef}>
          <Link
            href="/health"
            className={`${styles.card} ${styles.cardDim}`}
            data-vert="health"
            aria-label="Whitespace India Health, coming soon"
            style={{ ["--x" as string]: "0vw", ["--z" as string]: 1 } as React.CSSProperties}
          >
            <div className={`${styles.scene} ${styles.sceneHealth}`} />
            <div className={styles.corner}>
              <h2 className={styles.title}>Health</h2>
              <div className={styles.meta}>Coming soon</div>
            </div>
          </Link>

          <Link
            href="/energy"
            className={`${styles.card} ${styles.cardDim}`}
            data-vert="energy"
            aria-label="Whitespace India Energy, coming soon"
            style={{ ["--x" as string]: "16.666vw", ["--z" as string]: 2 } as React.CSSProperties}
          >
            <div className={`${styles.scene} ${styles.sceneEnergy}`} />
            <div className={styles.corner}>
              <h2 className={styles.title}>Energy</h2>
              <div className={styles.meta}>Coming soon</div>
            </div>
          </Link>

          <Link
            href="/education"
            className={`${styles.card} ${styles.cardDim}`}
            data-vert="education"
            aria-label="Whitespace India Education, coming soon"
            style={{ ["--x" as string]: "33.333vw", ["--z" as string]: 3 } as React.CSSProperties}
          >
            <div className={`${styles.scene} ${styles.sceneEducation}`} />
            <div className={styles.corner}>
              <h2 className={styles.title}>Education</h2>
              <div className={styles.meta}>Coming soon</div>
            </div>
          </Link>

          <Link
            href="/csr"
            ref={csrRef}
            className={`${styles.card} ${styles.cardActive} ${styles.csrCard}`}
            data-vert="csr"
            aria-label="Open Whitespace India CSR, opportunity index across 651 districts"
            style={{ ["--x" as string]: "50vw", ["--z" as string]: 4 } as React.CSSProperties}
          >
            <div className={`${styles.scene} ${styles.sceneCsr}`} />
            <div className={styles.corner}>
              <h2 className={styles.title}>CSR</h2>
              <div className={styles.meta}>Opportunity index · 651 districts</div>
            </div>
          </Link>
        </div>
      </div>

      <section className={styles.faq} id="about" aria-labelledby="faq-heading">
        <div className={styles.faqInner}>
          <div className={styles.faqEyebrow}>About the project</div>
          <h2 id="faq-heading" className={styles.faqHeading}>
            Frequently <em>asked</em>
          </h2>

          <ol className={styles.faqList}>
            {FAQS.map((qa, i) => (
              <li key={i} className={styles.faqItem}>
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
            <span className={styles.faqFooterText}>
              © {new Date().getFullYear()} Whitespace India
            </span>
            <div className={styles.faqFooterLinks}>
              <a
                href="https://github.com/souhardsharma/whitespaceindia-csr"
                target="_blank"
                rel="noopener noreferrer"
                className={styles.faqFooterLink}
              >
                Source on GitHub
              </a>
              <a
                href="https://www.linkedin.com/in/souhardsharma/"
                target="_blank"
                rel="noopener noreferrer"
                className={styles.faqFooterLink}
              >
                Get in touch
              </a>
            </div>
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
    q: "What is Whitespace India?",
    a: "We build instruments that show where India's resources are actually landing, and where they aren't. Public data sits trapped in PDFs and dashboards nobody opens. Our work is to read it carefully, weigh it honestly, and put it on a single screen anyone can reason from. CSR comes first because the spending is mandated, the records are public, and the misallocation is enormous.",
  },
  {
    q: "Who is this for?",
    a: "Anyone whose job involves deciding where money or attention should go inside India. Foundation officers planning their next grant cycle. Journalists chasing a story the bureaucracy has not told. Researchers asking a question no consulting deck answers. Policy people who want evidence sitting under their decisions instead of pure instinct. If your work bends a budget or shapes a campaign, you will find something useful here.",
  },
  {
    q: "Where does the data come from?",
    a: "Government records, all the way down. The NITI Aayog poverty index, the Ministry of Corporate Affairs CSR filings, the Census of India, and a handful of similarly authoritative sources. Every number we publish traces back to a document anyone can download for themselves. The full methodology lives in the open beside every result, so you can disagree with us at the level of evidence.",
  },
  {
    q: "Is everything free to use?",
    a: "Yes, and that is a deliberate choice. Every tool, every underlying dataset, every methodology note, the entire source code, all of it stays free and openly licensed under permissive terms. Charging citizens to see how their own government allocates public capital would defeat the entire point of doing this work.",
  },
  {
    q: "What's coming next?",
    a: "Health, Education, and Energy follow CSR, each with its own composite index built from signals specific to that domain. The architecture carries over. Identify the dimensions that matter inside the sector, normalise them honestly, weight them in ways anyone can audit, and surface the districts where focused attention would compound furthest. Health goes next because the underlying data is in the best shape. The rest arrive as the validation work holds up.",
  },
];

/* FAQPage schema only — Organization/WebSite live in the root layout so they
   appear on every page, not just /. Keeping FAQ here so it's tied to the
   visible FAQ markup in the same file. */
const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQS.map((qa) => ({
    "@type": "Question",
    name: qa.q,
    acceptedAnswer: { "@type": "Answer", text: qa.a },
  })),
};
