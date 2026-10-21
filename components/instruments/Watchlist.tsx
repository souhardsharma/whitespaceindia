"use client";

/**
 * Proposals and districts a reader follows, and what has moved since they
 * last looked.
 *
 * No account and no server-side state: the list lives in this browser's
 * storage, and the current position of each followed proposal is read from
 * the published data through /api/instruments/consent/status. A reader who
 * clears their browser loses the list; that is the trade for asking nobody
 * for an email address. Every read and write is guarded - private windows and
 * blocked storage throw - and the page renders without it.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { PLUM } from "./InstrumentChrome";

export const WATCH_KEY = "ws-instruments-watch-v1";

export interface WatchState {
  proposals: Record<string, { name: string; seenSk: string | null; seenUpd: string | null; at: string }>;
  /** seenStamp: when the change log was built (ISO), as of the last look at
   *  this district. News is every event that FIRST
   *  APPEARED in a later read - not every event dated later, which misses a
   *  step the portal records late, and not a count subtracted from a count,
   *  which an event leaving the log corrupts. seenDate/seenCount are the
   *  previous scheme, still read from browsers that stored them. */
  districts: Record<string, { name: string; seenStamp?: string | null; seenDate?: string; seenCount?: number; at: string }>;
}

export function readWatch(): WatchState {
  try {
    const raw = window.localStorage.getItem(WATCH_KEY);
    const v = raw ? (JSON.parse(raw) as Partial<WatchState>) : {};
    return { proposals: v.proposals ?? {}, districts: v.districts ?? {} };
  } catch {
    return { proposals: {}, districts: {} };
  }
}

export function writeWatch(s: WatchState): void {
  try {
    window.localStorage.setItem(WATCH_KEY, JSON.stringify(s));
    window.dispatchEvent(new Event("ws-watch-changed"));
  } catch {
    /* storage unavailable: following simply does not persist */
  }
}

interface Status {
  sk: string | null;
  stage: string;
  upd: string | null;
  don: string | null;
}

