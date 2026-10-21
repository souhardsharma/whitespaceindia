"use client";

/**
 * Renders one Fact.
 *
 * This component is where the plan's hardest constraint is enforced: a
 * benchmark comparison is drawn ONLY when `fact.benchmark.sameDefinition` is
 * true. That flag is set in buildFact() and nowhere else, and it is true only
 * when the benchmark came from the same measure id - hence the same definition
 * and the same denominator - as the value it judges.
 *
 * If a future change introduces a benchmark computed a different way, the
 * comparison silently stops rendering rather than quietly showing a wrong one.
 * Failing closed is the point.
 *
 * Provenance is not optional decoration. Every value carries its source and
 * vintage, reachable without leaving the page.
 */

import { useId, useState } from "react";
import type { Fact } from "@/lib/instruments/types";
import { compareToBenchmark, formatValue } from "@/lib/instruments/facts";
import BenchmarkBar from "./BenchmarkBar";
import { PLUM } from "./InstrumentChrome";

export function FactValue({
  fact,
  emphasis = false,
}: {
  fact: Fact;
  emphasis?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const comparison = compareToBenchmark(fact);
  const missing = fact.value === null;

  return (
    // A <dl> row may hold only <dt> and <dd>, so the comparison and the source
    // panel ride in a second <dd> spanning the row.
    <div className="py-4 border-b border-[#1c1c19]/12 last:border-b-0 grid grid-cols-[1fr_auto] items-baseline gap-x-4">
        <dt className="font-body text-[14px] leading-snug opacity-80">
          {fact.label}
        </dt>
        <dd
          className={`font-label tabular-nums leading-none shrink-0 ${
            emphasis ? "text-[26px] md:text-[32px] font-bold" : "text-[19px] font-bold"
          }`}
          style={{ color: missing ? undefined : emphasis ? PLUM : "#1c1c19" }}
        >
          {missing ? (
            <span className="text-[14px] font-medium opacity-65">not recorded</span>
          ) : (
            formatValue(fact.value, fact.unit)
          )}
        </dd>

      <dd className="col-span-2">
      <div className="flex items-center justify-between gap-3 mt-1.5">
        {/*
          No comparison is drawn unless the benchmark passed the same-definition
          check. When it did not, the value stands alone rather than being
          judged against something computed differently.
        */}
        {/* The comparison, drawn rather than described. The sentence is not
            gone - it is the bar's accessible name - so the same fact reaches a
            screen reader in words and a sighted reader in one look. */}
        {comparison && fact.benchmark ? (
          <BenchmarkBar
            value={fact.value as number}
            benchmark={fact.benchmark.value as number}
            benchmarkLabel={fact.benchmark.label}
            coverage={fact.benchmark.coverage}
            text={comparison.text}
            unit={fact.unit}
          />
        ) : (
          <span />
        )}

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={panelId}
          className="font-label text-[9px] uppercase tracking-[0.16em] opacity-65 hover:opacity-90 transition-opacity shrink-0"
        >
          {open ? "Hide source" : "Source"}
        </button>
      </div>

      {open ? (
        <div
          id={panelId}
          className="mt-3 p-3 bg-[#1c1c19]/[0.035] border-l-2 text-[12px] leading-relaxed font-body space-y-2"
          style={{ borderColor: PLUM }}
        >
          <p>
            <SourceLabel>Definition</SourceLabel>
            {fact.definition}
          </p>
          <p>
            <SourceLabel>Formula</SourceLabel>
            <code className="font-label text-[11px]">{fact.formula}</code>
          </p>
          <p>
            <SourceLabel>Source</SourceLabel>
            {fact.source}
          </p>
          <p>
            <SourceLabel>Year of data</SourceLabel>
            {fact.vintage}
            {isStale(fact.vintage) ? (
              <span className="ml-2 font-label text-[10px] uppercase tracking-[0.14em] opacity-70">
                · more than a decade old
              </span>
            ) : null}
          </p>
          {fact.benchmark ? (
            <p>
              <SourceLabel>Benchmark</SourceLabel>
              {fact.benchmark.label}:{" "}
              {formatValue(fact.benchmark.value, fact.unit)}
              {fact.benchmark.sameDefinition
                ? ", computed with the same definition and denominator"
                : ". It uses a different definition, so no comparison is shown."}
            </p>
          ) : null}
          {fact.caveats?.length ? (
            <div>
              <SourceLabel>Caveats</SourceLabel>
              <ul className="list-disc pl-4 space-y-1">
                {fact.caveats.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
      </dd>
    </div>
  );
}

function SourceLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-label text-[9px] uppercase tracking-[0.18em] opacity-85 mr-2">
      {children}
    </span>
  );
}

function isStale(vintage: string): boolean {
  const year = parseInt(vintage.slice(0, 4), 10);
  if (!Number.isFinite(year)) return false;
  return new Date().getFullYear() - year >= 10;
}

/** A titled group of facts. */
export function FactGroup({
  title,
  intro,
  facts,
  emphasise,
}: {
  title: string;
  intro?: string;
  facts: Fact[];
  emphasise?: string[];
}) {
  if (!facts.length) return null;
  return (
    <section className="mb-10">
      <h3 className="font-label text-[10px] uppercase tracking-[0.22em] opacity-70 mb-1">
        {title}
      </h3>
      {intro ? (
        <p className="font-body text-[13px] leading-relaxed opacity-65 mb-3 max-w-2xl">
          {intro}
        </p>
      ) : null}
      <dl className="border-t border-[#1c1c19]/25">
        {facts.map((f) => (
          <FactValue
            key={f.id}
            fact={f}
            emphasis={emphasise?.includes(f.id)}
          />
        ))}
      </dl>
    </section>
  );
}
