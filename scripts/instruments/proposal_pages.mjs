/**
 * The files a proposal page is assembled from in the browser, built before
 * every `next build` and `next dev` (package.json `prebuild` / `predev`).
 *
 * WHY
 * ---
 * A proposal page used to be rendered by a function on every request: ~92,000
 * URLs, ~250 KB of HTML each, and a CDN cache that every nightly data deploy
 * emptied. Crawlers walked the register over and over - 1.5 M ISR writes and
 * then 30 GB of Fast Origin Transfer in a month against the Hobby plan's 10 GB
 * - until Vercel paused the account. No amount of caching fits that on Hobby:
 * one full crawl was ~7 GB of origin transfer on its own.
 *
 * The page is now ONE static file (app/instruments/consent/view, reached by a
 * rewrite of /instruments/consent/<id>) that reads these static files. A
 * static file costs no function, no CPU and no origin transfer. Each file is
 * shared by many proposals, so a page reads a few small files, not a shard:
 *
 *   shards/<slug>.json    a shard's vocabulary (fields, sectors, statuses...)
 *   rows/<b>.json         id -> { s: slug, r: row, e: [kind, date, sk][] },
 *                         b = Number(id) % ROW_BUCKETS; `e` is the proposal's
 *                         own steps in the change log's window, newest first
 *   districts/<code>.json { record, geo: [file order, feature] | null, det }
 *   subdistricts/<b>.json code -> record, b = Number(code) % SUB_BUCKETS
 *   near/<a>_<b>.json     every mapped site in a quarter-degree cell:
 *                         [order, id, slug, lat, lon, no, name, sector, sk]
 *   legal.json            the legal reference without its determinations
 *   changes.json          the change log's window and basis
 *
 * lib/instruments/bundle.ts reads them and must use the same bucket counts and
 * cell size. Everything here is DERIVED from public/data in the same build and
 * git-ignored, so it can never describe other data than the deployment holds.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DATA = path.join(ROOT, "public", "data", "instruments", "consent");
const OUT = path.join(ROOT, "public", "view", "consent");
// Must equal the constants of the same names in lib/instruments/bundle.ts.
const ROW_BUCKETS = 4096;
const SUB_BUCKETS = 256;
const CELLS_PER_DEGREE = 4;
// Nearby names are shown cut to 140 characters (NearbyProposals); the cut is
// made here so a dense cell does not carry names nobody reads.
const NEAR_NAME_MAX = 140;

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf-8"));
const readData = (rel) => readJson(path.join(DATA, rel));
const readDataOrNull = (rel) => (fs.existsSync(path.join(DATA, rel)) ? readData(rel) : null);

function writeJson(rel, data) {
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
}

function cutName(name) {
  return name.length > NEAR_NAME_MAX ? name.slice(0, NEAR_NAME_MAX - 3).replace(/\s+\S*$/, "") + "…" : name;
}

/** Each published proposal's own change-log steps inside the log's window. */
function eventsById(changes) {
  const out = new Map();
  if (!changes) return out;
  for (const [kind, date, id, sk] of changes.rows) {
    if (date < changes.window.from) continue;
    if (!out.has(id)) out.set(id, []);
    out.get(id).push([kind, date, sk]);
  }
  return out;
}

