"use client";

/**
 * Every school read in one district, with a filter on the name.
 *
 * The list is one static file per district, fetched when the page opens. A
 * school's figures are those of the latest table read for its cluster, and
 * clusters are read on different nights, so each row carries its own date.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { SMALL_LABEL, TD, TH } from "@/components/instruments/meal/parts";
import { count, dayShort, rosterPath, schoolPath, type RosterFile } from "@/lib/instruments/meal";

const PAGE = 100;

export default function Roster({
  st, dc, total, flagged, enrolledLabel, mealsLabel,
}: {
  st: string;
  dc: string;
  /** Schools the district's page says were read: the file must hold as many. */
  total: number;
  /** Keys of the schools that have a page of their own. */
  flagged: string[];
  enrolledLabel: string;
  mealsLabel: string;
}) {
  const [file, setFile] = useState<RosterFile | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);
  const linked = useMemo(() => new Set(flagged), [flagged]);

  useEffect(() => {
    let live = true;
    fetch(rosterPath(st, dc))
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((doc: RosterFile) => { if (live) setFile(doc); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [st, dc]);

  if (failed) {
    return (
      <p className="font-body text-[14px] leading-relaxed opacity-80" role="status">
        The list of {count(total)} schools did not load. Reload the page to try again.
      </p>
    );
  }
  if (!file) {
    return <p className={`${SMALL_LABEL}`} role="status">Loading {count(total)} schools</p>;
  }

  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matching = words.length
    ? file.schools.filter(([, name]) => words.every((w) => name.toLowerCase().includes(w)))
    : file.schools;
  const rows = matching.slice(0, shown);

  return (
    <div>
      <label className="block max-w-md mb-4">
        <span className={`${SMALL_LABEL} block mb-1.5`}>Find a school by name</span>
        <input
          type="search"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setShown(PAGE); }}
          className="w-full font-body text-[14px] bg-transparent border border-[#1c1c19]/50 px-3 py-2 min-h-[44px]"
        />
      </label>
      <p className="font-body text-[13px] opacity-75 mb-3" role="status">
        {words.length
          ? `${count(matching.length)} of ${count(file.schools.length)} schools match.`
          : `${count(file.schools.length)} schools.`}
        {rows.length < matching.length ? ` The first ${count(rows.length)} are shown.` : ""}
      </p>
      {rows.length ? (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse">
            <thead>
              <tr className="border-b border-[#1c1c19]">
                <th className={TH}>School</th>
                <th className={TH}>Cluster, block</th>
                <th className={`${TH} text-right`}>{enrolledLabel}</th>
                <th className={`${TH} text-right`}>{mealsLabel}</th>
                <th className={TH}>Read for</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([k, name, cc, enrolled, meals]) => {
                const cluster = file.clusters[cc];
                return (
                  <tr key={k} className="border-b border-[#1c1c19]/15">
                    <td className={TD}>
                      {linked.has(k) ? (
                        <Link href={schoolPath(k)} prefetch={false} className="underline underline-offset-4 decoration-[#1c1c19]/30 hover:decoration-[#1c1c19]">
                          {name}
                        </Link>
                      ) : name}
                    </td>
                    <td className={TD}>{cluster.name}, {cluster.block}</td>
                    <td className={`${TD} text-right`}>{enrolled == null ? "not filed" : count(enrolled)}</td>
                    <td className={`${TD} text-right`}>{meals == null ? "no report" : count(meals)}</td>
                    <td className={TD}>{dayShort(cluster.day)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {rows.length < matching.length ? (
        <button
          type="button"
          onClick={() => setShown((n) => n + PAGE)}
          className="tap-target mt-5 font-label text-[10px] uppercase tracking-[0.16em] border border-[#1c1c19]/60 px-4"
        >
          Show {count(Math.min(PAGE, matching.length - rows.length))} more
        </button>
      ) : null}
    </div>
  );
}
