"use client";

import { forwardRef, useCallback, useDeferredValue, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import Wordmark from "@/components/Wordmark";
import { filterLedger } from "@/lib/csr/ledger";
import type { District, Weights } from "@/lib/csr/score";
import styles from "./Ledger.module.css";

const COVER_EASE = [0.65, 0, 0.35, 1] as const;
const GROW_S = 0.45;
const SWING_S = 0.85;
const COVER_OPEN_DEG = -112;
const STAGGERED_ROWS = 24;
// Rows mounted behind the cover. All 651 in one commit stall the cover's first frames.
const ROWS_BEHIND_COVER = 40;

// The first cover is held long enough to read; after that it only opens.
let coverSeen = false;

type RankedDistrict = District & { computed_pos: number; rank: number };

/**
 * Whether the ledger is open, kept in the address as #ledger so the back button
 * closes it and the state can be linked. `from` is the button it grew out of;
 * null means it opens with no cover, as a direct link does.
 */
function useLedgerEntry() {
  const [entry, setEntry] = useState<{ from: DOMRect | null } | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const pushed = useRef(false);

  useEffect(() => {
    if (window.location.hash === "#ledger") setEntry({ from: null });
    const onPopState = () => {
      pushed.current = false;
      if (window.location.hash === "#ledger") {
        setEntry((open) => open ?? { from: null });
        return;
      }
      setEntry(null);
      opener.current?.focus();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const enter = useCallback((from: DOMRect) => {
    opener.current = document.activeElement as HTMLElement | null;
    window.history.pushState(null, "", "#ledger");
    pushed.current = true;
    setEntry({ from });
  }, []);

  const leave = useCallback(() => {
    setEntry(null);
    if (pushed.current) window.history.back();
    else window.history.replaceState(null, "", window.location.pathname);
    opener.current?.focus();
  }, []);

  /** Leaves for the weights panel. Replaces the entry, so back returns to the page and not to the panel's jump. */
  const leaveForWeights = useCallback(() => {
    setEntry(null);
    pushed.current = false;
    window.history.replaceState(null, "", "#simulator");
    document.getElementById("simulator")?.scrollIntoView();
  }, []);

  return { entry, enter, leave, leaveForWeights };
}

interface Contents {
  rows: RankedDistrict[];
  isLoading: boolean;
  sector: string;
  weights: Weights;
  fiscalWindow: string;
  onSelect: (district: District) => void;
}

interface Props extends Contents {
  from: DOMRect | null;
  onClosed: () => void;
  onChangeWeights: () => void;
}

export interface LedgerHandle {
  enter: (from: DOMRect) => void;
}

/**
 * Holds the open state here and not in the page: opening it through page state
 * re-rendered the whole index, map included, in the frame the cover should start.
 */
const LedgerHost = forwardRef<LedgerHandle, Contents>(function LedgerHost(contents, ref) {
  const { entry, enter, leave, leaveForWeights } = useLedgerEntry();
  useImperativeHandle(ref, () => ({ enter }), [enter]);
  if (!entry) return null;
  return <Ledger {...contents} from={entry.from} onClosed={leave} onChangeWeights={leaveForWeights} />;
});
export default LedgerHost;

function Ledger({
  from,
  rows,
  isLoading,
  sector,
  weights,
  fiscalWindow,
  onSelect,
  onClosed,
  onChangeWeights,
}: Props) {
  const reduceMotion = useReducedMotion();
  const animateCover = from !== null && !reduceMotion;
  const [phase, setPhase] = useState<"cover" | "open" | "closing">(animateCover ? "cover" : "open");
  const [query, setQuery] = useState("");
  const [whitespaceOnly, setWhitespaceOnly] = useState(false);
  const deferredQuery = useDeferredValue(query);
  const dialog = useRef<HTMLDivElement>(null);
  const [holdS] = useState(() => (coverSeen ? 0.15 : 0.5));

  useEffect(() => {
    coverSeen = true;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = overflow;
    };
  }, []);

  const visible = useMemo(
    () => filterLedger(rows, deferredQuery, whitespaceOnly),
    [rows, deferredQuery, whitespaceOnly],
  );
  const whitespaceCount = useMemo(() => rows.filter((row) => row.is_whitespace).length, [rows]);

  const close = () => {
    if (reduceMotion) onClosed();
    else setPhase("closing");
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (phase === "cover") {
      setPhase("open");
      if (e.key !== "Tab") e.preventDefault();
      return;
    }
    if (e.key === "Escape") {
      if (query) setQuery("");
      else close();
      return;
    }
    if (e.key === "Tab") keepTabInside(e, dialog.current);
  };

  const start = from
    ? `inset(${from.top}px ${window.innerWidth - from.right}px ${window.innerHeight - from.bottom}px ${from.left}px)`
    : "inset(0px 0px 0px 0px)";
  const fullCover = "inset(0px 0px 0px 0px)";

  const pageStyle = {
    "--enter-base": phase === "cover" ? `${GROW_S + holdS + 0.35}s` : "0s",
  } as React.CSSProperties;

  return (
    <div
      ref={dialog}
      className={styles.ledger}
      role="dialog"
      aria-modal="true"
      aria-label="The district ledger"
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <div
        className={`${styles.page} ${animateCover ? styles.pageEntering : ""}`}
        style={pageStyle}
      >
        <header className={styles.band}>
          <div className={styles.bandBrand}>
            <Wordmark />
            <span className={styles.bandName}>The ledger</span>
          </div>
          <button type="button" className={styles.closeButton} onClick={close}>
            Close the ledger
            <span aria-hidden="true"> ×</span>
          </button>
        </header>

        <div className={styles.controls}>
          <p className={styles.summary}>
            <strong>{rows.length}</strong> districts, ranked.{" "}
            <strong>{whitespaceCount}</strong> stamped whitespace: in the poorest quarter of districts
            and the bottom quarter for CSR money per person.
          </p>
          <div className={styles.filters}>
            <label className={styles.search}>
              <span className={styles.visuallyHidden}>Find a district or state</span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find a district or state"
                autoComplete="off"
              />
            </label>
            <button
              type="button"
              aria-pressed={whitespaceOnly}
              className={`${styles.stampToggle} ${whitespaceOnly ? styles.stampToggleOn : ""}`}
              onClick={() => setWhitespaceOnly((on) => !on)}
            >
              Whitespace only
            </button>
          </div>
        </div>

        <div className={styles.sheet}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col" className={styles.rankCell}>No.</th>
                <th scope="col" className={styles.nameHead}>District</th>
                <th scope="col" className={styles.stateCell}>State</th>
                <th scope="col" className={styles.figure}>Poor<small>2019-21</small></th>
                <th scope="col" className={styles.figure}>CSR per person<small>{fiscalWindow}</small></th>
                <th scope="col" className={styles.figure}>Score</th>
              </tr>
            </thead>
            <tbody>
              {(phase === "cover" ? visible.slice(0, ROWS_BEHIND_COVER) : visible).map((district, i) => (
                <tr
                  key={district.district_lgd_code}
                  className={i < STAGGERED_ROWS ? styles.rowEntering : undefined}
                  style={i < STAGGERED_ROWS ? ({ "--i": i } as React.CSSProperties) : undefined}
                  onClick={() => onSelect(district)}
                >
                  <td className={styles.rankCell}>{String(district.rank).padStart(3, "0")}</td>
                  <td className={styles.nameCell}>
                    <button
                      type="button"
                      className={styles.nameButton}
                      aria-label={`Open the research brief for ${district.district_name}, ${district.state_name}`}
                    >
                      {district.district_name}
                    </button>
                    {district.is_whitespace ? <span className={styles.stamp}>Whitespace</span> : null}
                    <span className={styles.stateInline}>{district.state_name}</span>
                  </td>
                  <td className={styles.stateCell}>{district.state_name}</td>
                  <td className={styles.figure}>{(district.headcount_ratio_2021 * 100).toFixed(1)}%</td>
                  <td className={styles.figure}>₹{Math.round(district.district_csr_per_person).toLocaleString("en-IN")}</td>
                  <td className={`${styles.figure} ${styles.score}`}>{district.computed_pos.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {visible.length === 0 ? (
            <p className={styles.empty}>
              {isLoading ? "Opening the ledger…" : "No entry matches. Clearing the search brings every district back."}
            </p>
          ) : null}
          <footer className={styles.colophon}>
            <p>
              Scored at poverty {Math.round(weights.w_N * 100)}%, funding gap {Math.round(weights.w_G * 100)}%,
              persistence {Math.round(weights.w_U * 100)}%, {sector === "All Sectors" ? "all sectors" : sector}.{" "}
              <button type="button" className={styles.textButton} onClick={onChangeWeights}>
                Change the weights
              </button>
            </p>
            <p>
              Spending is counted across all sectors over {fiscalWindow}, and poverty is for 2019-21. A
              district&apos;s figure is a floor, since most CSR money names no district. Source: NITI Aayog MPI 2023; Ministry of Corporate Affairs CSR filings via Dataful.in; Census 2011.
            </p>
          </footer>
        </div>
      </div>

      {phase !== "open" ? (
        <div className={styles.stage} onClick={() => phase === "cover" && setPhase("open")} aria-hidden="true">
          <motion.div
            className={styles.shade}
            initial={{ opacity: phase === "closing" ? 0 : 1 }}
            animate={{ opacity: phase === "closing" ? 1 : 0 }}
            transition={
              phase === "closing"
                ? { duration: 0.4 }
                : { delay: GROW_S + holdS + 0.1, duration: SWING_S }
            }
          />
          {phase === "cover" ? (
            <motion.div
              className={styles.cover}
              style={{ transformOrigin: "0% 50%" }}
              initial={{ clipPath: start, rotateY: 0 }}
              animate={{ clipPath: fullCover, rotateY: COVER_OPEN_DEG }}
              transition={{
                clipPath: { duration: GROW_S, ease: [0.76, 0, 0.24, 1] },
                rotateY: { delay: GROW_S + holdS, duration: SWING_S, ease: COVER_EASE },
              }}
              onAnimationComplete={() => setPhase("open")}
            >
              <CoverFace count={rows.length} fiscalWindow={fiscalWindow} />
            </motion.div>
          ) : (
            <motion.div
              className={styles.cover}
              style={{ transformOrigin: "0% 50%" }}
              initial={{ rotateY: COVER_OPEN_DEG }}
              animate={{ rotateY: 0 }}
              transition={{ duration: 0.42, ease: COVER_EASE }}
              onAnimationComplete={onClosed}
            >
              <CoverFace count={rows.length} fiscalWindow={fiscalWindow} />
            </motion.div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function CoverFace({ count, fiscalWindow }: { count: number; fiscalWindow: string }) {
  return (
    <>
      <span className={styles.spine} />
      <span className={`${styles.corner} ${styles.cornerTop}`} />
      <span className={`${styles.corner} ${styles.cornerBottom}`} />
      <div className={styles.plate}>
        <Wordmark />
        <span className={styles.plateTitle}>The Ledger</span>
        <span className={styles.plateLine}>
          {count > 0 ? `${count} districts` : "Every district"} · CSR against poverty
        </span>
        <span className={styles.plateLine}>{fiscalWindow}</span>
      </div>
    </>
  );
}

function keepTabInside(e: React.KeyboardEvent, container: HTMLElement | null) {
  if (!container) return;
  const focusable = container.querySelectorAll<HTMLElement>("button, input");
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) return;
  if (e.shiftKey && (document.activeElement === first || document.activeElement === container)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}
