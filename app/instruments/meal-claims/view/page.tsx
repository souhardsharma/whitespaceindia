import type { Metadata } from "next";
import { InstrumentFooter, InstrumentHeader } from "@/components/instruments/InstrumentChrome";
import SchoolView from "@/components/instruments/meal/SchoolView";
import { MEAL_BASE, MEAL_OG } from "@/lib/instruments/meal";

/**
 * The one static file every school page is served from.
 *
 * next.config.mjs (and _redirects on Pages) rewrite
 * /instruments/meal-claims/school/<code>-<shift> here; SchoolView reads the
 * address and assembles the school from the published bucket files.
 *
 * Unlike Instrument 01's proposal pages, a school page is never indexed, so
 * the shared HTML says noindex outright: it holds for every school, and it
 * does not wait on a script to say so. It names no canonical; SchoolView sets
 * the school's own.
 */

const TITLE = "School | Meal Claims Check";
const DESCRIPTION =
  "One school's daily midday meal reports set against the enrolment it filed, with each day on which the two disagree marked beside its figures.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: {},
  robots: { index: false, follow: true },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
    siteName: "Whitespace India",
    locale: "en_IN",
    images: [{ url: MEAL_OG, width: 1200, height: 630, alt: "Meal Claims Check" }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: MEAL_OG, alt: "Meal Claims Check" }],
  },
};

export default function SchoolShell() {
  return (
    <div className="min-h-screen bg-[#fcf9f4] text-[#1c1c19] flex flex-col">
      <InstrumentHeader crumb="Meal Claims Check" crumbHref={MEAL_BASE} />
      <main id="main-content" className="flex-1 px-6 md:px-12 py-10 md:py-14">
        <div className="max-w-6xl mx-auto">
          <SchoolView />
        </div>
      </main>
      <InstrumentFooter instrument="meal-claims" />
    </div>
  );
}
