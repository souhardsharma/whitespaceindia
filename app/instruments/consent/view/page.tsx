import type { Metadata } from "next";
import {
  InstrumentFooter,
  InstrumentHeader,
} from "@/components/instruments/InstrumentChrome";
import ProposalView from "@/components/instruments/ProposalView";

/**
 * The one static file every proposal page is served from.
 *
 * next.config.mjs rewrites /instruments/consent/<digits> here, and
 * ProposalView reads the id from the address and assembles the proposal in
 * the browser from static files (scripts/instruments/proposal_pages.mjs).
 * ~92,000 proposals rendered on demand by a function, for crawlers, used up
 * the Hobby plan's origin transfer twice over in a month; a static file costs
 * none.
 *
 * The metadata is shared by every proposal, so it names no canonical URL (the
 * layout's would make all of them claim to be /instruments) and no og:url;
 * ProposalView sets the proposal's own title, description and canonical once
 * it has read it. It is NOT noindex: that would apply to every proposal.
 */

const TITLE = "Proposal | People & Consent";
const DESCRIPTION =
  "One environmental clearance proposal from India's PARIVESH register: who lives where it would be built, and which duties of consultation and consent apply there.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: {},
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
    siteName: "Whitespace India",
    locale: "en_IN",
    images: [{ url: "/og/consent-4.jpg", width: 1200, height: 630, alt: TITLE }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: "/og/consent-4.jpg", alt: TITLE }],
  },
};

export default function ProposalShell() {
  return (
    <div className="min-h-screen bg-[#fcf9f4] text-[#1c1c19] flex flex-col">
      <InstrumentHeader crumb="People & Consent" crumbHref="/instruments/consent" />
      <main id="main-content" className="flex-1 px-6 md:px-12 py-10 md:py-14">
        <div className="max-w-6xl mx-auto">
          <ProposalView />
        </div>
      </main>
      <InstrumentFooter />
    </div>
  );
}
