"use client";

/**
 * The register explorer: the queries PARIVESH structurally cannot answer.
 *
 * PARIVESH's search exposes `state` and nothing finer, so below state level the
 * register is unqueryable. You can look up a proposal you already know the
 * number of; you cannot ask which proposals sit in a district, which sit in a
 * Fifth Schedule Scheduled Area, or which sit where most of the population is
 * Scheduled Tribe. Those are not slow questions on the source - the fields do
 * not exist there.
 *
 * This view enters the register from the other end. Every filter here is a join
 * PARIVESH does not offer: district (resolved from the filed CAF), Scheduled
 * Area status (from the curated Presidential Orders), and population
 * composition (from Census 2011).
 */

import ScrollRegion from "./ScrollRegion";
import { titleCase } from "@/lib/instruments/place";
import { useMemo, useState } from "react";
import Link from "next/link";
import { PLUM } from "./InstrumentChrome";

const nf = new Intl.NumberFormat("en-IN");

export interface DistrictRow {
  code: number;
  district: string;
  state: string;
  n: number;
  nA: number;
  sa: "within" | "partial" | "outside" | "not_determined" | "unknown";
  declaringLand: number;
  displaced: number;
  affected: number;
  pop: number | null;
  st: number | null;
  sc: number | null;
  landDep: number | null;
  lit: number | null;
}

type SortKey = "n" | "nA" | "st" | "landDep" | "displaced" | "pop" | "district";

// A determination and the absence of one must never read alike. "Outside" is
// an answer - no Presidential Order reaches this district - and 469 of the 640
// districts now carry it. Rendering that as "Not determined", which is what
// this table did while `outside` was not even in the type, told the reader the
// instrument did not know, about the majority of the country, when it did.
const SA_LABEL: Record<DistrictRow["sa"], string> = {
  within: "Wholly scheduled",
  partial: "Partly scheduled",
  outside: "Not scheduled by any Order",
  not_determined: "Not determined",
  unknown: "Not determined",
};

