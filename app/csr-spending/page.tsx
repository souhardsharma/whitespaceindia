import Link from "next/link";
import type { Metadata } from "next";
import CsrSpendingPage, { spendingMeta } from "@/components/CsrSpendingPage";
import StructuredData from "@/components/instruments/StructuredData";
import { pageLd } from "@/lib/instruments/metadata";
import {
  CSR_WINDOW,
  RANKED_DISTRICTS,
  STATE_SPENDING,
  formatPoor,
  formatRupees,
} from "@/lib/csr/spending";
import { SITE_URL } from "@/lib/site";

const TITLE = "CSR spending by State and district in India";
const DESCRIPTION = `CSR spending companies reported for each State and UT in India, ${CSR_WINDOW}, set against poverty and broken down for ${RANKED_DISTRICTS.length} districts.`;
const HEAD = "font-label text-[10px] uppercase tracking-[0.2em] py-2.5 pr-4";
const NUMBER = "font-label tabular-nums text-[13px] text-right py-2.5 pr-4 whitespace-nowrap";

export const metadata: Metadata = spendingMeta("/csr-spending", TITLE, DESCRIPTION, SITE_URL);

export default function CsrSpendingIndex() {
  const byPerPerson = [...STATE_SPENDING].sort((a, b) => a.csrPerPerson - b.csrPerPerson);
  const lowest = byPerPerson[0];
  const highest = byPerPerson[byPerPerson.length - 1];
  const whitespaceTotal = STATE_SPENDING.reduce((sum, s) => sum + s.whitespace.length, 0);

  return (
    <CsrSpendingPage
      eyebrow="CSR spending"
      title="CSR spending by State and district in India"
      intro={
        <>
          <p>
            Where has corporate social responsibility money gone, and does it reach the places that need it? This table
            sets the spending companies reported for {CSR_WINDOW} against poverty, State by State. Reported spending per
            person ranges from {formatRupees(lowest.csrPerPerson)} in {lowest.name} to{" "}
            {formatRupees(highest.csrPerPerson)} in {highest.name}.
          </p>
          <p>
            Each State opens to its districts, ranked. Across India,{" "}
            <Link href="/csr-spending/whitespace-districts" className="underline underline-offset-4">
              {whitespaceTotal} districts are whitespaces
            </Link>
            : very poor, and with almost no recorded CSR money.
          </p>
        </>
      }
    >
      <StructuredData
        data={pageLd({ path: "/csr-spending", name: TITLE, description: DESCRIPTION, type: "CollectionPage" })}
      />
      <div className="mt-12 overflow-x-auto border-t border-[#1c1c19]">
        <table className="w-full min-w-[600px] border-collapse">
          <caption className="sr-only">States and UTs with recorded CSR spending and poverty</caption>
          <thead>
            <tr className="border-b border-[#1c1c19] text-left">
              <th scope="col" className={HEAD}>State or UT</th>
              <th scope="col" className={`${HEAD} text-right`}>Districts</th>
              <th scope="col" className={`${HEAD} text-right`}>CSR, ₹ crore</th>
              <th scope="col" className={`${HEAD} text-right`}>CSR per person</th>
              <th scope="col" className={`${HEAD} text-right`}>Poor</th>
              <th scope="col" className={`${HEAD} !pr-0 text-right`}>Whitespaces</th>
            </tr>
          </thead>
          <tbody>
            {STATE_SPENDING.map((state) => (
              <tr key={state.slug} className="border-b border-[#1c1c19]/15">
                <th scope="row" className="py-2.5 pr-4 text-left font-headline font-semibold text-[17px]">
                  <Link href={`/csr-spending/${state.slug}`} className="underline underline-offset-4 decoration-[#1c1c19]/25 hover:text-[#BD402C]">
                    {state.name}
                  </Link>
                </th>
                <td className={NUMBER}>{state.districts.length}</td>
                <td className={NUMBER}>{Math.round(state.csrCrore).toLocaleString("en-IN")}</td>
                <td className={NUMBER}>{formatRupees(state.csrPerPerson)}</td>
                <td className={NUMBER}>{formatPoor(state.poorShare)}</td>
                <td className={`${NUMBER} !pr-0 font-bold text-[#BD402C]`}>{state.whitespace.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CsrSpendingPage>
  );
}
