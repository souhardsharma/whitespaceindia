"use client";

/**
 * The flags of the last nights, filtered in the browser.
 *
 * The page arrives with its first rows already drawn. The whole list is a
 * static file, fetched only when a reader filters or asks for more, so a
 * visit that only reads the top costs one page and nothing else.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { KindTag, SMALL_LABEL } from "@/components/instruments/meal/parts";
import {
  FLAG_KINDS, MEAL_DATA, TEAL, count, dayShort, districtPath, flagSentence, schoolPath,
  type FlagKind, type Recent, type RecentRow,
} from "@/lib/instruments/meal";

const PAGE = 60;
const SELECT = "font-body text-[13.5px] bg-transparent border border-[#1c1c19]/50 px-3 py-2 min-h-[44px]";

export default function LatestList({
  initial, total, stamps, states,
}: {
  initial: RecentRow[];
  total: number;
  stamps: string[];
  /** State code to name, in the order the filter lists them. */
  states: [string, string][];
}) {
  const [rows, setRows] = useState(initial);
  const [whole, setWhole] = useState(initial.length >= total);
  const [failed, setFailed] = useState(false);
  const [kind, setKind] = useState<FlagKind | "">("");
  const [st, setSt] = useState("");
  const [shown, setShown] = useState(PAGE);
  const names = useMemo(() => new Map(states), [states]);

  /** Filtering the first rows alone would call a partial list complete. */
  async function loadAll(): Promise<void> {
    if (whole) return;
    try {
      const res = await fetch(`${MEAL_DATA}/flags/recent.json`);
      if (!res.ok) throw new Error(String(res.status));
      setRows(((await res.json()) as Recent).rows);
      setWhole(true);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }

  const matching = rows.filter((r) => (!kind || r.kind === kind) && (!st || r.st === st));
  const filtered = Boolean(kind || st);
  const known = whole ? matching.length : total;

  return (
    <div>
      <div className="flex flex-wrap items-end gap-4 mb-6">
        <label className="block">
          <span className={`${SMALL_LABEL} block mb-1.5`}>Kind of flag</span>
          <select
            className={SELECT}
            value={kind}
            onChange={(e) => { setKind(e.target.value as FlagKind | ""); setShown(PAGE); void loadAll(); }}
          >
            <option value="">All kinds</option>
            {(Object.keys(FLAG_KINDS) as FlagKind[]).map((k) => (
              <option key={k} value={k}>{FLAG_KINDS[k].label}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={`${SMALL_LABEL} block mb-1.5`}>State or Union Territory</span>
          <select
            className={SELECT}
            value={st}
            onChange={(e) => { setSt(e.target.value); setShown(PAGE); void loadAll(); }}
          >
            <option value="">All States</option>
            {states.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
        </label>
        <p className="font-body text-[13px] opacity-75 pb-2.5" role="status">
          {filtered && !whole && !failed
            ? "Reading the full list…"
            : `${count(known)} ${known === 1 ? "flag" : "flags"}${filtered ? " match" : ""}`}
        </p>
      </div>

      {failed ? (
        <p className="font-body text-[14px] mb-6" role="alert">
          The full list could not be read just now, so only the first rows
          are shown and the filters cannot be trusted.{" "}
          <button type="button" className="underline underline-offset-4" onClick={() => void loadAll()}>
            Ask again
          </button>
        </p>
      ) : null}

      {matching.length ? (
        <ul className="border-t border-[#1c1c19]">
          {matching.slice(0, shown).map((r) => (
            <li key={`${r.k}-${r.day}-${r.kind}`} className="py-4 border-b border-[#1c1c19]/15 grid grid-cols-1 md:grid-cols-12 gap-x-6 gap-y-1.5">
              <div className="md:col-span-4 font-body text-[14.5px] leading-snug">
                <Link href={schoolPath(r.k)} prefetch={false} className="underline underline-offset-4 decoration-[#1c1c19]/30 hover:decoration-[#1c1c19]">
                  {r.name}
                </Link>
                <span className="block font-body text-[12px] opacity-70 mt-0.5">
                  <Link href={districtPath(r.st, r.dc)} prefetch={false} className="hover:underline underline-offset-4">
                    {r.district}
                  </Link>
                  , {names.get(r.st)}
                </span>
              </div>
              <div className="md:col-span-2">
                <span className="block font-label text-[12px] tabular-nums">{dayShort(r.day)}</span>
                <span className="block mt-1.5"><KindTag kind={r.kind} wide={r.wide} /></span>
              </div>
              <div className="md:col-span-6">
                <p className="font-body text-[13.5px] leading-relaxed">{flagSentence(r)}</p>
                <p className={`${SMALL_LABEL} mt-1.5`}>first seen {dayShort(stamps[r.seen] ?? r.first)}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="font-body text-[14px] opacity-80 border-t border-[#1c1c19] pt-6">
          {filtered && !whole
            ? "Reading the full list…"
            : "No flag from recent nights matches. School tables are read as a sample, so schools outside it are not covered."}
        </p>
      )}

      {(whole ? matching.length : total) > shown ? (
        <button
          type="button"
          className="tap-target mt-8 font-label text-[11px] uppercase tracking-[0.18em] border px-4 py-2.5"
          style={{ borderColor: TEAL }}
          onClick={() => { setShown(shown + PAGE); void loadAll(); }}
        >
          Show {PAGE} more
        </button>
      ) : null}
    </div>
  );
}
