"use client";

/**
 * The proposal list on a district page.
 *
 * WHY THIS IS A CLIENT COMPONENT AT ALL.
 * Jodhpur holds 5,042 proposals. Server-rendering every one produced a 10.4 MB
 * HTML document, which is not a page anyone can use. The obvious fix - cap the
 * list - was tried and rejected: it hid 28,475 proposals across 62 districts,
 * a third of the resolved register, from the very view built to show them.
 *
 * So neither. The server renders the first page, which is what almost every
 * visitor reads, and the rest are fetched on demand from the national search
 * endpoint, a page at a time. It used to download every whole state shard
 * holding the district - 10 MB for a Rajasthan district - to show the next
 * hundred rows. Nothing is truncated, and the initial document stays small.
 */

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { PLUM } from "./InstrumentChrome";

const nf = new Intl.NumberFormat("en-IN");
const PAGE = 100;

export interface DistrictProposal {
  id: string;
  no: string;
  name: string;
  agency: string;
  sector: string;
  cat: string | null;
  status: string;
  date: string;
  af: number | null;
  df: number | null;
  rnr: string | null;
  /** First step in the appraisal history, ISO date. */
  fon?: string | null;
  /**
   * Census code of the district this project is PRIMARILY sited in.
   *
   * A district page lists every proposal that names it, including projects
   * sited mainly elsewhere; their declared displacement is counted against
   * that other district, because one project declares one national figure and
   * counting it everywhere reported 29,391 families displaced in Birbhum
   * against an actual 225. The page needs this to say so rather than print
   * "none declared" above a list that plainly declares some.
   */
  dc?: number | null;
  state: string;
}

