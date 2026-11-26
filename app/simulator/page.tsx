import { redirect } from "next/navigation";

// Served by Cloudflare Pages as a 301 (scripts/cloudflare/assemble.mjs); this
// page answers only where that rule does not run, such as `next start`.
export default function SimulatorPage() {
  redirect("/csr#simulator");
}
