/**
 * What else is proposed near this site.
 *
 * A clearance is appraised one proposal at a time, and a register lists them
 * one at a time, so nothing in either says that a sand lease sits beside four
 * other sand leases, a cement plant and a highway widening - the cumulative
 * load a community actually carries. The site coordinates make it answerable:
 * every other proposal whose mapped site lies within the radius, nearest
 * first.
 *
 * Server-rendered. Distances are between the published points - the block
 * each proposal's own location verdict rests on - so a large project may lie
 * nearer than its point suggests; the sentence says so.
 */
import ScrollRegion from "./ScrollRegion";
import Link from "next/link";
import type { NearbyProposal } from "@/lib/instruments/server";
import { PLUM } from "./InstrumentChrome";

const nf = new Intl.NumberFormat("en-IN");

export default function NearbyProposals({
  nearby,
  hasSite,
  labels,
}: {
  nearby: { items: NearbyProposal[]; total: number; radiusKm: number };
  hasSite: boolean;
  labels: Record<string, string>;
}) {
  return (
    <section className="mt-14 mb-6" aria-labelledby="nearby-heading">
      <h2
        id="nearby-heading"
        className="font-headline font-bold text-[clamp(22px,2.6vw,32px)] tracking-[-0.02em] mb-2"
      >
        Proposed nearby
      </h2>
      {!hasSite ? (
        <p className="font-body text-[14px] leading-relaxed opacity-75 max-w-3xl">
          This filing gives no site coordinates, so we cannot measure what else
          is proposed around it.
        </p>
      ) : nearby.total === 0 ? (
        <p className="font-body text-[14px] leading-relaxed opacity-75 max-w-3xl">
          No other proposal in the register gives site coordinates within{" "}
          {nearby.radiusKm} km of this one.
        </p>
      ) : (
        <>
          <p className="font-body text-[14px] leading-relaxed opacity-80 max-w-3xl mb-4">
            <strong style={{ color: PLUM }}>{nf.format(nearby.total)}</strong>{" "}
            other {nearby.total === 1 ? "proposal gives site coordinates" : "proposals give site coordinates"}{" "}
            within {nearby.radiusKm} km of this one
            {nearby.total > nearby.items.length
              ? `, and the nearest ${nearby.items.length} are listed`
              : ""}
            . Each proposal is appraised separately, so a list like this is one
            way to see them together. Distances are measured between the single
            points we publish for each filing, so parts of a large site can lie
            closer than its point suggests.
          </p>
          <ScrollRegion label="Nearby proposals" className="border-t border-[#1c1c19]/25">
            <table className="w-full text-left font-body text-[13px]">
              <caption className="sr-only">
                Proposals whose mapped site lies within {nearby.radiusKm} km, nearest first
              </caption>
              <thead>
                <tr className="font-label text-[10px] uppercase tracking-[0.14em] opacity-70">
                  <th scope="col" className="py-2 pr-4 font-normal">Distance</th>
                  <th scope="col" className="py-2 pr-4 font-normal">Proposal</th>
                  <th scope="col" className="py-2 pr-4 font-normal">Sector</th>
                  <th scope="col" className="py-2 font-normal">Stage</th>
                </tr>
              </thead>
              <tbody>
                {nearby.items.map((n) => (
                  <tr key={n.id} className="border-t border-[#1c1c19]/10 align-top">
                    <td className="py-2 pr-4 whitespace-nowrap tabular-nums">{n.km} km</td>
                    <td className="py-2 pr-4">
                      <Link prefetch={false}
                        href={`/instruments/consent/${n.id}`}
                        className="underline underline-offset-2 break-words"
                      >
                        {n.name.length > 140 ? n.name.slice(0, 137).replace(/\s+\S*$/, "") + "…" : n.name}
                      </Link>
                      <span className="block font-label text-[10px] tracking-[0.06em] opacity-80 mt-0.5">
                        {n.no}
                      </span>
                    </td>
                    <td className="py-2 pr-4">{n.sector}</td>
                    <td className="py-2">{n.statusKey ? labels[n.statusKey] ?? n.statusKey : "Not recorded"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        </>
      )}
    </section>
  );
}