export default function DistrictProposals({
  initial,
  total,
  districtCode,
  stateSlugs,
}: {
  initial: DistrictProposal[];
  total: number;
  districtCode: number;
  /** Every shard holding proposals for this district. Usually one, not always. */
  stateSlugs: string[];
}) {
  const [rows, setRows] = useState<DistrictProposal[]>(initial);
  const [shown, setShown] = useState(initial.length);
  const [loadingAll, setLoadingAll] = useState(false);
  const [error, setError] = useState("");
  const haveAll = rows.length >= total;
  // Rows read from the search endpoint so far, in ITS order. The first click
  // replaces the server-rendered page with these (the two could order
  // same-date proposals differently); every later click continues from where
  // they end, instead of re-reading from the start - which grew the requests
  // quadratically and ran a large district into the rate limit.
  const fetched = useRef<DistrictProposal[] | null>(null);

  const loadAll = useCallback(async (everything = false) => {
    const target = everything ? total : Math.min(total, shown + PAGE * 4);
    if (haveAll || rows.length >= target) {
      setShown(target);
      return;
    }
    setLoadingAll(true);
    setError("");
    try {
      // From the national search endpoint, filtered to this district - every
      // proposal that NAMES it, from every shard, as the count above does.
      // The first click replaces the server-rendered page with the endpoint's
      // own rows from offset 0 (the two could order same-date proposals
      // differently, so appending one to the other could duplicate or skip);
      // every later click continues from where the endpoint's rows end.
      const got: DistrictProposal[] = fetched.current ?? [];
      const seen = new Set(got.map((r) => r.id));
      while (got.length < target) {
        const res = await fetch(
          `/api/instruments/consent/search?district=${districtCode}` +
            `&offset=${got.length}&limit=200`,
        );
        if (!res.ok) throw new Error(`search returned ${res.status}`);
        const page = (await res.json()) as {
          items: {
            id: string; no: string; name: string; agency: string; sector: string;
            category: string | null; status: string; date: string;
            district: number | null; stateSlug: string;
            declared: { affectedFamilies: number | null; displacedFamilies: number | null;
                        rnrInvolved: string | null };
          }[];
        };
        if (page.items.length === 0) break;
        const before = got.length;
        for (const r of page.items) {
          if (seen.has(r.id)) continue;
          seen.add(r.id);
          got.push({
            id: r.id, no: r.no, name: r.name, agency: r.agency, sector: r.sector,
            cat: r.category, status: r.status, date: r.date,
            af: r.declared.affectedFamilies, df: r.declared.displacedFamilies,
            rnr: r.declared.rnrInvolved, dc: r.district, state: r.stateSlug,
          });
        }
        // A page of nothing new would otherwise ask for the same offset for ever.
        if (got.length === before) break;
      }
      fetched.current = got;
      setRows([...got]);
      setShown(Math.min(got.length, target));
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not load the rest");
    } finally {
      setLoadingAll(false);
    }
  }, [haveAll, total, shown, rows.length, districtCode]);

  return (
    <>
      <ol className="border-t border-[#1c1c19]/25">
        {rows.slice(0, shown).map((p) => (
          <li key={p.id + p.no} className="border-b border-[#1c1c19]/12">
            <Link prefetch={false}
              href={`/instruments/consent/${encodeURIComponent(p.id)}?state=${p.state}`}
              className="group block py-4 hover:bg-[#1c1c19]/[0.02] transition-colors"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-1">
                <span
                  className="font-label text-[9px] uppercase tracking-[0.14em] px-1.5 py-0.5"
                  style={{ background: PLUM, color: "#fcf9f4" }}
                >
                  {p.cat ? `Category ${p.cat}` : "No category"}
                </span>
                <span className="font-label text-[10px] uppercase tracking-[0.13em] opacity-70">
                  {p.status}
                </span>
                <span className="font-label text-[10px] tracking-[0.08em] opacity-65">
                  {p.date}
                </span>
                {(p.df ?? 0) > 0 || (p.af ?? 0) > 0 || p.rnr === "YES" ? (
                  <span
                    className="font-label text-[9px] uppercase tracking-[0.14em]"
                    style={{ color: PLUM }}
                  >
                    declares affected families
                  </span>
                ) : null}
              </div>
              <p className="font-headline text-[16px] leading-snug group-hover:underline decoration-1 underline-offset-2">
                {p.name}
              </p>
              <p className="font-body text-[12.5px] opacity-75 mt-0.5">
                {p.agency || "Applicant not recorded"} · {p.sector}
              </p>
            </Link>
          </li>
        ))}
      </ol>

      <div className="mt-5 flex flex-wrap items-center gap-4">
        {shown < total ? (
          <>
            <button
              type="button"
              onClick={() => loadAll(false)}
              disabled={loadingAll}
              className="px-5 py-2.5 border border-[#1c1c19] font-label text-[11px] uppercase tracking-[0.18em] hover:bg-[#1c1c19] hover:text-[#fcf9f4] transition-colors disabled:opacity-65"
            >
              {loadingAll
                ? "Loading…"
                : `Show more (${nf.format(total - shown)} remaining)`}
            </button>
            <button
              type="button"
              onClick={() => loadAll(true)}
              disabled={loadingAll}
              // py-2.5 rather than a bare text button: at 17px tall this was
              // under half the 44px minimum touch target on a phone.
              className="px-1 py-2.5 font-label text-[11px] uppercase tracking-[0.16em] underline decoration-1 underline-offset-4 opacity-65 hover:opacity-100 disabled:opacity-30"
            >
              Show all {nf.format(total)}
            </button>
          </>
        ) : null}
        <p
          className="font-body text-[13px] opacity-75"
          // "Show more" appends rows below without moving focus, so a screen
          // reader had no way to know the button had done anything. This
          // sentence already states the new count; making it a live region
          // means pressing the button is heard as well as seen.
          role="status"
          aria-live="polite"
        >
          {shown >= total
            ? `All ${nf.format(total)} proposals that name this district, newest first.`
            : `Showing ${nf.format(shown)} of ${nf.format(total)} proposals, newest first. The button below loads the rest.`}
        </p>
      </div>

      {error ? (
        <p className="mt-2 font-body text-[13px] opacity-70">
          These proposals could not be loaded, although the register does
          hold them. Reloading the page usually fixes this.
        </p>
      ) : null}
    </>
  );
}
