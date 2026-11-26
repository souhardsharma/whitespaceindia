import type { Metadata } from "next";
import CsrSpendingPage, { DistrictTable, spendingMeta } from "@/components/CsrSpendingPage";
import StructuredData from "@/components/instruments/StructuredData";
import { pageLd } from "@/lib/instruments/metadata";
import { CSR_WINDOW, RANKED_DISTRICTS } from "@/lib/csr/spending";
import { SITE_URL } from "@/lib/site";
import meta from "@/public/data/csr/meta.json";

const WHITESPACES = RANKED_DISTRICTS.filter((d) => d.is_whitespace);
const TITLE = `India's ${WHITESPACES.length} whitespace districts: high poverty, little CSR`;
const DESCRIPTION = `${WHITESPACES.length} Indian districts sit in the poorest quarter of the country and the bottom quarter for reported CSR spending per person, ${CSR_WINDOW}. The full list, by State.`;

export const metadata: Metadata = spendingMeta("/csr-spending/whitespace-districts", TITLE, DESCRIPTION, SITE_URL);

export default function WhitespaceDistricts() {
  const states = Object.entries(meta.whitespace_by_state).sort((a, b) => b[1] - a[1]);
  const [first, second] = states;

  return (
    <CsrSpendingPage
      eyebrow="CSR spending · Whitespace districts"
      title={`India's ${WHITESPACES.length} whitespace districts`}
      intro={
        <>
          <p>
            A whitespace district is one where the need is plain in the record and the money is not. These{" "}
            {WHITESPACES.length} are in the poorest quarter of India&apos;s districts, with at least{" "}
            {meta.whitespace_thresholds.hr_p75_pct.toFixed(2)}% of people in multidimensional poverty, and in the bottom quarter for
            CSR spending per person, at ₹{meta.whitespace_thresholds.csr_p25.toFixed(2)} or less over {CSR_WINDOW}.
          </p>
          <p>
            {first[0]} has {first[1]} of them and {second[0]} {second[1]}. For {meta.csr_not_recorded_whitespace} of
            them the filings place no CSR spending at all in these years. A district on this list deserves a closer look
            before anyone draws a conclusion: money may arrive through channels the filings do not record, or conditions
            may have changed since the data was collected.
          </p>
        </>
      }
    >
      <StructuredData
        data={pageLd({
          path: "/csr-spending/whitespace-districts",
          name: TITLE,
          description: DESCRIPTION,
          trail: [{ name: "CSR spending by State", path: "/csr-spending" }],
        })}
      />
      <DistrictTable districts={WHITESPACES} showState />
    </CsrSpendingPage>
  );
}
