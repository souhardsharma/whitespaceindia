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
  return `${state.name}: ${formatCrore(state.csrCrore)} of CSR spending reported across ${plural(state.districts.length, "district", "districts")}, ${CSR_WINDOW}, set against poverty. Rank, CSR per person and whitespace districts for each.`;
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
            Companies reported {formatCrore(state.csrCrore)} of CSR spending in{" "}
            {plural(state.districts.length, "district", "districts")} of {state.name} over {CSR_WINDOW}, about{" "}
            {formatRupees(state.csrPerPerson)} per person. The median district in India recorded{" "}
            {formatRupees(NATIONAL_MEDIAN_CSR_PER_PERSON)}. Weighted by population, {formatPoor(state.poorShare)} of
            people in {state.name} were in multidimensional poverty in 2019-21.
          </p>
          {state.districts.length > 1 ? (
            <p>
              {largest.total_csr_recent > 0
                ? `The most money was recorded in ${largest.district_name}, at ${formatCrore(largest.total_csr_recent)}. `
                : ""}
              {state.noRecordedSpending > 0
                ? `${plural(state.noRecordedSpending, "district shows", "districts show")} no recorded spending at all. `
                : ""}
              {top.district_name} has the highest opportunity score, ranking {top.rank} of all districts in India.
            </p>
          ) : null}
          <p>
            {state.whitespace.length > 0
              ? `${plural(state.whitespace.length, "district is a whitespace", "districts are whitespaces")}, in the poorest quarter of India's districts and the bottom quarter for CSR per person: ${whitespaceNames}.`
              : `No district here meets the whitespace test of being in the poorest quarter of India's districts and the bottom quarter for CSR per person.`}
            {state.estimatedPopulation > 0
              ? ` Census 2011 has no direct count for ${plural(state.estimatedPopulation, "district", "districts")} here, so population is estimated from the parent districts.`
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
