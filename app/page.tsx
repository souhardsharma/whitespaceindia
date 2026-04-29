"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import styles from "./page.module.css";

const BraceMark = ({ dotColor }: { dotColor: string }) => (
  <span className={styles.brace}>
    <svg viewBox="0 0 92 70" xmlns="http://www.w3.org/2000/svg">
      <text x="0" y="56" fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, monospace" fontWeight="700" fontSize="74" fill="currentColor">{"{"}</text>
      <text x="60" y="56" fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, monospace" fontWeight="700" fontSize="74" fill="currentColor">{"}"}</text>
      <path d="M 32 22 C 32 12, 39 6, 47 6 C 56 6, 63 12, 63 22 C 63 30, 57 34, 51 38 C 47 40, 46 43, 46 47 L 46 50 L 40 50 L 40 46 C 40 39, 44 36, 49 33 C 55 30, 58 27, 58 22 C 58 16, 54 12, 47 12 C 41 12, 37 16, 37 22 Z" fill="currentColor" />
      <circle cx="43" cy="58" r="3.6" fill={dotColor} />
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
            aria-label="Open Whitespace India CSR — opportunity index across 766 districts"
            style={{ ["--x" as string]: "50vw", ["--z" as string]: 4 } as React.CSSProperties}
          >
            <div className={`${styles.scene} ${styles.sceneCsr}`} />
            <div className={styles.corner}>
              <h2 className={styles.title}>CSR</h2>
              <div className={styles.meta}>Opportunity index · 766 districts</div>
            </div>
          </Link>
        </div>
      </div>
    </main>
  );
}
