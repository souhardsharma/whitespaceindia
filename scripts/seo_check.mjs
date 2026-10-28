/**
 * What a search engine reads, checked against a running build.
 *
 * usage: node scripts/seo_check.mjs [http://localhost:3000]
 *
 * Every rule here is a failure this site has already shipped:
 * - pages inheriting a parent's canonical, so 620 district pages asked to be
 *   dropped in favour of the shelf, and the landing canonicalised to another
 *   host's CSR page;
 * - a sitemap listing pages the site marks noindex, or URLs that redirect;
 * - one page served at two URLs on two hosts, and pages naming a host the
 *   site has moved away from;
 * - placeholder verticals indexed on synthetic data.
 * Each is silent in the browser, so each is asserted here.
 *
 * Proposal pages are one static file shared by every proposal, which sets its
 * title and canonical in the browser (components/instruments/ProposalView).
 * Their HTML must therefore name NO canonical and carry no noindex - either
 * would apply to all ~92,000 - and the file holding each sampled proposal
 * must be served.
 *
 * The build answers on localhost but names the public origin, so a URL's
 * origin is swapped for the server under test when fetching and compared
 * as published.
 */
const SERVER = (process.argv[2] || "http://localhost:3000").replace(/\/+$/, "");
const PRIMARY = "https://whitespaceindia.pages.dev";
// Hosts the site has moved away from (lib/site.ts MOVED_HOSTS). Each now
// redirects to PRIMARY - Vercel's in its routing layer, which a local build
// does not reproduce, so those rules are tested in lib/__tests__/site.test.ts.
// What is checked here is that no page still names one.
const MOVED = [
  "whitespaceindia.vercel.app",
  "whitespaceindia-csr.vercel.app",
  "csr.whitespaceindia.com",
  "whitespaceindia-backend.onrender.com",
];
const PROPOSAL_SAMPLE = 15;

const failures = [];
const fail = (where, what) => failures.push(`${where}: ${what}`);

const local = (url) => SERVER + new URL(url).pathname + new URL(url).search;

async function get(url) {
  const res = await fetch(local(url), { redirect: "manual" });
  return { status: res.status, location: res.headers.get("location"), body: await res.text() };
}

// A bare origin and the origin with "/" are one URL (RFC 3986 6.2.3); Next
// writes the root canonical without the slash and the sitemap with it.
const same = (a, b) => !!a && !!b && new URL(a).href === new URL(b).href;

const locs = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
const attr = (html, re) => (html.match(re) || [])[1];

function headOf(html) {
  return {
    canonical: attr(html, /<link[^>]+rel="canonical"[^>]+href="([^"]+)"/),
    ogUrl: attr(html, /<meta[^>]+property="og:url"[^>]+content="([^"]+)"/),
    robots: attr(html, /<meta[^>]+name="robots"[^>]+content="([^"]+)"/) || "",
    title: (attr(html, /<title>([^<]*)<\/title>/) || "").trim(),
    titles: (html.match(/<title>/g) || []).length,
    description: attr(html, /<meta[^>]+name="description"[^>]+content="([^"]*)"/),
    h1: (html.match(/<h1[\s>]/g) || []).length,
  };
}

async function checkPage(url, titles) {
  const { status, location, body } = await get(url);
  if (status !== 200) return fail(url, `listed in a sitemap but answered ${status}${location ? ` -> ${location}` : ""}`);
  const h = headOf(body);
  if (!same(h.canonical, url)) fail(url, `canonical is ${h.canonical ?? "missing"}`);
  if (h.ogUrl && !same(h.ogUrl, url)) fail(url, `og:url is ${h.ogUrl}`);
  if (/noindex/i.test(h.robots)) fail(url, "listed in a sitemap but marked noindex");
  if (h.titles !== 1 || !h.title) fail(url, `expected one non-empty <title>, found ${h.titles}`);
  if (!h.description) fail(url, "no meta description");
  if (h.h1 !== 1) fail(url, `expected one <h1>, found ${h.h1}`);
  for (const host of MOVED) if (body.includes(host)) fail(url, `names the moved host ${host}`);
  if (titles) {
    if (titles.has(h.title)) fail(url, `title duplicates ${titles.get(h.title)}`);
    else titles.set(h.title, url);
  }
}