export default function Watchlist() {
  const [watch, setWatch] = useState<WatchState | null>(null);
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [districtCounts, setDistrictCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    const load = () => setWatch(readWatch());
    load();
    window.addEventListener("ws-watch-changed", load);
    return () => window.removeEventListener("ws-watch-changed", load);
  }, []);

  useEffect(() => {
    if (!watch) return;
    const ids = Object.keys(watch.proposals);
    if (ids.length) {
      fetch(`/api/instruments/consent/status?ids=${ids.slice(0, 100).join(",")}`)
        .then((r) => (r.ok ? r.json() : {}))
        .then((d) => setStatus(d as Record<string, Status>))
        .catch(() => undefined);
    }
    const codes = Object.keys(watch.districts);
    Promise.all(
      codes.map((c) =>
        fetch(newsUrl(c, watch.districts[c]))
          .then((r) => (r.ok ? r.json() : { total: 0 }))
          .then((d: { total?: number }) => {
            const w = watch.districts[c];
            const n = w.seenStamp ? d.total ?? 0 : Math.max(0, (d.total ?? 0) - (w.seenCount ?? 0));
            return [c, n] as const;
          })
          .catch(() => [c, 0] as const),
      ),
    ).then((pairs) => setDistrictCounts(Object.fromEntries(pairs)));
  }, [watch]);

  if (!watch) return null;
  const pIds = Object.keys(watch.proposals);
  const dIds = Object.keys(watch.districts);
  if (pIds.length === 0 && dIds.length === 0) {
    return (
      <section className="mb-12 border border-dashed border-[#1c1c19]/30 p-5">
        <h2 className="font-label text-[11px] uppercase tracking-[0.18em] mb-1">Following</h2>
        <p className="font-body text-[13.5px] opacity-75 max-w-3xl">
          When you follow a proposal or a district from its page, it appears
          here with any change recorded since you last looked. The list is kept
          in this browser and needs no account. To check for changes, the page
          sends the numbers of the proposals and districts on the list to this
          site&apos;s server.
        </p>
      </section>
    );
  }

  const markSeen = async () => {
    const next: WatchState = { proposals: { ...watch.proposals }, districts: { ...watch.districts } };
    for (const id of pIds) {
      const s = status[id];
      if (s) next.proposals[id] = { ...next.proposals[id], seenSk: s.sk, seenUpd: s.upd };
    }
    for (const c of dIds) {
      const mark = await districtMark(c);
      if (mark) next.districts[c] = { name: next.districts[c].name, at: next.districts[c].at, ...mark };
    }
    writeWatch(next);
  };

  const moved = pIds.filter((id) => {
    const s = status[id];
    const w = watch.proposals[id];
    return s && (s.sk !== w.seenSk || s.upd !== w.seenUpd);
  });

  return (
    <section className="mb-12 border border-[#1c1c19] p-5" aria-labelledby="watch-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
        <h2 id="watch-heading" className="font-label text-[11px] uppercase tracking-[0.18em]">
          Following, {moved.length + Object.values(districtCounts).filter((n) => n > 0).length} with changes
        </h2>
        <button type="button" onClick={markSeen}
                className="tap-target font-label text-[10px] uppercase tracking-[0.16em] underline underline-offset-2">
          Mark all as seen
        </button>
      </div>
      <ul className="space-y-2 font-body text-[13.5px]">
        {pIds.map((id) => {
          const w = watch.proposals[id];
          const s = status[id];
          const changed = s && (s.sk !== w.seenSk || s.upd !== w.seenUpd);
          return (
            <li key={id} className="flex flex-wrap gap-x-3">
              <Link prefetch={false} href={`/instruments/consent/${id}`} className="underline underline-offset-2">
                {w.name.length > 110 ? w.name.slice(0, 107) + "…" : w.name}
              </Link>
              <span className="opacity-75">{s ? s.stage : "…"}</span>
              {changed ? (
                <strong className="font-label text-[10px] uppercase tracking-[0.14em]" style={{ color: PLUM }}>
                  changed since you last looked
                </strong>
              ) : null}
            </li>
          );
        })}
        {dIds.map((c) => {
          const w = watch.districts[c];
          const n = districtCounts[c] ?? 0;
          return (
            <li key={`d${c}`} className="flex flex-wrap gap-x-3">
              <Link prefetch={false} href={`/instruments/consent/district/${c}`} className="underline underline-offset-2">
                {w.name}
              </Link>
              <span className="opacity-75">district</span>
              {n > 0 ? (
                <Link href={`/instruments/consent/latest?days=60&district=${c}`}
                      className="font-label text-[10px] uppercase tracking-[0.14em]" style={{ color: PLUM }}>
                  {n} {n === 1 ? "event" : "events"} since you last looked
                </Link>
              ) : (
                <span className="font-label text-[10px] uppercase tracking-[0.14em] opacity-80">nothing new</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The events that are news for a followed district. */
function newsUrl(code: string, w: { seenStamp?: string | null; seenDate?: string }): string {
  if (w.seenStamp) {
    return `/api/instruments/consent/changes?district=${code}&days=60&after=${encodeURIComponent(w.seenStamp)}`;
  }
  return `/api/instruments/consent/changes?district=${code}&since=${w.seenDate ?? ""}`;
}

/** Where the change log stands now: when it was built. */
async function districtMark(code: string): Promise<{ seenStamp: string } | null> {
  try {
    const head = await fetch(`/api/instruments/consent/changes?district=${code}&days=7`);
    const stamp = ((await head.json()) as { stamp?: string | null }).stamp;
    return stamp ? { seenStamp: stamp } : null;
  } catch {
    return null;
  }
}

/** Follow / unfollow one proposal or district. */
export function FollowButton({
  kind,
  id,
  name,
  sk,
  upd,
}: {
  kind: "proposal" | "district";
  id: string;
  name: string;
  sk?: string | null;
  upd?: string | null;
}) {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    const w = readWatch();
    setOn(kind === "proposal" ? Boolean(w.proposals[id]) : Boolean(w.districts[id]));
  }, [kind, id]);
  if (on === null) return null;
  const toggle = async () => {
    const w = readWatch();
    const now = new Date().toISOString();
    if (kind === "proposal") {
      if (w.proposals[id]) delete w.proposals[id];
      else w.proposals[id] = { name, seenSk: sk ?? null, seenUpd: upd ?? null, at: now };
    } else if (w.districts[id]) {
      delete w.districts[id];
    } else {
      // No read to anchor to (the log is unavailable): anchor to now, so
      // nothing already published counts as news.
      const mark = (await districtMark(id)) ?? { seenStamp: now };
      w.districts[id] = { name, ...mark, at: now };
    }
    writeWatch(w);
    setOn(!on);
  };
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      className="tap-target inline-flex items-center gap-2 px-4 py-2 border font-label text-[10px] uppercase tracking-[0.16em]"
      style={on ? { background: PLUM, color: "#fcf9f4", borderColor: PLUM } : { borderColor: "#1c1c19" }}
    >
      {on ? "Following" : kind === "proposal" ? "Follow this proposal" : "Follow this district"}
    </button>
  );
}
