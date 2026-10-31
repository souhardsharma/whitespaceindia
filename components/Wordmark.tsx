import type { ElementType } from "react";
import styles from "./Wordmark.module.css";

/** The {?} brace mark. Its strokes follow currentColor; public/logo.svg is the same drawing. */
export function BraceMark() {
  return (
    <svg viewBox="32 28 176 184" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M 78 40 C 58 40 56 58 56 76 C 56 98 56 104 44 116 C 44 120 44 120 44 124 C 56 136 56 142 56 164 C 56 182 58 200 78 200" stroke="currentColor" strokeWidth="22" />
      <path d="M 162 40 C 182 40 184 58 184 76 C 184 98 184 104 196 116 C 196 120 196 120 196 124 C 184 136 184 142 184 164 C 184 182 182 200 162 200" stroke="currentColor" strokeWidth="22" />
      <path d="M 98 88 C 98 72 108 62 120 62 C 134 62 144 74 144 88 C 144 104 134 110 126 118 C 120 124 120 130 120 138 L 120 146" stroke="currentColor" strokeWidth="32" />
      <circle cx="120" cy="180" r="18" fill="#9b2817" />
    </svg>
  );
}

/**
 * The one drawing of the brand: brace mark, White-space, a slash, INDIA.
 * Everything is sized in em, so a parent's font-size is the only size control.
 * `as` is for the landing page, whose h1 is the wordmark.
 *
 * The slash is drawn by CSS around a real space, so the text a crawler or a
 * screen reader gets is "Whitespace India" and never "Whitespace/India".
 */
export default function Wordmark({ as: Word = "span" }: { as?: ElementType }) {
  return (
    <span className={styles.wordmark}>
      <span className={styles.mark}>
        <BraceMark />
      </span>
      <Word className={styles.word}>
        <span>White</span>
        <span className={styles.space}>space</span>
        <span className={styles.slash}> </span>
        <span className={styles.india}>India</span>
      </Word>
    </span>
  );
}