function main() {
  const started = Date.now();
  const lookup = readData("lookup.json");
  const changes = readDataOrNull("changes/recent.json");
  const events = eventsById(changes);
  const slugs = fs.readdirSync(path.join(DATA, "projects"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();

  fs.rmSync(OUT, { recursive: true, force: true });

  const rows = Array.from({ length: ROW_BUCKETS }, () => ({}));
  const cells = new Map();
  let order = 0, published = 0;

  for (const slug of slugs) {
    const { rows: shardRows, ...header } = readData(`projects/${slug}.json`);
    writeJson(`shards/${slug}.json`, header);
    const I = (k) => header.fields.indexOf(k);
    const at = { id: I("id"), lat: I("lat"), lon: I("lon"), no: I("no"), name: I("name"), sector: I("sector"), sk: I("sk") };
    if (at.id < 0 || at.lat < 0 || at.lon < 0) throw new Error(`${slug}: shard lacks id/lat/lon fields`);

    const seen = new Set();
    for (const r of shardRows) {
      const id = String(r[at.id]);
      // lookup.json names the shard that answers for an id, and the first row
      // carrying it there is the one published - as the server's index did.
      if (!seen.has(id) && lookup[id] === slug) {
        rows[Number(id) % ROW_BUCKETS][id] = { s: slug, r, e: events.get(id) ?? [] };
        published++;
      }
      seen.add(id);
      // Every mapped row is a neighbour, in register order across the shards.
      const lat = r[at.lat], lon = r[at.lon];
      if (lat == null || lon == null) continue;
      const cell = `${Math.floor(lat * CELLS_PER_DEGREE)}_${Math.floor(lon * CELLS_PER_DEGREE)}`;
      if (!cells.has(cell)) cells.set(cell, []);
      cells.get(cell).push([
        order++, id, slug, lat, lon, String(r[at.no] ?? ""), cutName(String(r[at.name] ?? "")),
        header.sectors[r[at.sector]] ?? "", r[at.sk] ?? null,
      ]);
    }
  }
  rows.forEach((b, i) => writeJson(`rows/${i}.json`, b));
  // A proposal page asks for every cell its 10 km search box touches
  // (nearCells in lib/instruments/bundle.ts, mirrored here). A cell holding no
  // site is written empty, so that ask is an answer and not a 404.
  for (const points of [...cells.values()]) {
    for (const [, , , lat, lon] of points) {
      const dLat = 10 / 110, dLon = 10 / (110 * Math.cos((Math.abs(lat) + 1) * Math.PI / 180));
      for (let a = Math.floor((lat - dLat) * CELLS_PER_DEGREE); a <= Math.floor((lat + dLat) * CELLS_PER_DEGREE); a++) {
        for (let b = Math.floor((lon - dLon) * CELLS_PER_DEGREE); b <= Math.floor((lon + dLon) * CELLS_PER_DEGREE); b++) {
          if (!cells.has(`${a}_${b}`)) cells.set(`${a}_${b}`, []);
        }
      }
    }
  }
  for (const [cell, points] of cells) writeJson(`near/${cell}.json`, points);

  const districts = readData("districts.json");
  const legal = readDataOrNull("legal_reference.json");
  const determinations = legal?.determinations ?? {};
  const geo = readJson(path.join(ROOT, "public", "geo", "districts-2011.geojson")).features;
  const geoByCode = new Map(geo.map((f, i) => [String(Number(f.id)), [i, {
    type: f.type, id: Number(f.id), properties: f.properties ?? {}, geometry: f.geometry,
  }]]));
  const codes = new Set([...Object.keys(districts), ...geoByCode.keys(), ...Object.keys(determinations)]);
  for (const code of codes) {
    writeJson(`districts/${code}.json`, {
      record: districts[code] ?? null,
      geo: geoByCode.get(code) ?? null,
      ...(code in determinations ? { det: determinations[code] } : {}),
    });
  }

  const subRaw = readData("subdistricts.json");
  const subs = subRaw.subdistricts && typeof subRaw.subdistricts === "object" ? subRaw.subdistricts : subRaw;
  const subBuckets = Array.from({ length: SUB_BUCKETS }, () => ({}));
  for (const [code, rec] of Object.entries(subs)) subBuckets[Number(code) % SUB_BUCKETS][code] = rec;
  subBuckets.forEach((b, i) => writeJson(`subdistricts/${i}.json`, b));

  if (legal) {
    const { determinations: _omit, ...header } = legal;
    writeJson("legal.json", header);
  } else {
    writeJson("legal.json", null);
  }
  writeJson("changes.json", changes ? { window: changes.window, basis: changes.basis } : null);

  const unpublished = Object.keys(lookup).filter((id) => !(id in rows[Number(id) % ROW_BUCKETS]));
  console.log(
    `proposal pages: ${published} proposals in ${ROW_BUCKETS} row files, ${order} mapped sites in ` +
    `${cells.size} cells, ${codes.size} districts, from ${slugs.length} shards in ${Date.now() - started} ms` +
    (unpublished.length ? ` (${unpublished.length} lookup ids have no row in their shard)` : ""),
  );
}

main();
