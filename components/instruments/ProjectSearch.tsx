"use client";

/**
 * Search over the whole clearance register.
 *
 * The server answers (app/api/instruments/consent/search): every state at
 * once, a page at a time, with the stage menu counted over the current
 * filters. It used to load one state's 10 MB shard into the browser, which is
 * why a state had to be chosen before anything could be typed - and the page
 * then told readers the source offered no national index. It was this
 * instrument that offered none.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import stagesFile from "@/public/data/instruments/consent/stages.json";
import type {
  InstrumentIndex,
  ProjectSummary,
  StateSummary,
} from "@/lib/instruments/types";
import { stageLabel } from "@/lib/instruments/projects";
import { PLUM } from "./InstrumentChrome";

const PAGE = 25;
const nf = new Intl.NumberFormat("en-IN");

/** Canonical stage key -> the label and definition published for it. */
const STAGE_LABELS = (stagesFile as {
  statuses?: Record<string, { label: string; definition?: string }>;
}).statuses ?? {};

/** Just the labels, for stageLabel. Same registry, one shape. */
const STAGE_LABEL_TEXT: Record<string, string> = Object.fromEntries(
  Object.entries(STAGE_LABELS).map(([k, v]) => [k, String(v?.label ?? k)]),
);

type SearchItem = ProjectSummary & { stateSlug: string; districtName: string | null };
type LoadState = "loading" | "ready" | "error";

