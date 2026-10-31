import type { Metadata } from "next";
import Link from "next/link";

// Every unknown address on the site, including a mistyped proposal number
// that does not start with a digit, lands here with a real 404. Without this
// file Next served its bare default page, and the root layout's metadata gave
// it the site's own title and "index, follow" beside the 404's noindex.
export const metadata: Metadata = {
  title: { absolute: "Page not found | Whitespace India" },
  description: "There is no page at this address on Whitespace India.",
  robots: { index: false, follow: true, googleBot: { index: false, follow: true } },
  alternates: { canonical: null },
};

const WAYS = [
  { href: "/", label: "Whitespace India", note: "every index and instrument" },
  { href: "/csr", label: "CSR Opportunity Index", note: "districts ranked by need against CSR spending" },
  { href: "/csr-spending", label: "CSR spending by State", note: "what companies reported, State by State" },
  { href: "/instruments/consent", label: "People & Consent", note: "search the environmental clearance register" },
];

export default function NotFound() {
  return (
    <main className="min-h-screen bg-paper text-ink flex items-center px-4 py-16">
      <section className="mx-auto w-full max-w-xl">
        <p className="font-label text-[12px] uppercase tracking-[0.18em] opacity-70">404</p>
        <h1 className="mt-3 font-headline text-[40px] leading-tight">Page not found</h1>
        <p className="mt-4 font-body text-[16px] leading-relaxed opacity-80">
          There is no page at this address. It may have been mistyped, or the page may have
          moved. A proposal&apos;s address is its number, such as /instruments/consent/1245217402.
        </p>
        <ul className="mt-8 border-t border-ink/15">
          {WAYS.map((w) => (
            <li key={w.href} className="border-b border-ink/15">
              <Link href={w.href} prefetch={false} className="group flex flex-col gap-1 py-4 sm:flex-row sm:items-baseline sm:justify-between">
                <span className="font-headline text-[20px] underline-offset-4 group-hover:underline">{w.label}</span>
                <span className="font-body text-[14px] opacity-70">{w.note}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
