/**
 * The server's index into the published proposal shards, built before every
 * `next build` and `next dev` (package.json `prebuild` / `predev`).
 *
 * WHY
 * ---
 * The PDF export and the status endpoint need one row of one shard. Read the
 * plain way, that meant parsing the filing State's shard (11 MB for Rajasthan)
 * on every cold server instance. This index lets the server read exactly the
 * bytes it needs. (Proposal pages are assembled in the browser from
 * scripts/instruments/proposal_pages.mjs and do not use it.)
 *
 *   headers.json        each shard's vocabulary (fields, sectors, statuses...)
 *                       without its rows, and the slugs in shard order
 *   ids/<b>.json        id -> [slug index, byte offset, byte length] of its row
 *                       in projects/<slug>.json; b = Number(id) % ID_BUCKETS
 *
 * It is DERIVED from public/data at build time and never committed, so it can
 * never disagree with the shards it was built from in a deployment. Every
 * offset is checked here by re-parsing the bytes it names and comparing them
 * with the parsed row; any mismatch fails the build.
 *
 * `lookup.json` decides which shard answers for an id, as findProposal always
 * did, and the first row carrying that id in that shard is the one indexed.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DATA = path.join(ROOT, "public", "data", "instruments", "consent");
const OUT = path.join(ROOT, ".runtime", "instruments", "consent");
// Must equal ID_BUCKETS in lib/instruments/server.ts (headers.json carries it).
const ID_BUCKETS = 64;

const QUOTE = 0x22, BACKSLASH = 0x5c, COLON = 0x3a;
const OPEN = new Set([0x5b, 0x7b]), CLOSE = new Set([0x5d, 0x7d]);

/** [start, end) byte spans of each element of the top-level "rows" array. */
function rowSpans(buf) {
  const spans = [];
  let depth = 0, inStr = false, esc = false, strStart = -1;
  let lastKeyCandidate = null, key = null, inRows = false, elemStart = -1;
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === BACKSLASH) esc = true;
      else if (c === QUOTE) {
        inStr = false;
        if (depth === 1) lastKeyCandidate = buf.toString("utf8", strStart + 1, i);
      }
      continue;
    }
    if (c === QUOTE) { inStr = true; strStart = i; continue; }
    if (c === COLON && depth === 1) { key = lastKeyCandidate; continue; }
    if (OPEN.has(c)) {
      depth++;
      if (depth === 2 && key === "rows" && c === 0x5b) inRows = true;
      else if (inRows && depth === 3) elemStart = i;
      continue;
    }
    if (CLOSE.has(c)) {
      if (inRows && depth === 3) spans.push([elemStart, i + 1]);
      if (inRows && depth === 2) inRows = false;
      depth--;
    }
  }
  return spans;
}

function writeJson(rel, data) {
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
}

function main() {
  const started = Date.now();
  const lookup = JSON.parse(fs.readFileSync(path.join(DATA, "lookup.json"), "utf-8"));
  const slugs = fs.readdirSync(path.join(DATA, "projects"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();

  fs.rmSync(OUT, { recursive: true, force: true });

  const shards = {};
  const buckets = Array.from({ length: ID_BUCKETS }, () => ({}));
  let indexed = 0;

  slugs.forEach((slug, si) => {
    const buf = fs.readFileSync(path.join(DATA, "projects", `${slug}.json`));
    const parsed = JSON.parse(buf.toString("utf-8"));
    const { rows, ...header } = parsed;
    shards[slug] = header;
    const spans = rowSpans(buf);
    if (spans.length !== rows.length) {
      throw new Error(`${slug}: found ${spans.length} row spans for ${rows.length} rows`);
    }
    const I = (k) => header.fields.indexOf(k);
    const iId = I("id");
    if (iId < 0) throw new Error(`${slug}: shard lacks an id field`);

    const seen = new Set();
    rows.forEach((r, ri) => {
      const [start, end] = spans[ri];
      if (JSON.stringify(JSON.parse(buf.toString("utf8", start, end))) !== JSON.stringify(r)) {
        throw new Error(`${slug}: row ${ri} bytes ${start}-${end} do not re-parse to the row`);
      }
      const id = String(r[iId]);
      if (!seen.has(id) && lookup[id] === slug) {
        buckets[Number(id) % ID_BUCKETS][id] = [si, start, end - start];
        indexed++;
      }
      seen.add(id);
    });
  });

  const unindexed = Object.keys(lookup).filter((id) => !(id in buckets[Number(id) % ID_BUCKETS]));
  writeJson("headers.json", { idBuckets: ID_BUCKETS, slugs, shards });
  buckets.forEach((b, i) => writeJson(`ids/${i}.json`, b));

  console.log(
    `runtime index: ${indexed} ids in ${ID_BUCKETS} buckets, ` +
    `from ${slugs.length} shards in ${Date.now() - started} ms` +
    (unindexed.length ? ` (${unindexed.length} lookup ids have no row in their shard)` : ""),
  );
}

main();
