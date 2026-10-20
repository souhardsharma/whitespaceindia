import type { MetadataRoute } from "next";
import { shardOnce, stateSlugs } from "@/lib/instruments/server";
import { SITE_URL } from "@/lib/site";

/**
 * One sitemap per filing state, listing every proposal page worth indexing.
 *
 * Served at /instruments/consent/sitemap/<n>.xml and listed in robots.txt. A
 * sitemap holds at most 50,000 URLs; the largest state holds about 20,000, so
 * one per state stays well inside it and a state's file changes only when its
 * proposals do.
 *
 * Only proposals placed in a district are listed - the same rule the page's
 * own robots meta uses. A proposal that could not be placed below state level
 * has no profile to show, and listing it would ask a search engine to index a
 * page that says so. Each URL is dated by the register's own last-modified
 * date where the source gives one, else by its submission date.
 */

const BASE_URL = SITE_URL;

export async function generateSitemaps() {
  return stateSlugs().map((_, id) => ({ id }));
}

export default function sitemap({ id }: { id: number }): MetadataRoute.Sitemap {
  const slug = stateSlugs()[Number(id)];
  const sh = slug ? shardOnce(slug) : null;
  if (!sh) return [];
  const I = (k: string) => sh.fields.indexOf(k);
  const iId = I("id"), iDc = I("dc"), iUpd = I("upd"), iDate = I("date");
  const out: MetadataRoute.Sitemap = [];
  for (const r of sh.rows) {
    if (r[iDc] == null) continue;
    const upd = iUpd >= 0 ? (r[iUpd] as string | null) : null;
    const date = (upd || (r[iDate] as string) || "").slice(0, 10);
    out.push({
      url: `${BASE_URL}/instruments/consent/${r[iId]}`,
      lastModified: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined,
      changeFrequency: "weekly",
      priority: 0.5,
    });
  }
  return out;
}