export default function ProjectSearch({ index }: { index: InstrumentIndex }) {
  const [stateSlug, setStateSlug] = useState("");
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [sector, setSector] = useState("");
  const [category, setCategory] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [resolvedOnly, setResolvedOnly] = useState(false);
  const [displacementOnly, setDisplacementOnly] = useState(false);

  const [items, setItems] = useState<SearchItem[]>([]);
  const [total, setTotal] = useState(0);
  const [stages, setStages] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<LoadState>("loading");

  const states = useMemo(
    () =>
      Object.values(index.states).sort((a, b) =>
        a.name.localeCompare(b.name)
      ) as StateSummary[],
    [index]
  );

  // Summed from the index, NEVER typed in: a typed total went stale while the
  // hero figure above it moved with the data.
  const registerTotal = Object.values(index.states).reduce(
    (sum, st) => sum + (st.total ?? 0),
    0,
  );

  // Typing waits for a pause before it asks the server.
  useEffect(() => {
    const t = setTimeout(() => setQuery(text), 250);
    return () => clearTimeout(t);
  }, [text]);

  const params = useMemo(() => {
    const u = new URLSearchParams();
    if (query.trim()) u.set("q", query.trim());
    if (stateSlug) u.set("state", stateSlug);
    if (sector) u.set("sector", sector);
    if (category) u.set("category", category);
    if (statusFilter) u.set("stage", statusFilter);
    if (resolvedOnly) u.set("located", "1");
    if (displacementOnly) u.set("displacement", "1");
    return u;
  }, [query, stateSlug, sector, category, statusFilter, resolvedOnly, displacementOnly]);

  const load = useCallback(
    async (offset: number) => {
      const u = new URLSearchParams(params);
      u.set("offset", String(offset));
      u.set("limit", String(PAGE));
      const res = await fetch(`/api/instruments/consent/search?${u.toString()}`);
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()) as {
        total: number; stages: Record<string, number>; items: SearchItem[];
      };
    },
    [params],
  );

  // Which filter set the rows on screen belong to, and whether a "Show more"
  // is in flight. Without them a double click appended the same page twice
  // (duplicate keys), and a page requested before a filter changed was
  // appended to the NEW filter's results.
  const generation = useRef(0);
  const busy = useRef(false);
  const [moreLoading, setMoreLoading] = useState(false);

  useEffect(() => {
    let live = true;
    generation.current += 1;
    setStatus("loading");
    load(0)
      .then((d) => {
        if (!live) return;
        setItems(d.items);
        setTotal(d.total);
        setStages(d.stages);
        setStatus("ready");
      })
      .catch(() => live && setStatus("error"));
    return () => {
      live = false;
    };
  }, [load]);

  const more = async () => {
    // Not while a new filter's first page is loading: `generation` has already
    // moved, so a page fetched now at the OLD list's length would be appended
    // to the new results with a gap.
    if (busy.current || status !== "ready") return;
    busy.current = true;
    setMoreLoading(true);
    const gen = generation.current;
    try {
      const d = await load(items.length);
      if (gen !== generation.current) return;
      setItems((prev) => {
        const have = new Set(prev.map((p) => p.id));
        return [...prev, ...d.items.filter((p) => !have.has(p.id))];
      });
    } catch {
      if (gen === generation.current) setStatus("error");
    } finally {
      busy.current = false;
      setMoreLoading(false);
    }
  };

  /** One option per canonical stage the current filters can return. */
  const stageOptions = useMemo(
    () =>
      Object.keys(stages)
        .map((key) => ({ key, label: STAGE_LABELS[key]?.label ?? key, n: stages[key] }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [stages],
  );

  const current = stateSlug ? index.states[stateSlug] : null;

  return (
    <div>
      {/* ── controls ── */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 mb-8">
        <label className="md:col-span-8 block">
          <span className="font-label text-[10px] uppercase tracking-[0.18em] opacity-75 block mb-1.5">
            Project, company or agency, district, or proposal number
          </span>
          <input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. cement, a company, Singrauli, or IA/GJ/THE/…"
            className="w-full bg-[#fcf9f4] border border-[#1c1c19] px-3 py-2.5 font-body text-[14px] focus:outline-none focus:ring-2"
            style={{ ["--tw-ring-color" as string]: PLUM }}
          />
        </label>

        <label className="md:col-span-4 block">
          <span className="font-label text-[10px] uppercase tracking-[0.18em] opacity-75 block mb-1.5">
            State or union territory
          </span>
          <select
            value={stateSlug}
            onChange={(e) => setStateSlug(e.target.value)}
            className="w-full bg-[#fcf9f4] border border-[#1c1c19] px-3 py-2.5 font-body text-[14px] focus:outline-none focus:ring-2"
            style={{ ["--tw-ring-color" as string]: PLUM }}
          >
            <option value="">All of India</option>
            {states.map((s) => (
              <option key={s.slug} value={s.slug}>
                {titleCase(s.name)} ({nf.format(s.total)})
              </option>
            ))}
          </select>
        </label>

        <label className="md:col-span-3 block">
          <span className="font-label text-[10px] uppercase tracking-[0.18em] opacity-75 block mb-1.5">
            Category
          </span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full bg-[#fcf9f4] border border-[#1c1c19] px-3 py-2.5 font-body text-[14px]"
          >
            <option value="">All categories</option>
            {index.categories.map((c) => (
              <option key={c} value={c}>
                Category {c}
              </option>
            ))}
          </select>
        </label>

        <label className="md:col-span-3 block">
          <span className="font-label text-[10px] uppercase tracking-[0.18em] opacity-75 block mb-1.5">
            Sector
          </span>
          <select
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            className="w-full bg-[#fcf9f4] border border-[#1c1c19] px-3 py-2.5 font-body text-[14px]"
          >
            <option value="">All sectors</option>
            {index.sectors.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label className="md:col-span-3 block">
          <span className="font-label text-[10px] uppercase tracking-[0.18em] opacity-75 block mb-1.5">
            Stage
          </span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full bg-[#fcf9f4] border border-[#1c1c19] px-3 py-2.5 font-body text-[14px]"
          >
            <option value="">Any stage</option>
            {stageOptions.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label} ({nf.format(o.n)})
              </option>
            ))}
          </select>
        </label>

        <fieldset className="md:col-span-3 flex flex-col justify-end gap-2 pb-1">
          <legend className="sr-only">Additional filters</legend>
          <label className="flex items-center gap-2 font-body text-[13px] cursor-pointer">
            <input
              type="checkbox"
              checked={resolvedOnly}
              onChange={(e) => setResolvedOnly(e.target.checked)}
              className="accent-[#7a3b6b]"
            />
            Only proposals placed in a district
          </label>
          <label className="flex items-center gap-2 font-body text-[13px] cursor-pointer">
            <input
              type="checkbox"
              checked={displacementOnly}
              onChange={(e) => setDisplacementOnly(e.target.checked)}
              className="accent-[#7a3b6b]"
            />
            Only where the form declares affected or displaced families, or
            resettlement
          </label>
        </fieldset>
      </div>

      {/* ── results ── */}
      <p className="sr-only" role="status" aria-live="polite">
        {status === "ready"
          ? total === 0
            ? "No proposal matches those filters."
            : `${nf.format(total)} proposals match.`
          : ""}
      </p>

      {status === "error" ? (
        <EmptyState
          title="The search could not be completed"
          body="The search failed to load, although the register does hold these proposals. Reloading the page usually fixes this."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-3 mb-4 pb-3 border-b border-[#1c1c19]">
            <p className="font-body text-[14px]">
              {status === "loading" && items.length === 0 ? (
                <span className="opacity-70">Searching the clearance register…</span>
              ) : (
                <>
                  <strong className="font-label">{nf.format(total)}</strong>{" "}
                  {total === 1 ? "proposal" : "proposals"}
                  <span className="opacity-75">
                    {" "}
                    of {nf.format(current ? current.total : registerTotal)}{" "}
                    {current ? `filed in ${titleCase(current.name)}` : "in the register"}
                  </span>
                </>
              )}
            </p>
            {current ? (
              <p className="font-label text-[10px] uppercase tracking-[0.16em] opacity-70">
                {nf.format(current.resolved)} of {nf.format(current.total)} placed
                in a district
              </p>
            ) : null}
          </div>

          {status === "ready" && total === 0 ? (
            <EmptyState
              title="No proposal matches those filters"
              body="The search ran and found nothing. You can widen the filters or change the search text."
            />
          ) : (
            <>
              <ol className="border-t border-[#1c1c19]/25" aria-busy={status === "loading"}>
                {items.map((p) => (
                  <ProjectRow key={p.id} project={p} />
                ))}
              </ol>
              {items.length < total ? (
                <button
                  type="button"
                  onClick={more}
                  disabled={moreLoading || status !== "ready"}
                  aria-busy={moreLoading}
                  className="tap-target mt-6 disabled:opacity-50 px-5 py-2.5 border border-[#1c1c19] font-label text-[11px] uppercase tracking-[0.18em] hover:bg-[#1c1c19] hover:text-[#fcf9f4] transition-colors"
                >
                  Show more ({nf.format(total - items.length)} remaining)
                </button>
              ) : null}
            </>
          )}
        </>
      )}
    </div>
  );
}

function ProjectRow({ project: p }: { project: SearchItem }) {
  const displaced = p.declared.displacedFamilies ?? 0;
  const affected = p.declared.affectedFamilies ?? 0;
  return (
    <li className="border-b border-[#1c1c19]/15">
      <Link prefetch={false}
        href={`/instruments/consent/${encodeURIComponent(p.id)}`}
        className="group block py-5 hover:bg-[#1c1c19]/[0.02] transition-colors"
      >
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 md:gap-5">
          <div className="md:col-span-8">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-1.5">
              <span
                className="font-label text-[9px] uppercase tracking-[0.16em] px-1.5 py-0.5"
                style={{ background: PLUM, color: "#fcf9f4" }}
              >
                {p.category ? `Category ${p.category}` : "No category"}
              </span>
              <span className="font-label text-[10px] uppercase tracking-[0.14em] opacity-70">
                {stageLabel(p.statusKey, p.status, STAGE_LABEL_TEXT)}
              </span>
              <span className="font-label text-[10px] tracking-[0.1em] opacity-65">
                {p.no}
              </span>
            </div>
            <h3 className="font-headline text-[17px] md:text-[19px] leading-snug tracking-[-0.01em] group-hover:underline decoration-1 underline-offset-2 break-words">
              {p.name}
            </h3>
            <p className="font-body text-[12.5px] opacity-75 mt-1">
              {p.agency || "Applicant not recorded"} · {p.sector} · {p.date}
            </p>
          </div>
          <div className="md:col-span-4 md:text-right">
            {p.districtName ? (
              <p className="font-body text-[13px] mb-1">{p.districtName}</p>
            ) : null}
            <LocationBadge project={p} />
            {displaced > 0 || affected > 0 ? (
              <p className="font-label text-[10px] uppercase tracking-[0.12em] mt-1.5 opacity-80">
                {displaced > 0
                  ? `${nf.format(displaced)} families displaced`
                  : `${nf.format(affected)} families affected`}
                <span>, as declared</span>
              </p>
            ) : null}
          </div>
        </div>
      </Link>
    </li>
  );
}

function LocationBadge({ project: p }: { project: ProjectSummary }) {
  if (p.district === null) {
    return (
      <span className="font-label text-[10px] uppercase tracking-[0.14em] opacity-65">
        Location not determined
      </span>
    );
  }
  const detail =
    p.resolution === "village"
      ? `from ${p.villageCount ?? 0} village${p.villageCount === 1 ? "" : "s"} on the form`
      : p.resolution === "subdistrict"
      ? "from the sub-district on the form"
      : p.resolution === "lgd_district"
      ? "from the district on the form"
      : p.resolution === "adjudicated"
      ? "declared district, confirmed by site"
      : p.resolution === "town_settled"
      ? "town in several districts, settled by site or form"
      : "inferred from project title";
  return (
    <span className="font-label text-[10px] uppercase tracking-[0.14em] opacity-70">
      {p.allDistricts && p.allDistricts.length > 1
        ? `${p.allDistricts.length} districts · `
        : ""}
      {detail}
    </span>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="py-14 text-center border border-dashed border-[#1c1c19]/25">
      <p className="font-headline text-[20px] tracking-[-0.01em]">{title}</p>
      {body ? (
        <p className="font-body text-[14px] leading-relaxed opacity-65 mt-2 max-w-xl mx-auto px-6">
          {body}
        </p>
      ) : null}
    </div>
  );
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