const ROW_BUCKETS = 4096; // lib/instruments/bundle.ts

async function checkProposal(url) {
  const { status, location, body } = await get(url);
  if (status !== 200) return fail(url, `listed in a sitemap but answered ${status}${location ? ` -> ${location}` : ""}`);
  const h = headOf(body);
  if (h.canonical) fail(url, `the shared proposal page names canonical ${h.canonical}`);
  if (h.ogUrl) fail(url, `the shared proposal page names og:url ${h.ogUrl}`);
  if (/noindex/i.test(h.robots)) fail(url, "the shared proposal page is marked noindex");
  if (h.titles !== 1 || !h.title) fail(url, `expected one non-empty <title>, found ${h.titles}`);
  if (!h.description) fail(url, "no meta description");
  for (const host of MOVED) if (body.includes(host)) fail(url, `names the moved host ${host}`);
  const id = new URL(url).pathname.split("/").pop();
  const rows = await get(`${PRIMARY}/view/consent/rows/${Number(id) % ROW_BUCKETS}.json`);
  if (rows.status !== 200 || !(id in JSON.parse(rows.body))) fail(url, "its row file is missing or does not hold it");
}

async function main() {
  const robots = (await get(`${PRIMARY}/robots.txt`)).body;
  const indexUrl = attr(robots, /^Sitemap:\s*(\S+)/m);
  if (indexUrl !== `${PRIMARY}/sitemap-index.xml`) fail("robots.txt", `Sitemap is ${indexUrl ?? "missing"}`);

  const index = locs((await get(`${PRIMARY}/sitemap-index.xml`)).body);
  if (!index.includes(`${PRIMARY}/sitemap.xml`)) fail("sitemap-index.xml", "does not list /sitemap.xml");
  if (index.length < 2) fail("sitemap-index.xml", "lists no proposal sitemaps");
  for (const u of index) if (!u.startsWith(`${PRIMARY}/`)) fail("sitemap-index.xml", `foreign URL ${u}`);

  const pages = locs((await get(`${PRIMARY}/sitemap.xml`)).body);
  if (!pages.includes(`${PRIMARY}/`)) fail("sitemap.xml", "does not list the landing page");
  for (const u of pages) if (!u.startsWith(`${PRIMARY}/`)) fail("sitemap.xml", `foreign URL ${u}`);

  // Every page in the site's own sitemap, with titles unique among them, then
  // a sample from each proposal sitemap that has rows.
  const titles = new Map();
  for (const u of pages) await checkPage(u, titles);
  let sampled = 0;
  for (const s of index.filter((u) => u !== `${PRIMARY}/sitemap.xml`)) {
    const rows = locs((await get(s)).body);
    for (const u of rows.slice(0, 1)) {
      if (sampled++ >= PROPOSAL_SAMPLE) break;
      await checkProposal(u);
    }
  }
  // Only digits are proposals; anything else under the instrument is a 404.
  const stray = await get(`${PRIMARY}/instruments/consent/not-a-proposal`);
  if (stray.status !== 404) fail("/instruments/consent/not-a-proposal", `answered ${stray.status}, not 404`);

  // The placeholder verticals stay out of the index while coming soon.
  for (const p of ["/health", "/energy/about", "/education/methodology"]) {
    const { status, body } = await get(`${PRIMARY}${p}`);
    const listed = pages.includes(`${PRIMARY}${p}`);
    if (status === 200 && !listed && !/noindex/i.test(headOf(body).robots)) {
      fail(p, "neither in the sitemap nor marked noindex");
    }
  }

  console.log(`checked ${pages.length} pages, ${Math.min(sampled, PROPOSAL_SAMPLE)} proposals, ${index.length} sitemaps`);
  if (failures.length) {
    console.error(failures.map((f) => `FAIL ${f}`).join("\n"));
    process.exit(1);
  }
  console.log("seo check passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
