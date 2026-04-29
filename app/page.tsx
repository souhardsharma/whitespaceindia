"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import styles from "./page.module.css";

/* Brace mark: { ? } with a terra-cotta dot replacing the ?'s natural dot.
   Designed in a 100x80 viewBox so braces (font-size 80, weight 900) and the
   question mark stem + dot all sit on a shared baseline grid. The dot is
   x-centered with the stem (cx=50) and y-positioned just below the stem
   terminus (stem ends at y=46, dot at y=54) — so it reads as one composite
   glyph, not three drifting elements. */
const BraceMark = ({ dotColor }: { dotColor: string }) => (
  <span className={styles.brace}>
    <svg viewBox="0 0 100 80" xmlns="http://www.w3.org/2000/svg">
      <text x="0" y="62" fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, monospace" fontWeight="900" fontSize="80" fill="currentColor">{"{"}</text>
      <text x="68" y="62" fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, monospace" fontWeight="900" fontSize="80" fill="currentColor">{"}"}</text>
      <path d="M 41 22 C 41 13, 46 7, 50 7 C 54 7, 59 13, 59 22 C 59 28, 55 31, 52 33 C 50 35, 50 37, 50 40 L 50 46 L 46 46 L 46 40 C 46 35, 49 33, 51 31 C 54 29, 56 26, 56 22 C 56 17, 53 13, 50 13 C 47 13, 44 17, 44 22 Z" fill="currentColor" />
      <circle cx="48" cy="54" r="3.6" fill={dotColor} />
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
            aria-label="Whitespace India Health — coming soon"
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
            aria-label="Whitespace India Energy — coming soon"
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
            aria-label="Whitespace India Education — coming soon"
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
            aria-label="Open Whitespace India CSR — opportunity index across 651 districts"
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
                <div className={styles.faqNumber}>{String(i + 1).padStart(2, "0")}</div>
                <div>
                  <h3 className={styles.faqQuestion}>{qa.q}</h3>
                  <p className={styles.faqAnswer}>{qa.a}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className={styles.faqFooter}>
            <span className={styles.faqFooterText}>
              © {new Date().getFullYear()} Whitespace India
            </span>
            <a
              href="https://www.linkedin.com/in/souhardsharma/"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.faqFooterLink}
            >
              Get in touch →
            </a>
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
    a: "A research project mapping the gap between public need and where capital actually flows across India. We turn government data into open, interactive tools that show where attention is missing — starting with CSR philanthropy and expanding into health, education, and energy.",
  },
  {
    q: "Who is this for?",
    a: "Anyone making allocation decisions with public consequence — funders, policymakers, journalists, researchers, civic leaders. The tools are useful whenever the question is some version of \"where should this money go?\"",
  },
  {
    q: "Where does the data come from?",
    a: "Exclusively from public government records — NITI Aayog, the Ministry of Corporate Affairs, the Census of India, and similar primary sources. Every dataset and methodological choice is documented openly. No private data, no proprietary models.",
  },
  {
    q: "Is everything free to use?",
    a: "Yes. All tools, datasets, and analyses are openly accessible. Public-interest data should remain in public hands — that's the operating principle, not a marketing claim.",
  },
  {
    q: "What's coming next?",
    a: "Health, Education, and Energy verticals — each applying the same opportunity-mapping approach to a different domain. We build where allocation visibility is poorest and the spend is largest. Timeline depends on data availability and validation.",
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
