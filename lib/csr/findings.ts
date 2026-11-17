// Figures the CSR findings cards quote, read from the index's own meta.json so
// a rebuild of the data can never leave the prose behind (the card once typed
// ₹1,436 for Maharashtra while the data said ₹1,446.93).
import csrMeta from "@/public/data/csr/meta.json";

const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export const BIHAR_VS_MAHARASHTRA =
  `Bihar receives ${rupees(csrMeta.state_stats.bihar.csr_per_person_inr)} of CSR spending per person, ` +
  `against ${rupees(csrMeta.state_stats.maharashtra.csr_per_person_inr)} in Maharashtra.`;
