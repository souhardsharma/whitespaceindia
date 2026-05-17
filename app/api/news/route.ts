import { NextResponse } from "next/server";

/* Live CSR-in-India news ticker source.
   ─────────────────────────────────────
   Pulls Google News RSS for an India-CSR query, parses out title /
   source / link / pubDate from the XML, and returns the most recent N
   items as JSON. Cached for 30 minutes server-side via the fetch
   revalidate option, so refreshes happen at most twice an hour.

   No API key required. If the upstream fails (or returns nothing) we
   fall back to an empty array — the client renders a neutral fallback.

   Source query: "CSR India" with India region/locale hint. */

export const revalidate = 1800; // 30 minutes

const FEED_URL =
  "https://news.google.com/rss/search?q=%22CSR%22+India+when:14d&hl=en-IN&gl=IN&ceid=IN:en";

type NewsItem = {
  title: string;
  link: string;
  source: string;
  pubDate: string;
};

/* Strip Google News redirect wrappers and HTML entities; trim trailing
   " - Source Name" patterns that News appends to titles. */
function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();
}

function stripSourceSuffix(title: string): string {
  /* Titles look like: "Headline — Source" or "Headline - Source".
     Trim the suffix if its length is plausibly a source name (≤ 36 chars). */
  const m = title.match(/^(.*?)[—–\-]\s+([^—–\-]{1,36})\s*$/);
  return m ? m[1].trim() : title;
}

function parseRss(xml: string): NewsItem[] {
  const items: NewsItem[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let match: RegExpExecArray | null;
  while ((match = itemRe.exec(xml)) !== null) {
    const block = match[1];
    const tag = (name: string) => {
      const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`).exec(block);
      if (!m) return "";
      let v = m[1];
      const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(v.trim());
      if (cdata) v = cdata[1];
      return decode(v);
    };
    const titleRaw = tag("title");
    const source = tag("source");
    const link = tag("link");
    const pubDate = tag("pubDate");
    if (!titleRaw || !link) continue;
    items.push({
      title: stripSourceSuffix(titleRaw),
      link,
      source: source || "",
      pubDate,
    });
  }
  return items;
}

export async function GET() {
  try {
    const res = await fetch(FEED_URL, {
      next: { revalidate },
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; WhitespaceIndia/1.0; +https://whitespaceindia.vercel.app)",
        Accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
      },
    });
    if (!res.ok) {
      return NextResponse.json({ items: [], error: `upstream ${res.status}` }, { status: 200 });
    }
    const xml = await res.text();
    const items = parseRss(xml).slice(0, 12);
    return NextResponse.json({ items });
  } catch (err) {
    return NextResponse.json(
      { items: [], error: err instanceof Error ? err.message : "unknown" },
      { status: 200 },
    );
  }
}
