/**
 * Page identity for the instrument routes.
 *
 * WHY THIS EXISTS
 * ---------------
 * `app/instruments/layout.tsx` sets `alternates.canonical` and `openGraph.url`
 * to `/instruments`, and Next merges layout metadata into every route beneath
 * it. A page that sets neither therefore inherits both - so all 626 instrument
 * pages declared themselves canonical to `/instruments` and shared one
 * `og:url`. Measured on the built site: the register, the appraisal page, the
 * methodology page and all 620 district pages emitted
 * `<link rel="canonical" href=".../instruments">`.
 *
 * That is not a cosmetic tag. A canonical is a statement to a search engine
 * that THIS page is a duplicate of THAT one, so the 620 district pages - the
 * whole point of publishing a per-district view of the register - asked to be
 * dropped from the index in favour of a shelf page that lists none of their
 * content. The shared `og:url` has the same effect on anything that unfurls a
 * link: a reader sharing Datia's page previews the instruments shelf.
 *
 * Every route below `/instruments` must therefore name itself. This builds
 * that block from one place so a new page cannot quietly inherit the wrong
 * identity by saying nothing - the failure mode is silent, and it looks
 * exactly like a page with no metadata problem at all.
 */

import { SITE_URL } from "@/lib/site";

const OG_IMAGE = "/og/consent-4.jpg";

export interface PageMetaInput {
  /** Absolute path from the site root, e.g. "/instruments/consent/register". */
  path: string;
  title: string;
  description: string;
  /** False for per-proposal pages, which are generated on demand. */
  index?: boolean;
}

export function pageMeta({
  path,
  title,
  description,
  index = true,
}: PageMetaInput) {
  const url = `${SITE_URL}${path}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      type: "website" as const,
      siteName: "Whitespace India",
      locale: "en_IN",
      images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: "summary_large_image" as const,
      title,
      description,
      images: [{ url: OG_IMAGE, alt: title }],
    },
    // A page generated on demand for any of 89,817 proposals is not something
    // to put in an index; it stays followable so the register still leads a
    // crawler to the district pages, which are.
    ...(index ? {} : { robots: { index: false, follow: true } }),
  };
}

/**
 * Structured data for ONE page.
 *
 * `app/instruments/layout.tsx` used to inject a single `CollectionPage` for
 * the shelf, plus a breadcrumb ending at `/instruments`, into every route
 * beneath it. Measured on the built site, all 626 instrument pages emitted
 * `"@type":"CollectionPage"` with `url: /instruments` and a two-item trail
 * terminating there - so Datia's district page told a crawler it WAS the
 * Instruments shelf, while the `<link rel="canonical">` beside it said
 * otherwise. The two disagreed on every page but one.
 *
 * A breadcrumb is a claim about where a page sits, so it is built from the
 * page's own trail and its last item is the page itself.
 */
export function pageLd({
  path,
  name,
  description,
  trail = [],
  type = "WebPage",
}: {
  path: string;
  name: string;
  description: string;
  /** Ancestors between the site root and this page, nearest root first. */
  trail?: { name: string; path: string }[];
  /** "CollectionPage" for a page that lists other pages. */
  type?: "WebPage" | "CollectionPage";
}) {
  const url = `${SITE_URL}${path}`;
  const items = [
    { name: "Whitespace India", path: "/" },
    ...trail,
    { name, path },
  ];
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": type,
        "@id": `${url}#page`,
        url,
        name,
        description,
        isPartOf: { "@id": `${SITE_URL}/#site` },
        inLanguage: "en-IN",
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: items.map((it, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: it.name,
          item: `${SITE_URL}${it.path}`,
        })),
      },
    ],
  };
}
