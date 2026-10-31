import { execSync } from "node:child_process";
import { MetadataRoute } from "next";
import registerDistricts from "@/public/data/instruments/consent/register/districts.json";
import freshness from "@/public/data/instruments/consent/freshness.json";
import { SITE_URL } from "@/lib/site";
import { healthConfig } from "@/lib/health/config";
import { energyConfig } from "@/lib/energy/config";
import { educationConfig } from "@/lib/education/config";
import { CSR_STATES, stateSlug } from "@/lib/csr/states";

const BASE_URL = SITE_URL;

/**
 * lastModified should be stable per-deployment. We prefer the commit author
 * date (set automatically by Vercel) so the sitemap only changes when the
 * underlying content actually changed. Falling back to "now" on every render
 * causes Google to discount the freshness signal — every page would always
 * look "just updated", which is a known low-quality pattern.
 */
const LAST_MODIFIED = (() => {
  const raw =
    process.env.VERCEL_GIT_COMMIT_AUTHOR_DATE ||
    process.env.NEXT_PUBLIC_BUILD_TIME;
  if (raw) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  // Cloudflare Pages names no commit date in its environment; ask git for the
  // last commit that touched what these pages show.
  try {
    const committed = execSync("git log -1 --format=%cI -- app components lib/csr public/data/csr", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const d = new Date(committed);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  } catch {
    // No git in this build: fall through to the build time.
  }
  return new Date().toISOString();
})();

/**
 * When the register was last read.
 *
 * The instrument's pages are rebuilt nightly from the register and genuinely
 * change; the marketing and vertical pages do not. Giving all 642 URLs one
 * build-instant `lastModified` re-declares /about, /reports and the twelve
 * health/energy/education pages as freshly modified on every sync deploy,
 * which is the "everything always looks just updated" pattern this file's own
 * comment warns against. Register-derived URLs get the read time; everything
 * else keeps the commit date, which only moves when its content does.
 */
const REGISTER_READ_AT = (() => {
  const raw = (freshness as { checked_at?: string }).checked_at;
  if (raw) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return LAST_MODIFIED;
})();

export default function sitemap(): MetadataRoute.Sitemap {
  // Priority is relative within this sitemap, not absolute. The CSR app and
  // landing are top-tier (real, fully-built pages); methodology/about are
  // secondary anchors; reports is a roadmap page; the placeholder verticals
  // are listed only once they are live (see verticalPages()).
  return [
    {
      url: `${BASE_URL}/`,
      lastModified: LAST_MODIFIED,
      changeFrequency: "monthly",
      priority: 1.0,
    },
    {
      url: `${BASE_URL}/csr`,
      lastModified: LAST_MODIFIED,
      changeFrequency: "monthly",
      priority: 0.95,
    },
    {
      url: `${BASE_URL}/csr-spending`,
      lastModified: LAST_MODIFIED,
      changeFrequency: "monthly",
      priority: 0.9,
    },
    {
      url: `${BASE_URL}/csr-spending/whitespace-districts`,
      lastModified: LAST_MODIFIED,
      changeFrequency: "monthly",
      priority: 0.85,
    },
    ...CSR_STATES.map((state) => ({
      url: `${BASE_URL}/csr-spending/${stateSlug(state)}`,
      lastModified: LAST_MODIFIED,
      changeFrequency: "monthly" as const,
      priority: 0.75,
    })),
    {
      url: `${BASE_URL}/instruments`,
      lastModified: LAST_MODIFIED,
      changeFrequency: "monthly",
      priority: 0.9,
    },
    // Instrument 01's own surfaces. Each is a distinct page a reader can land
    // on and each is generated from the register, so leaving them out of the
    // sitemap means the only pages that carry the live data are the ones a
    // crawler never sees. The district pages are appended after this list.
    {
      url: `${BASE_URL}/instruments/consent`,
      lastModified: REGISTER_READ_AT,
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: `${BASE_URL}/instruments/consent/register`,
      lastModified: REGISTER_READ_AT,
      changeFrequency: "daily",
      priority: 0.85,
    },
    {
      url: `${BASE_URL}/instruments/consent/appraisal`,
      lastModified: REGISTER_READ_AT,
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/instruments/consent/methodology`,
      lastModified: LAST_MODIFIED,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${BASE_URL}/instruments/consent/latest`,
      lastModified: REGISTER_READ_AT,
      changeFrequency: "daily",
      priority: 0.75,
    },
    {
      url: `${BASE_URL}/instruments/consent/data`,
      lastModified: REGISTER_READ_AT,
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      url: `${BASE_URL}/methodology`,
      lastModified: LAST_MODIFIED,
      changeFrequency: "monthly",
      priority: 0.85,
    },
    {
      url: `${BASE_URL}/about`,
      lastModified: LAST_MODIFIED,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/reports`,
      lastModified: LAST_MODIFIED,
      changeFrequency: "weekly",
      priority: 0.7,
    },
    ...verticalPages(),
    ...districtPages(),
  ];
}

/**
 * One entry per generated district page.
 *
 * These are the pages the instrument exists to publish - "what is proposed in
 * this district, and who lives there" is the question the source register
 * cannot answer - and there are 620 of them against seven hand-written URLs
 * above. Omitting them left the sitemap describing the shelf and the shelf's
 * signposts while every page carrying the actual register was invisible to a
 * crawler, reachable only by following links from the register table.
 *
 * Generated from the SAME file `generateStaticParams` uses, and filtered by
 * the same `n > 0` condition, so the sitemap cannot list a page the build did
 * not generate or omit one it did. Deriving it from a second source - a range
 * of 1..640, say - would drift the moment a district stopped carrying
 * proposals, and would advertise 20 URLs that return 404.
 */
function districtPages(): MetadataRoute.Sitemap {
  const rows = registerDistricts as unknown as { code: number; n: number }[];
  return rows
    .filter((r) => r.n > 0)
    .map((r) => ({
      url: `${BASE_URL}/instruments/consent/district/${r.code}`,
      lastModified: REGISTER_READ_AT,
      // The register is re-read nightly and these pages are rebuilt from it.
      changeFrequency: "daily" as const,
      // Below the instrument's own surfaces, above the placeholder verticals:
      // each is a real page with live data, but one of 620 rather than an
      // entry point a reader would search for by name.
      priority: 0.6,
    }));
}

/**
 * The Health, Energy and Education indexes, each with its three sub-pages,
 * once that vertical is live.
 *
 * While `comingSoon` is set they run on synthetic placeholder data behind an
 * overlay, and their layouts say noindex (a ranking of districts on invented
 * numbers must not be served as a search result). A sitemap that listed them
 * asked for pages the site itself refuses to have indexed; Search Console
 * carried them as "Discovered - currently not indexed". Setting
 * `comingSoon: false` lists them and lifts the noindex together.
 */
function verticalPages(): MetadataRoute.Sitemap {
  return [healthConfig, energyConfig, educationConfig]
    .filter((v) => !v.comingSoon)
    .flatMap((v) => [
      { path: `/${v.slug}`, priority: 0.85 },
      { path: `/${v.slug}/about`, priority: 0.6 },
      { path: `/${v.slug}/methodology`, priority: 0.6 },
      { path: `/${v.slug}/reports`, priority: 0.5 },
    ])
    .map(({ path, priority }) => ({
      url: `${BASE_URL}${path}`,
      lastModified: LAST_MODIFIED,
      changeFrequency: "monthly" as const,
      priority,
    }));
}
