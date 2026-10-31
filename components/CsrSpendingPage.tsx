import Link from "next/link";
import type { ReactNode } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import {
  CSR_WINDOW,
  PAN_INDIA_SHARE,
  STATE_SPENDING,
  formatPoor,
  formatRupees,
  type RankedDistrict,
} from "@/lib/csr/spending";

const LABEL = "font-label text-[10px] uppercase tracking-[0.2em]";
const CELL = "py-2.5 pr-4 align-baseline";
const NUMBER = `${CELL} font-label tabular-nums text-right text-[13px] whitespace-nowrap`;

/** Page frame shared by the /csr-spending pages: the CSR chrome, a title, and the links every one of them carries. */
export default function CsrSpendingPage({
  eyebrow,
  title,
  intro,
  children,
}: {
  eyebrow: ReactNode;
  title: string;
  intro: ReactNode;
  children: ReactNode;
}) {
  return (
    <main id="main-content" className="bg-[#fcf9f4] min-h-screen text-[#1c1c19]">
      <Navbar />
      <div className="pt-32 md:pt-40 pb-20 px-6 md:px-12 lg:px-16">
        <div className="max-w-5xl mx-auto">
          <p className={`${LABEL} text-[#BD402C] mb-5`}>{eyebrow}</p>
          <h1 className="font-headline text-4xl md:text-6xl headline-tight">{title}</h1>
          <div className="mt-8 max-w-3xl font-body text-base md:text-lg leading-relaxed text-[#1c1c19]/85 space-y-4">
            {intro}
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="/csr#ledger" className={`${LABEL} bg-[#BD402C] text-white px-4 py-3 hover:bg-[#1c1c19] transition-colors`}>
              Enter the full ledger
            </a>
            <Link href="/methodology" className={`${LABEL} border border-[#1c1c19] px-4 py-3 hover:bg-[#1c1c19] hover:text-[#fcf9f4] transition-colors`}>
              How the score is built
            </Link>
          </div>

          {children}

          <section className="mt-14 border-t border-[#1c1c19] pt-6 font-body text-sm leading-relaxed text-[#1c1c19]/75 max-w-3xl space-y-3">
            <h2 className={`${LABEL} text-[#1c1c19]`}>Reading these figures</h2>
            <p>
              Spending is what companies reported to the Ministry of Corporate Affairs for {CSR_WINDOW}, summed across
              those years. About {PAN_INDIA_SHARE}% of all CSR money in the filings is reported as Pan India or names no
              district, so every figure here is a floor. Per-person figures use Census 2011 population, and poverty is
              NITI Aayog&apos;s headcount for 2019-21. The score combines poverty, the funding gap and persistence; a
              high score marks a place to look closer and is no verdict on anyone&apos;s work.
            </p>
            <p>
              Source: NITI Aayog MPI 2023; Ministry of Corporate Affairs CSR filings via Dataful.in; Census 2011.
            </p>
          </section>

          <nav aria-label="CSR spending by State" className="mt-14 border-t border-[#1c1c19] pt-6">
            <h2 className={`${LABEL} mb-4`}>CSR spending by State</h2>
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-2 font-body text-sm">
              {STATE_SPENDING.map((state) => (
                <li key={state.slug}>
                  <Link href={`/csr-spending/${state.slug}`} className="underline underline-offset-4 decoration-[#1c1c19]/25 hover:decoration-[#BD402C] hover:text-[#BD402C]">
                    {state.name}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-5 font-body text-sm">
              <Link href="/csr-spending" className="underline underline-offset-4">All States compared</Link>
              {" · "}
              <Link href="/csr-spending/whitespace-districts" className="underline underline-offset-4">The whitespace districts</Link>
            </p>
          </nav>
        </div>
      </div>
      <Footer />
    </main>
  );
}

/** The ruled table of districts. `showState` is for lists that cross State lines. */
export function DistrictTable({ districts, showState = false }: { districts: RankedDistrict[]; showState?: boolean }) {
  return (
    <div className="mt-12 overflow-x-auto border-t border-[#1c1c19]">
      <table className="w-full min-w-[600px] border-collapse">
        <caption className="sr-only">Districts by score, with poverty and recorded CSR spending</caption>
        <thead>
          <tr className="border-b border-[#1c1c19] text-left">
            <th scope="col" className={`${LABEL} ${CELL}`}>India rank</th>
            <th scope="col" className={`${LABEL} ${CELL}`}>District</th>
            {showState ? <th scope="col" className={`${LABEL} ${CELL}`}>State</th> : null}
            <th scope="col" className={`${LABEL} ${CELL} text-right`}>Poor</th>
            <th scope="col" className={`${LABEL} ${CELL} text-right`}>CSR, ₹ crore</th>
            <th scope="col" className={`${LABEL} ${CELL} text-right`}>CSR per person</th>
            <th scope="col" className={`${LABEL} ${CELL} !pr-0 text-right`}>Score</th>
          </tr>
        </thead>
        <tbody>
          {districts.map((d) => (
            <tr key={d.district_lgd_code} className="border-b border-[#1c1c19]/15">
              <td className={`${NUMBER} !text-left text-[#1c1c19]/65`}>{d.rank}</td>
              <th scope="row" className={`${CELL} text-left font-headline font-semibold text-[17px]`}>
                {d.district_name}
                {d.is_whitespace ? (
                  <span className="ml-2 inline-block font-label font-bold text-[8px] tracking-[0.14em] uppercase text-[#BD402C] border border-[#BD402C] px-1">
                    Whitespace
                  </span>
                ) : null}
              </th>
              {showState ? <td className={`${CELL} font-body text-sm`}>{d.state_name}</td> : null}
              <td className={NUMBER}>{formatPoor(d.headcount_ratio_2021)}</td>
              <td className={NUMBER}>{d.total_csr_recent.toLocaleString("en-IN", { maximumFractionDigits: 1 })}</td>
              <td className={NUMBER}>{formatRupees(d.district_csr_per_person)}</td>
              <td className={`${NUMBER} !pr-0 font-bold text-[#BD402C]`}>{d.computed_pos.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Metadata for a /csr-spending page: its own canonical and the CSR share card. */
export function spendingMeta(path: string, title: string, description: string, siteUrl: string) {
  const url = `${siteUrl}${path}`;
  const image = { url: "/og/csr-index-4.jpg", width: 1200, height: 630, alt: title };
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: "website" as const, siteName: "Whitespace India", locale: "en_IN", images: [image] },
    twitter: { card: "summary_large_image" as const, title, description, images: [image] },
  };
}
