import { notFound } from "next/navigation";
import type { Metadata } from "next";
import CsrSpendingPage, { DistrictTable, spendingMeta } from "@/components/CsrSpendingPage";
import StructuredData from "@/components/instruments/StructuredData";
import { pageLd } from "@/lib/instruments/metadata";
import {
  CSR_WINDOW,
  NATIONAL_MEDIAN_CSR_PER_PERSON,
  STATE_SPENDING,
  formatCrore,
  formatPoor,
  formatRupees,
  type StateSpending,
} from "@/lib/csr/spending";
import { SITE_URL } from "@/lib/site";

export const dynamicParams = false;

export function generateStaticParams() {
  return STATE_SPENDING.map((state) => ({ state: state.slug }));
}

type Params = Promise<{ state: string }>;

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

function describe(state: StateSpending) {
  const one = state.districts.length === 1;
  const spent = state.csrCrore > 0 ? `${formatCrore(state.csrCrore)} of CSR spending reported` : "No CSR spending on record";
  return one
    ? `${state.name}: ${spent}, ${CSR_WINDOW}, set against poverty. Its rank among India's districts, CSR per person and whitespace status.`
    : `${state.name}: ${spent} across ${state.districts.length} districts, ${CSR_WINDOW}, set against poverty. Rank, CSR per person and whitespace status for each district.`;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { state: slug } = await params;
  const state = STATE_SPENDING.find((s) => s.slug === slug);
  if (!state) return {};
  return spendingMeta(`/csr-spending/${slug}`, `CSR spending in ${state.name} by district`, describe(state), SITE_URL);
}

export default async function StateSpendingPage({ params }: { params: Params }) {
  const { state: slug } = await params;
  const state = STATE_SPENDING.find((s) => s.slug === slug);
  if (!state) notFound();

  const top = state.districts[0];
  const largest = state.districts.reduce((a, b) => (b.total_csr_recent > a.total_csr_recent ? b : a));
  const whitespaceNames = state.whitespace.map((d) => d.district_name).join(", ");

  return (
    <CsrSpendingPage
      eyebrow={<>CSR spending · {state.name}</>}
      title={`CSR spending in ${state.name}, by district`}
      intro={
        <>
          <p>
            {state.csrCrore > 0
              ? `Companies reported ${formatCrore(state.csrCrore)} of CSR spending in ${state.name} over ${CSR_WINDOW}, ` +
                `across ${state.districts.length === 1 ? "the one district NITI Aayog's index counts there" : `the ${state.districts.length} districts NITI Aayog's index counts there`}, ` +
                `about ${formatRupees(state.csrPerPerson)} per person.`
              : `The filings record no CSR spending in ${state.name} over ${CSR_WINDOW}.`}{" "}
            The median district in India recorded {formatRupees(NATIONAL_MEDIAN_CSR_PER_PERSON)}.{" "}
            {state.districts.length === 1
              ? `In 2019-21, ${formatPoor(state.poorShare)} of people in ${state.name} were in multidimensional poverty.`
              : `Across the districts of ${state.name}, weighted by their 2011 population, ${formatPoor(state.poorShare)} of people were in multidimensional poverty in 2019-21.`}
          </p>
          {state.districts.length > 1 ? (
            <p>
              {largest.total_csr_recent > 0
                ? `The most money was recorded in ${largest.district_name}, at ${formatCrore(largest.total_csr_recent)}. `
                : ""}
              {state.noRecordedSpending > 0
                ? `The filings place no spending in ${state.noRecordedSpending === 1 ? "one of its districts" : `${state.noRecordedSpending} of its districts`}. `
                : ""}
              {top.district_name} has the highest opportunity score, ranking {top.rank} of all districts in India.
            </p>
          ) : null}
          <p>
            {state.whitespace.length > 0
              ? `The whitespace ${state.whitespace.length === 1 ? "district here is" : `districts here, ${state.whitespace.length} of them, are`} in the poorest quarter of India's districts and the bottom quarter for CSR per person: ${whitespaceNames}.`
              : `No district here meets the whitespace test of being in the poorest quarter of India's districts and the bottom quarter for CSR per person.`}
            {state.estimatedPopulation > 0
              ? ` Census 2011 has no count on today's boundaries for ${plural(state.estimatedPopulation, "district", "districts")} here, so their 2011 population is worked out from the Census figures of the older districts, as the methodology explains.`
              : ""}
          </p>
        </>
      }
    >
      <StructuredData
        data={pageLd({
          path: `/csr-spending/${state.slug}`,
          name: `CSR spending in ${state.name} by district`,
          description: describe(state),
          trail: [{ name: "CSR spending by State", path: "/csr-spending" }],
        })}
      />
      <DistrictTable districts={state.districts} />
    </CsrSpendingPage>
  );
}