export default function RegisterExplorer({
  rows,
  registerTotal,
}: {
  rows: DistrictRow[];
  /**
   * How many proposals the register actually holds.
   *
   * Needed because the totals above sum per-district counts, which counts a
   * multi-district proposal once per district. Stating the real total beside
   * them is what keeps the two figures from reading as a contradiction.
   */
  registerTotal: number;
}) {
  const [state, setState] = useState("");
  const [sa, setSa] = useState("");
  const [minST, setMinST] = useState(0);
  const [minLandDep, setMinLandDep] = useState(0);
  const [displacementOnly, setDisplacementOnly] = useState(false);
  const [categoryAOnly, setCategoryAOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("n");
  const [shown, setShown] = useState(40);

  const states = useMemo(() => {
    const seen: Record<string, true> = {};
    for (const r of rows) seen[r.state] = true;
    return Object.keys(seen).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const out = rows.filter((r) => {
      if (r.n === 0) return false;
      if (state && r.state !== state) return false;
      if (sa === "scheduled" && !(r.sa === "within" || r.sa === "partial")) return false;
      if (sa === "within" && r.sa !== "within") return false;
      // Selected by NAME, not by exclusion. Choosing by "not within and not
      // partial" returned every `outside` district too - about 557 of 640
      // instead of 42 - each one captioned "Outside — no Order reaches it" in
      // the column beside it. The filter and the label contradicted each other
      // on the same screen, and the one use this control has is finding where
      // the instrument genuinely does not know.
      if (sa === "undetermined"
          && !(r.sa === "not_determined" || r.sa === "unknown")) return false;
      if (sa === "outside" && r.sa !== "outside") return false;
      if (minST > 0 && (r.st ?? 0) < minST) return false;
      if (minLandDep > 0 && (r.landDep ?? 0) < minLandDep) return false;
      if (displacementOnly && r.displaced + r.affected === 0) return false;
      if (categoryAOnly && r.nA === 0) return false;
      return true;
    });
    out.sort((a, b) => {
      if (sort === "district") return a.district.localeCompare(b.district);
      return (Number(b[sort] ?? 0) - Number(a[sort] ?? 0));
    });
    return out;
  }, [rows, state, sa, minST, minLandDep, displacementOnly, categoryAOnly, sort]);

  const totals = useMemo(
    () => ({
      districts: filtered.length,
      proposals: filtered.reduce((s, r) => s + r.n, 0),
      catA: filtered.reduce((s, r) => s + r.nA, 0),
      displaced: filtered.reduce((s, r) => s + r.displaced, 0),
    }),
    [filtered]
  );

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 mb-6">
        <label className="md:col-span-3 block">
          <Lbl>State</Lbl>
          <select
            value={state}
            onChange={(e) => { setState(e.target.value); setShown(40); }}
            className="w-full bg-[#fcf9f4] border border-[#1c1c19] px-3 py-2.5 font-body text-[14px]"
          >
            <option value="">All states</option>
            {states.map((s) => (
              <option key={s} value={s}>{titleCase(s)}</option>
            ))}
          </select>
        </label>

        <label className="md:col-span-3 block">
          <Lbl>Scheduled Area status</Lbl>
          <select
            value={sa}
            onChange={(e) => { setSa(e.target.value); setShown(40); }}
            className="w-full bg-[#fcf9f4] border border-[#1c1c19] px-3 py-2.5 font-body text-[14px]"
          >
            <option value="">Any status</option>
            <option value="scheduled">In a Scheduled Area (wholly or partly)</option>
            <option value="within">Wholly scheduled only</option>
            <option value="outside">Not scheduled by any Order</option>
            <option value="undetermined">Not determined</option>
          </select>
        </label>

        <label className="md:col-span-3 block">
          <Lbl>Minimum Scheduled Tribe share</Lbl>
          <select
            value={minST}
            onChange={(e) => { setMinST(Number(e.target.value)); setShown(40); }}
            className="w-full bg-[#fcf9f4] border border-[#1c1c19] px-3 py-2.5 font-body text-[14px]"
          >
            {[0, 10, 25, 50, 75].map((v) => (
              <option key={v} value={v}>{v === 0 ? "Any" : `${v}%`}</option>
            ))}
          </select>
        </label>

        <label className="md:col-span-3 block">
          <Lbl>Minimum share of workers on the land</Lbl>
          <select
            value={minLandDep}
            onChange={(e) => { setMinLandDep(Number(e.target.value)); setShown(40); }}
            className="w-full bg-[#fcf9f4] border border-[#1c1c19] px-3 py-2.5 font-body text-[14px]"
          >
            {[0, 40, 60, 75].map((v) => (
              <option key={v} value={v}>{v === 0 ? "Any" : `${v}%`}</option>
            ))}
          </select>
        </label>

        <fieldset className="md:col-span-6 flex flex-wrap gap-x-6 gap-y-2 items-center">
          <legend className="sr-only">Additional filters</legend>
          <label className="flex items-center gap-2 font-body text-[13px] cursor-pointer">
            <input type="checkbox" checked={displacementOnly}
              onChange={(e) => { setDisplacementOnly(e.target.checked); setShown(40); }}
              className="accent-[#7a3b6b]" />
            Only where families are declared displaced or affected
          </label>
          <label className="flex items-center gap-2 font-body text-[13px] cursor-pointer">
            <input type="checkbox" checked={categoryAOnly}
              onChange={(e) => { setCategoryAOnly(e.target.checked); setShown(40); }}
              className="accent-[#7a3b6b]" />
            Only with Category A proposals
          </label>
        </fieldset>

        <label className="md:col-span-6 md:justify-self-end block md:w-64">
          <Lbl>Sort by</Lbl>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="w-full bg-[#fcf9f4] border border-[#1c1c19] px-3 py-2.5 font-body text-[14px]"
          >
            <option value="n">Most proposals</option>
            <option value="nA">Most Category A proposals</option>
            <option value="st">Highest Scheduled Tribe share</option>
            <option value="landDep">Most dependent on land</option>
            <option value="displaced">Most families declared displaced</option>
            <option value="pop">Largest population</option>
            <option value="district">District name</option>
          </select>
        </label>
      </div>

      <div className="flex flex-wrap gap-x-8 gap-y-2 py-3 mb-1 border-y border-[#1c1c19]">
        <Total label="Districts" value={nf.format(totals.districts)} />
        {/* NOT "Proposals". This sums each district's count, and a proposal
            naming several districts is counted in every one of them - so the
            figure is 91,988 against the 89,817 proposals the register actually
            holds. Both numbers appear on this instrument, and under the label
            "Proposals" a reader had no way to tell which they were looking at
            or why the two disagreed. */}
        <Total
          label="District listings"
          value={nf.format(totals.proposals)}
        />
        <Total label="Category A listings" value={nf.format(totals.catA)} />
        <Total label="Families declared displaced" value={nf.format(totals.displaced)} />
      </div>
      <p className="font-body text-[11.5px] leading-snug opacity-75 mb-3 max-w-3xl">
        A proposal that names more than one district is listed in each of them,
        so these listings total more than the{" "}
        {nf.format(registerTotal)} proposals the register holds. Families
        declared displaced are counted once, in the district each project is
        primarily sited in.
      </p>

      {/* WHAT CHANGED, spoken.
          Changing a filter rewrites the table underneath without moving focus
          or navigating, so a screen-reader user got no indication that
          anything had happened at all - the control they just operated
          reported nothing, and the result was 600 rows away. A polite live
          region says what the filter did. It is visually hidden because the
          totals above already say it on screen. */}
      <p className="sr-only" role="status" aria-live="polite">
        {filtered.length === 0
          ? "No district matches those filters."
          : `${nf.format(filtered.length)} districts match, with ${nf.format(
              totals.proposals,
            )} district listings between them.`}
      </p>

      {filtered.length === 0 ? (
        <p className="py-12 text-center font-body text-[14px] opacity-65">
          No district matches those filters. You can widen them to see more.
        </p>
      ) : (
        <>
          <ScrollRegion label="Districts in the register">
            <table className="w-full border-collapse text-left">
              {/* A table with no name is announced as "table" and nothing
                  else, which in a list of landmarks is indistinguishable from
                  any other. The caption is visually hidden because the
                  heading above already says this on screen. */}
              <caption className="sr-only">
                Districts named in the register that match the filters above,
                with each one&apos;s proposal count, Scheduled Area status and
                Census indicators. Showing{" "}
                {nf.format(Math.min(shown, filtered.length))} of{" "}
                {nf.format(filtered.length)} districts.
              </caption>
              <thead>
                <tr className="border-b border-[#1c1c19]">
                  <Th>District</Th>
                  <Th right>Proposals</Th>
                  <Th right>Category A</Th>
                  <Th>Scheduled Area</Th>
                  <Th right>Scheduled Tribe</Th>
                  <Th right>Workers on land</Th>
                  <Th right>Families displaced</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, shown).map((r) => (
                  <tr key={r.code} className="border-b border-[#1c1c19]/12 hover:bg-[#1c1c19]/[0.025]">
                    <td className="py-2.5 pr-4">
                      <Link prefetch={false}
                        href={`/instruments/consent/district/${r.code}`}
                        className="font-body text-[14px] hover:underline underline-offset-2"
                      >
                        {titleCase(r.district)}
                        <span className="opacity-70"> · {titleCase(r.state)}</span>
                      </Link>
                    </td>
                    <td className="py-2.5 pr-4 text-right font-label text-[13px] tabular-nums">
                      {nf.format(r.n)}
                    </td>
                    <td className="py-2.5 pr-4 text-right font-label text-[13px] tabular-nums opacity-70">
                      {r.nA ? nf.format(r.nA) : "0"}
                    </td>
                    <td className="py-2.5 pr-4">
                      <span
                        className="font-label text-[9px] uppercase tracking-[0.14em]"
                        style={{
                          color: r.sa === "within" ? PLUM : undefined,
                          // 0.7 is the floor for 9px ink on paper: 0.45 read at 2.8:1.
                          opacity: r.sa === "within" ? 1 : r.sa === "partial" ? 0.85 : 0.7,
                        }}
                      >
                        {SA_LABEL[r.sa]}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 text-right font-label text-[13px] tabular-nums">
                      {r.st != null ? `${r.st.toFixed(1)}%` : "No data"}
                    </td>
                    <td className="py-2.5 pr-4 text-right font-label text-[13px] tabular-nums opacity-70">
                      {r.landDep != null ? `${r.landDep.toFixed(0)}%` : "No data"}
                    </td>
                    <td className="py-2.5 text-right font-label text-[13px] tabular-nums opacity-70">
                      {r.displaced ? nf.format(r.displaced) : "0"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
          {shown < filtered.length ? (
            <button
              type="button"
              onClick={() => setShown((s) => s + 80)}
              className="mt-6 px-5 py-2.5 border border-[#1c1c19] font-label text-[11px] uppercase tracking-[0.18em] hover:bg-[#1c1c19] hover:text-[#fcf9f4] transition-colors"
            >
              Show more ({nf.format(filtered.length - shown)} remaining)
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

function Lbl({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-label text-[10px] uppercase tracking-[0.18em] opacity-75 block mb-1.5">
      {children}
    </span>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      // Without scope a screen reader cannot associate a cell with its column,
      // so a 620-row table of seven columns is read as 4,340 unlabelled
      // numbers. One attribute turns it back into a table.
      scope="col"
      className={`font-label text-[9px] uppercase tracking-[0.16em] opacity-75 py-2 pr-4 font-medium ${
        right ? "text-right" : ""
      }`}
    >
      {children}
    </th>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="font-label text-[9px] uppercase tracking-[0.18em] opacity-70 block">
        {label}
      </span>
      <span className="font-label font-bold text-[18px] tabular-nums" style={{ color: PLUM }}>
        {value}
      </span>
    </div>
  );
}

