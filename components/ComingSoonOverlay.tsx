"use client";

import { useEffect, useRef, useCallback, type ReactNode } from "react";
import styles from "./ComingSoonOverlay.module.css";

interface ComingSoonOverlayProps {
  active: boolean;
  verticalName: string;
  accentColor: string;
  children: ReactNode;
}

export default function ComingSoonOverlay({
  active,
  verticalName,
  accentColor,
  children,
}: ComingSoonOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (active && contentRef.current) {
      contentRef.current.setAttribute("inert", "");
    } else if (!active && contentRef.current) {
      contentRef.current.removeAttribute("inert");
    }
  }, [active]);

  const restoreOverlay = useCallback(() => {
    if (!active || !wrapperRef.current || !overlayRef.current) return;
    if (!wrapperRef.current.contains(overlayRef.current)) {
      wrapperRef.current.appendChild(overlayRef.current);
    }
  }, [active]);

  useEffect(() => {
    if (!active || !wrapperRef.current) return;

    const observer = new MutationObserver(() => {
      requestAnimationFrame(restoreOverlay);
    });

    observer.observe(wrapperRef.current, { childList: true, subtree: false });

    return () => observer.disconnect();
  }, [active, restoreOverlay]);

  useEffect(() => {
    if (!active) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Tab") e.preventDefault();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [active]);

  if (!active) {
    return <>{children}</>;
  }

  return (
    <div ref={wrapperRef} className={styles.wrapper}>
      <div ref={contentRef} className={styles.contentLayer}>
        {children}
      </div>

      <div ref={overlayRef} className={styles.overlay}>
        <div className={styles.overlayInner}>
          <span className={styles.badge}>Coming Soon</span>
          <h1 className={styles.title}>
            Whitespace India{" "}
            <span className={styles.titleAccent} style={{ color: accentColor }}>
              {verticalName}
            </span>
          </h1>
          <p className={styles.subtitle}>
            We are building this research vertical. The same methodology,
            applied to {verticalName.toLowerCase()} data across Indian
            districts. Stay tuned.
          </p>
          <a href="/" className={styles.backLink}>
            &larr; Back to Home
          </a>
          <div className={styles.brandLine}>Whitespace India</div>
        </div>
      </div>
    </div>
  );
}
