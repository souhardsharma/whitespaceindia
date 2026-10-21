# Instrument 01 "People & Consent" - engineering reference

The instrument's engineering rules: what the pipeline and the pages promise,
why each rule exists, and the data traps that have already cost time. When a
rule changes in code, change it here in the same commit. As of 2026-10-20.

## Commit-day checklist (the steps that need a push)

1. Publish the cache seed once: `INSTRUMENTS_CACHE_DIR=... python
   scripts/instruments/cache_seed.py pack --out instruments-cache-seed.tar.gz`,
   then create the release `instruments-cache-seed` and attach the file as
   `instruments-cache-seed.tar.gz`.
2. Merge to `main` - GitHub fires schedules only from the default branch.
3. Run "Sync Instrument 01 data" once by hand (workflow_dispatch) and confirm
   `public/data/instruments/consent/freshness.json` advances.
4. Optionally set the repository variable `INSTRUMENTS_SEED_REFRESH=true` so
   the seed is re-packed every Monday.

## Instruments are not verticals

There are two species of page on this site and conflating them will cause real damage.

**Indexes** (`/csr`, `/health`, `/energy`, `/education`) are cross-sectional. They rank all districts on one question, are driven by a `VerticalConfig`, and share the index-shaped components (Hero, IndiaMap, RankingList, WeightsPanel, HowItWorks).

**Instruments** (`/instruments/*`) are per-entity. One case in, one profile out. No score, no normalisation, no weighting, no ranking.

```
app/instruments/            page.tsx (the shelf), layout.tsx (metadata + OG)
  consent/                  Instrument 01 - "People & Consent"
    [proposalId]/           one proposal, server-rendered from lib/instruments/server.ts
    latest/                 what moved in the register (the change log)
    data/                   every published file and endpoint, documented
    feed/                   Atom feed of the change log, under the page's filters
    sitemap.ts              one sitemap per filing state, located proposals only
app/api/instruments/consent/   search, status, changes, changes.csv,
                            proposals.csv, export (PDF)
components/instruments/     InstrumentChrome.tsx (header + footer), and the
                            rest of the instrument's components
lib/instruments/server.ts   SERVER ONLY. Reads public/data with fs, caches per
                            process; proposal bundles, national index, change log
lib/instruments/location.ts the one wording of "where this project is"
lib/instruments/place.ts    present-day State names for Census 2011 districts
lib/instruments/links.ts    the one wording of the other clearances (screen + PDF)
lib/instruments/csv.ts      CSV downloads in parts (Vercel's 4.5 MB response cap)
scripts/instruments/
  build_data.py             the pipeline. Reads the cache, writes public/data.
  district_resolution.py    name -> Census 2011 district, with the alias table
  location.py               CAF codes -> Census 2011 district/sub-district
  measures.py               registry: what a Census number MEANS
  stages.py                 registry: what a proposal's POSITION means
  appraisal.py              how long clearance took, from the workflow history
  geometry.py               Census 2011 boundaries; where a project actually is
  privacy.py                what is removed from a public record, and why
  net.py                    how hard to lean on the source, and where to go
                            when a route dies. Every fetcher goes through it.
  refresh_proxies.py        rebuilds the pool of routes that can reach PARIVESH
  fetch_caf.py              backfill: filed location and site coordinates
  fetch_process_history.py  backfill: the dated appraisal history
  legal_reference.py        Presidential Orders, transcribed and cited
  build_register_index.py   the per-district index the register pages read
  sync.py                   the scheduled run: full sweep, forest register,
                            budgeted passes, candidate build, contract, promote
  build_changes.py          the change log (changes/recent.json)
  cache_seed.py             pack/verify/unpack the per-proposal cache seed
  rehearse_sync.py          replays the nightly workflow locally from cold
  fetch_parallel.py         N sharded fetch_caf processes (the CPU ceiling)
  run_lock.py               one process against PARIVESH per machine
  links.py                  `lk`: unread / answered none / left blank
  forest_numbers.py         FP/... numbers normalised, for every reader
  check_published.py        the published-data contract (285 assertions)
  test_district_resolution.py / test_geometry.py / test_net.py / test_sync.py
                            the four unit suites
  crosscheck_location.py    advisory: our district vs the regulator's letter
  join_csr_master.py        plan 6.3's third join, measured into the
                            verification report; feeds nothing yet
public/data/instruments/consent/   meta, measures, stages, appraisal, districts,
                            subdistricts, legal_reference, index, lookup,
                            projects/<state>.json, register/ (districts,
                            facets, forest), changes/recent.json, freshness
```

Rules, in order of how expensive they are to get wrong:

1. **Never register an instrument in `lib/verticals/registry.ts`** and never write a `VerticalConfig` for one. An instrument has no dimensions, no weight presets and no ranked districts, so a config for it would be a lie that later code will believe.
2. **Do not reuse `Navbar` or `Footer` on instrument pages.** Both derive their links from a vertical slug and silently fall back to CSR, so an instrument page rendered with them shows CSR navigation. Use `components/instruments/InstrumentChrome.tsx`.
3. **The landing tile is a visual peer but an architectural stranger.** Tile 05 uses the same tile markup, frame, numbering and eyebrow grammar as tiles 02-04. That uniformity is deliberate and says nothing about the code underneath.
4. **No number reaches the UI as prose.** Values live in `districts.json`; their definition, formula, source and vintage live once in `measures.json`. The interface joins the two at render time. A benchmark and the value it judges must resolve to the same registry entry, which is what makes a denominator mismatch structurally impossible rather than a thing a reviewer has to catch. `check_published.py` compares every published measure against `measures.py` field by field, because *resolving* to a registry entry and resolving to the *right* one are different claims.
5. **No position reaches the UI as raw text either.** The register writes one stage several ways - "ToR Granted", "TOR Granted", "TOR GRANTED", "TOR GRanted" across 10,112 proposals, of which the commonest spelling covers half. `stages.py` maps every spelling to one canonical key; shards carry the key in `sk` and the raw string in `status`. Filter and count through `sk` or they will disagree. An unknown status resolves to `unclassified` and is never folded into a neighbour; past `UNCLASSIFIED_LIMIT` the build fails rather than publish a vocabulary it cannot name.
6. **A duration must be reachable from the dates beside it.** Shards publish `fon` (first filing), `don` (decision) and `dsu` (days the portal had the proposal delisted), and `fon + dtd + dsu == don` holds exactly on every decided row. The register's own `dateOfSubmission` is a *different* date - it moves forward on re-submission and disagrees for a third of the register - so it is published as `date` and never measured from.
7. **Not-yet-read and not-there are different silences.** Half a million rows
   of "location unknown" mean nothing until you can say whose gap it is.
   Shards carry `cf`: `ok` the regulator's form was read and placed the
   proposal, `nogeo` it was read and names no place, `none` the regulator
   answered and serves no form at all (268 proposals, HTTP 500), `pend` we
   have not read it yet. Only an HTTP answer earns `none`; a request that
   failed in transport (160 of them) never heard from the service and stays
   `pend`, because publishing it otherwise would put our own network trouble
   in the government's mouth. The sync adds proposals daily and fetches their forms after,
   so there is always a young `pend` cohort - without the distinction it reads
   as government non-disclosure, and today it would have reported 49% of the
   register that way. `meta.caf_coverage` carries the four totals;
   `check_published.py` asserts they match the rows and that no row claims a
   form it did not use.

   **There are two resolution rates and they are not interchangeable.**
   `resolution_rate_pct` is over the whole register and moves with backfill
   progress - it read 71.78% mid-backfill and 99.59% complete, for identical
   code. `resolution_rate_of_read_pct` is over the proposals whose form was
   actually read, and read 99.64% and 99.59% at those same two moments. Quote
   the first as "how much of the register is placed"; quote the second as
   "how well the instrument places what it reads". A floor on the first either
   fires constantly or never, so `READ_RESOLUTION_FLOOR` gates the second, and
   a build that falls under it writes nothing.

8. **A filing states its place three times, and the three are reconciled.**
   The place codes on its plots, the district it declares (`dd`, from the
   form's `mainDistrict` - NOT the plot `dc`, which crosswalks to the wrong
   district for some states), and the district its coordinates fall in
   (`gd`). `location.adjudicate()` moves a proposal only when the declared
   district and the coordinates agree against the codes (method `a`), and a
   town code that spans districts (`TOWN_SPANS`; Greater Mumbai 802794 is in
   both Mumbai and Mumbai Suburban) is settled by coordinates or declaration
   (method `c`). No majority means `contested`, and nothing moves. Only the
   primary district is replaced; the others a filing names stay. LGD
   crosswalk targets outside the 640-code Census frame (Gariyaband's "645")
   are dropped - validate against the GAZETTEER, never against SHRUG's
   district names, which lack the wholly urban districts. Wording comes from
   `lib/instruments/location.ts`: a statement never corroborates itself and
   `boundary` is never agreement.
9. **A district drawn after an Order is decided by territorial containment.**
   `SUCCESSOR_DISTRICTS` gives each an outcome - `within` (carved wholly from
   a district the Order names wholly), `partial`, or `outside` - and every
   outcome is checked against the Ministry of Panchayati Raj list both ways.
   Andhra Pradesh and Telangana are read from C.O. 9 and C.O. 26. Only a
   genuine conflict between two official sources (Garhwa) is `not_determined`.
   `SUBDIVISION_ALIASES` are normalised on BOTH sides; every alias target must
   exist in the Census frame (asserted), because a dead alias silently drops a
   scheduled tehsil.
10. **An unread cross-reference is not a declared absence, and a blank is
   not a "no".** `lk` is `null` when the form has not been read at
   `EXTRACT_VERSION` 4; `0` ONLY when the form answered all five questions
   (forest clearance, wildlife board, eco-sensitive zone, protected area,
   coastal zone) and declared nothing; otherwise an object, whose `u` lists
   the questions left BLANK. Nearly half the forms read leave all five blank,
   and publishing those as 0 told readers the forest rules did not apply. The
   forest-land trigger says "no" only when the land breakup and `lk` were both
   read, neither declares forest, and `u` does not contain `f`. `lk.a` (the
   land breakup's additional forest) has NO unit - never print it as hectares
   and never add it to `f[2]`, which is hectares.
11. **The change log is dated by the register's own history**, not by when a
   sync noticed. Moves, queries and closures by the step's START; filings and
   decisions by its END, as `appraisal.py` dates them, and a proposal's first
   filing is exactly its `fon` (asserted). Each row's `seen` indexes `stamps`,
   the BUILD in which the event first appeared - a follower stores `stamp`
   and asks `after=<stamp>` for news, because a step recorded late is dated
   before the last visit. Counting by date, or subtracting counts, misses or
   hides news. It is the build time, not the register read time: a rebuild
   that did not re-read (every sector failed, a manual rebuild) can still add
   events, and a read time the follower already stored would hide them.
12. **A forest proposal is counted once.** Several EC filings name one FP
   number; district hectares key on the normalised number
   (`forest_numbers.fp_numbers`, mirrored by `fpNumbers` in links.ts) and take
   the largest area stated. The forest register is joined on the same
   normalisation - matched raw, half the named numbers were never found.

### Keeping it current

**Starting from nothing.** A cold runner has no application forms, and reading
~116,000 of them takes hours, and PARIVESH refuses GitHub's runners at
connect, so the register, the LGD reference and the forest register arrive
only partly, through proxies, or not at all (2026-10-20: 9 of 10 sectors, 1 of
38 forest States, no LGD, and the build stopped). Every night, before any
fetch, the workflow MERGES a verified seed (`cache_seed.py`, release asset
`instruments-cache-seed`) under what it has read: forms and histories by id,
register rows by proposal id, forest States and LGD files only where absent,
a seeded State keeping the seed's read date. Never "only if empty" or "only
if cold": the first rule skipped the seed for ever after one seedless night,
and the second skipped it after a night whose forms were warm but whose LGD
reference never arrived. The seed's register and forest copies are raw
answers, so every string is passed through `scrub_contact` when packed. `verify` checks
every record equals its whitelist-cleaned self at every depth and scans with
`privacy.find_contact` (labelled numbers with separators included).

**Budget.** `sync.py --budget-minutes 190` inside the 240-minute job (50
inside 90 until 2026-10-21: through proxies a history reads at ~1/s, so
the weekly re-read of open proposals never ran, and the forest got a few
States). A refresher rebuilds the proxy pool every 15 minutes while it
runs, because most free proxies die within two hours. It
reserves `REBUILD_RESERVE_S` (12 min) for its own rebuild and contract, and
`PASS_PLAN` gives each per-proposal pass a SHARE of what is left, changed
passes first for both sources. When the CAF bulk pass took everything, an
`EXTRACT_VERSION` bump starved the history passes for ten nights. The
deadline reaches inside retries (`net.get(deadline=)`): a request past it is
never sent and returns `DEADLINE_BODY`, which fetchers count as owed, not as
an error. The register and forest sweeps are bounded too, the forest sweep
to a quarter of the time left. Fetchers exit 3 when out of time and 2 when
aborted; `build_data.py` refuses to publish when more than `UNREAD_CEILING`
(3%) of the register is unread.

**One run at a time.** `run_lock.py` holds a machine-wide lock (temp dir)
for sync, both fetchers, the rehearsal, `crosscheck_location.py` and
`build_data.py --fetch`; children inherit it through
`INSTRUMENTS_LOCK_HELD`. A lock whose process is gone is cleared. On Windows
the liveness probe asks the kernel - `os.kill(pid, 0)` there TERMINATES.
Taking the lock is atomic: an OS byte lock on the sidecar `<lock>.os`
(`msvcrt.locking` / `flock`), released by the kernel when the holder dies, so
two starters can no longer both see a stale file, both clear it and both run.
The JSON file stays for humans and for an older holder. A child that
inherited the lock watches its holder (`watch_holder`) and exits 2 when the
holder or its own parent dies - otherwise a killed sync left shards still
reading PARIVESH with no lock anyone could see.

**The sync never writes public/ directly.** It builds into
`<cache>/candidate`, runs the full contract there, and `promote()` swaps the
folder in, retrying a rename Windows refuses and recovering `.outgoing` if a
previous promote died between its renames. `sync_state.json` is written only
AFTER the promote - written earlier, a failed promote left it claiming
success. The candidate is deleted once promoted. A failed night changes
nothing that is served.

**Partial nights.** A night that did not cover the register still publishes
what it read, with a `::warning::`. `partial_streak` counts FAULTY nights
(`next_streak`: a failed sector, or a fetcher that aborted or died) - not a
pass that ran out of time, which is how a version-bump re-read or a seedless
start makes progress. The workflow's last step (`sync.py --check-streak`)
fails the job at `PARTIAL_FAIL_AFTER` (3) in a row, after the commit.

**A changed pass reports what it could not read.** With `--ids-file` both
fetchers write `<ids-file>.left`, the named ids not answered, and the sync
keeps exactly those queued. Exit 0 only means the breaker did not trip; a
moved proposal whose re-read timed out was cleared on exit 0 and, its old
record being cached, never read again. The report is written before exit 0,
2 and 3 alike and is honoured on all three (`changed_pass_left`); read only
on 0, a pass that ran out of time kept its whole debt and re-read 2,301
forms it already had. Only a missing report (a crash) keeps everything, so
a pass with nothing to fetch still writes `[]`. A 500 the fetcher settles
is NOT answered for `.left`: a changed pass's ids are already cached and
`recheck_none` skips cached ids, so a settled 500 cleared from the queue
was never asked again. Fetcher output is streamed into the
sync's log as it comes (`run()`), and the history fetcher writes each answer
as it arrives (`as_completed`): captured until exit and written in
submission order, a stalled pass and a working one both looked like a
silent log for hours. The location
cross-check runs AFTER the data commit, so ~150 PARIVESH requests can never
cost a night its publish, and the push rebases first.

`rehearse_sync.py` replays the workflow locally from a cold cache; run it
after any change to the sync.

**The scheduled run sweeps in FULL, every night.** PARIVESH's `startDate` and
`endDate` filter on the SUBMISSION date, so a window returns proposals FILED
in it, not proposals that CHANGED in it. Measured over this register, 93.8% of
proposals were last touched more than a week after they were submitted, so a
two-day delta reaches almost none of the status changes a sync exists to
catch - it looks like it is tracking the source while seeing nothing. Ten
sectors is ~130 MB and ~90 seconds. `--since` remains, for a targeted
catch-up only, and warns.

**Three passes, because a cache keyed on id is never revisited.** `new` picks
up proposals not yet cached. `changed` re-reads the ids whose register row
moved, named by `sync.py` into `--ids-file` - without it a proposal cached
while pending keeps that state for ever, its history never gaining the
decision step. `rolling` re-reads a seventh of the OPEN proposals each night
(`--slice i/7 --open-only`), because a history can advance without the
register row changing at all: a step is added and the status string does not
move. Terminal proposals are never re-polled. `recheck_none` (both sources)
re-asks what was settled as absent. The two revisit passes
(`REVISIT_PASSES`) re-ask what is already published, so running out of time
in one never marks a night partial; counted as a hole, `rolling`, which takes
all the time left, marked every budgeted night partial.

**The shard vocabulary is a register, not a sort.** Shards store `sector` and
`status` as positions in arrays published in `index.json`. Re-sorting those
arrays each build meant one new status spelling - the register carries 84
spellings of 74 stages and gains more - shifted every position after it:
measured, 52 of 58 positions moved, rewriting every row in all 35 shards,
47 MB, for one label. `stable_vocabulary()` keeps every published position for
ever and appends new values after it. Nothing is ever removed; an unused slot
costs bytes, a moved one costs the whole register.

**What was downloaded is what is built from.** `--fetch` writes
`sector_<id>.json` and merges into `all_records.json` afterwards, and
`load_register()` prefers the merge - so a fetch that died in between left
fresh downloads on disk beside a stale merge and the build used the stale one.
The merge is now re-made whenever any sector file is newer than it.

**Currency is stated wherever a register-derived figure is shown.** The source
is live; this copy of it is not. `freshness.json` carries the read time and
whether the check covered the whole register, and `RegisterCurrency` renders
it in `InstrumentChrome`'s footer - one place, because a currency statement
kept in four eventually disagrees with itself.

### Rebuilding instrument data

```bash
INSTRUMENTS_CACHE_DIR=/some/dir/outside/the/repo python scripts/instruments/build_data.py --fetch
```

Omit `--fetch` to rebuild from cache. The build fails on any invariant violation **before writing anything**, so a failed run leaves the previous data in place rather than replacing it with something that did not pass.

The two backfills are separate and both resumable:

```bash
python scripts/instruments/fetch_caf.py --workers 8
python scripts/instruments/fetch_process_history.py --workers 16
```

`--workers` is an upper bound on threads, not a request rate. `net.py` decides the
rate, and it decides it from what the service is actually tolerating.

### Reaching PARIVESH

Sustained concurrency down one address got this project refused at the TCP layer
for nine hours - not throttled, dropped at connect, for every path on
`parivesh.nic.in` while a sibling host answered normally. Everything below
exists because of that, and because a tool that keeps a public dataset current
cannot have one point of failure between it and its source.

**Proxies are the DEFAULT egress, under one total pace.** `net.py` loads the
pool from `$INSTRUMENTS_PROXIES`, or by default `<cache>/proxies.txt`, and
with a pool loaded our own address carries at most `DIRECT_SHARE` (20%) of
recent requests. Every send, on every route, waits for a slot under the
adaptive total pace (ceiling `MAX_RPS`, `INSTRUMENTS_MAX_RPS`): spreading load over many addresses
never becomes more load on the service. Direct-only reads at 4-5/s drew a 403
on this project's address on 2026-09-25; the same backfill through the pool
read 200 of 200 forms with no error while that address was still refused.
The pace slot is taken BEFORE a route is picked: taken after, each request
held its route's slot while it queued, every route read as full, and 117
unsent "no route available" results tripped a healthy run's breaker. A
request that finds every open route full for its whole timeout returns
`SATURATED_BODY` and, like `DEADLINE_BODY`, is counted as owed, never as an
error (`NOT_SENT`). The concurrency ceiling follows the pool (20 + 3 per
proxy ADDRESS, `CONC_LIMIT` 1500) because through a proxy most of a request's time is
transit; what the service sees is bounded by `MAX_RPS`. The register and
forest SWEEPS set `direct_share = 1.0`: 130 MB answers go down our own route,
with proxies only while it is stood down. The pool is rebuilt every night by
the workflow (bounded to 4 minutes). `refresh_proxies.py` APPENDS each route
as it verifies - never truncating the live file a fetcher is reading - and
at the end ROTATES: this run's verified routes first, then every earlier
route it did not reach. A route is dropped only when it was probed and
failed - and only when at least `MIN_REPLACE` (50) verified, since a refresh
run while the service or our network is down "disproves" every route and
once wrote an empty pool - so a run stopped by its time bound cannot shrink
a good pool. The file is replaced through a temporary file. A running
fetcher takes new routes up (`reload_routes`) every 60 s.

**What PARIVESH actually limits, measured on 2026-09-25 - and how the
fetchers work with it.**
- **The limit is PER ADDRESS: about one request per ~10 s.** One proxy sending
  back-to-back got 429 after 1-2 requests; 2 s apart (~8 s with latency) one
  429 in 12; 10-30 s apart none. 120 different addresses asked at once drew
  no 429 at all - there is no global limit. So throughput = working
  addresses / 10 s, and pool SIZE is the lever. `ROUTE_INTERVAL` (10 s)
  spaces every address; a 429 cools only that address (`cool`, 60 s) and is
  NOT a capacity signal - treated as one it collapsed concurrency to 2.
- **Spread, never favour.** `pick()` chooses at random among the better half
  of available routes. Sending 85% of requests to the best-scored proxy
  hammered a few addresses into 429s while hundreds idled.
- **Only server distress moves the total pace.** `note_answer` feeds an
  adaptive total rate that starts at `MAX_RPS` (the ceiling, 24 by default) and
  cuts by a quarter when >2% of recent answers are 5xx, raising by a fifth on
  a clean window, never below `INSTRUMENTS_MIN_RPS` (3). 403s were our own refused address and single bad proxies -
  identity, handled per route; counting them cut the pace to 6.5/s for
  nothing. At 40-60/s total the form server itself returned 500s on forms
  that exist - the real ceiling, which the controller now finds and re-finds
  as the portal's load moves through the day.
- **Free proxies are flaky and short-lived.** Even working ones fail about
  half their requests, and ~80% of a pool is gone within two hours. A
  transport failure cools that proxy exponentially (30 s doubling to 30 min,
  reset on success) and gives back its pace slot (`refund`: it never reached
  the service). Retiring on three failures cut a 721-route pool to 47 in
  minutes; a 403 through a proxy RESTS it (a 403 wave banned the whole pool).
  The pool must be refreshed continuously while a backfill runs, not nightly.
- **SOCKS widens the pool.** Free SOCKS5 lists verified at ~15% against
  0.2-3.4% for HTTP lists. `net.Route` opens `socks5://` / `socks4://` routes
  through PySocks with OUR TLS context - checked live: through a SOCKS route a
  hostname mismatch and a self-signed certificate are both rejected.
- **One Python process is CPU-bound near 7 forms/s** (0.98 of one core:
  TLS handshakes and parsing ~25 KB forms under one GIL), whatever the
  thread count or pool size. `fetch_parallel.py --procs N` runs N
  `fetch_caf.py --shard i/N` processes: each takes ids with id % N == i and a
  disjoint slice of the pool by exit IP (`INSTRUMENTS_ROUTE_SHARD`, so no
  proxy address is shared), 1/N of the total pace, and its own shard files,
  merged afterwards. Our own address is in every shard, so each spaces it N
  times wider. The parent terminates its shards if it is stopped, and any
  exit other than 0 or 3 is reported as a fault. 8 shards: 8.5 forms/s at 17:20 IST with ~0 final server errors
  - the form server's own ceiling at that hour, which each shard's pace
  controller finds.
- **Spacing is per EXIT IP, not per address:port.** Free SOCKS lists carry one
  IP on several ports; to PARIVESH that is one address. Keyed per IP
  (`HOST_NEXT_OK`), 429s fell from ~25% of answers to ~5%.
- **Count addresses, not routes (measured 2026-10-20).** 514 of 578 verified
  routes were ports on five gateway IPs (45.74.31.40-47), and an IP-echo
  through 108 of them answered from essentially TWO exits. Counted by route,
  the concurrency ceiling put 1,500 threads in front of ~65 real addresses;
  their waiting - re-scanning the pool ten times a second under one lock -
  held the fetcher's CPU and it read 1.2 forms/s. The ceiling now counts
  distinct proxy hosts, a waiting request sleeps until a route's spacing
  clears (`opens_in`), and the refresher probes at most `PORTS_PER_HOST` (4)
  ports of one address so its budget finds new addresses, not new ports.
- **Probing is itself load-sensitive.** 4,000 probes at once saturate this
  machine's network stack: 130 of 806 known routes "failed" a wide probe and
  verified at 200 wide / 20 s. The refresher re-verifies the known pool
  gently first, then sweeps new candidates (smallest list first - curated
  lists verify ~15x better than the one 101k list), and drops a route only
  when it was probed and failed. A probe answered 429 is `LIMITED` - the
  route reached PARIVESH and its address is busy, routinely because a
  backfill is using it - and is never counted as failed. The KNOWN pool is
  capped at `PORTS_PER_HOST` too (`cap_ports`); uncapped, the gateway
  ports were re-verified and kept every night.

Each route is scored on what it has actually delivered, rested when it starts
failing and retired when it keeps failing.

**Verification is never disabled.** Proxies are not trusted and do not need to
be: every request is HTTPS with the certificate chain and hostname verified, so
a proxy tunnels opaque bytes and can neither read nor alter the payload. A proxy
that only works with verification off is dropped. A silently rewritten district
code would pass every invariant the build has, because it would be internally
consistent and merely wrong.

**Caps differ by route.** Direct carries 20 concurrent, each proxy 3. The block
came at 48 sustained on one route, so direct stays under half of it while still
contributing its speed - it answers in 0.17s against a proxy's 5.5s. Capping
every route alike throttles the good route to the speed of the bad ones; capping
none of them is what caused the block. A route at its cap is FULL, not gone:
a request that finds every open route full waits for a slot (bounded by its
timeout) instead of failing unsent - with no proxies and `--workers 24` it once
returned 220 of 240 requests as "no route available" from a healthy service.
Nor is a RESTED route gone: its rest expires. With no proxies the direct
route is the whole pool, so three failures rested everything, requests
failed unsent for 90 seconds, and the breaker aborted a sync's history pass
on 79 non-attempts while the endpoint answered in 0.19s. A request now
waits out a rest that ends within `REST_WAIT_LIMIT` (a first or second
rest), sending nothing meanwhile; a longer rest still fails at once so the
breaker can act on a route that keeps failing.

**A penalty that only accumulates empties the pool.** A route is rested after
three consecutive failures and retired after four rests - but `rests` used to
never come down, so twelve scattered failures retired a route however many
thousands of clean requests fell between them. Every route retires eventually
on that arithmetic, and the pool can only shrink. Sustained success now buys
a rest back (`RECOVERY_WINS`), and **the direct route is never retired at
all**: it is the one route we own, the one we can verify independently, and
the only one that cannot be replaced from a public list, so it may be rested
or suspended - both of which expire - but never put beyond recall. Retiring
it silently cost a four-hour run its fastest route while it was answering
every request it was given, reporting `err=0` throughout.

**A refusal aimed at us is not congestion.** Only 5xx moves the total pace.
429 is NOT a capacity signal (`CAPACITY_SIGNALS` is 502/503/504): it is the
per-address allowance, and it cools only the address that drew it.
`IDENTITY_REJECTIONS` (401/403/407) are the service refusing THIS CALLER:
charged to the route that earned them, and on the direct route they stand it
down. Charging every non-200 to the pace meant a 403 on our own address
throttled 300 working proxies with it - concurrency 96 to 31 - while every
proxy was fine. `RESOURCE_ANSWERS` (500 on the CAF endpoint) end the attempt
on the first answer and are credited to the ROUTE, because retrying them four
times charged four route failures for a per-proposal answer and rested
healthy routes. They DO count as server distress for the pace (`note_answer`
treats every 5xx alike): under load the form server answers 500 for forms
that exist, so a rising 500 rate is the server's ceiling, not a run of
missing forms. An id settles as "no form" only on a second 500
(`SETTLE_CONFIRMATIONS`); an unconfirmed one on the last attempt stays owed.
A register sector or forest State has no "absent" answer, so `sync.fetch`
passes `final=frozenset()` and its 500 is retried like any other failure -
one attempt per `get()`, each failure logged, `SWEEP_BACKOFF` between them.
A 5xx on the DIRECT route is never charged to it (the origin answered; the
pace hears it); charged, three sector 500s rested our own route and sent a
90 MB retry through a free proxy. On a proxy a 5xx may be its own gateway
error, so there it counts.

**The opening probe asks twice.** `build_pool` suspends the direct route only
on a refusal that repeats after `PROBE_RECONFIRM_S` (5 s). On 2026-10-20 one
transient 403 at the start of a sync sent the first 4 MB sector through free
proxies in 774 s; the next sector, back on our own route, took 55 s for
92 MB.

**A settled "no form" is re-asked every night.** Under load the form server
returns 500 for forms that exist: of 495 ids settled that way on 2026-09-25,
488 returned a form when re-asked one at a time at 3/s, and `cf: none` fell
from 247 to 4. `sync.py`'s `recheck_none` pass (before `rolling`, which takes all the time
left and starved it when it ran last) re-asks every
`settled_absent` id at `RECHECK_RPS`, so an absence is published only while
the server keeps saying so. It runs for the history ledger as well as the
CAF one. And because a settled 500 never feeds the breaker, a server
answering 500 to everything could settle id after id as absent: `SettleStorm`
stops a run when 20 settles make up 10% of its last 200 outcomes (genuine
absences are ~4 in 116,000). It is off in the re-check pass, which asks only
settled ids (`INSTRUMENTS_RECHECK`).

**Only a 500 settles an id in the error ledger.** Resume skips ids the service
has answered about, and the first version of that test admitted every
non-negative status - so a 403 from our own block and a 404 from a proxy
serving its error page retired 163 proposals permanently, and the build then
published them as `cf: "none"`, stating on a public register that the Ministry
serves no application form for them. `SETTLED_STATUSES` is `{500}` and nothing
else; everything else stays owed. The 500 must be said twice
(`SETTLE_CONFIRMATIONS`): one seen on the last attempt is `owed`, not
returned. A form whose envelope carried a failed status ("unparseable") is
owed too - under load those are transient. A settled 500 is an answer, so
it never feeds the circuit breaker: counted as an error it aborted the
nightly re-check, which asks only such ids, on a healthy service.

**A dead proxy is not a struggling server.** The pace controller reacts only to
things that say something about the SERVICE: a non-200, or a transport failure
on the direct route. A public proxy dying is charged to that route alone. Wiring
those together once dropped concurrency from 96 to 4 while the service was
answering in 0.17s and the run had recorded no failures at all.

**Setting the direct route aside is reversible and needs evidence.** Three
CONSECUTIVE refusals to CONNECT suspend it, for five minutes, doubling if
re-confirmed; any answer from it lifts the suspension. A read that ran out of
time is not a refusal - the CAF form takes about six seconds and these runs
push twenty at once, so timeouts are ordinary. Treating one as an IP ban, and
recording that ban as a latch nothing could clear, took the fastest route out
of a 93,000-request backfill on the first slow response of the night while it
was still answering in 0.17s. Nothing errored; the run was simply three times
slower from then on. `is_connect_refusal()` draws the line and is tested.
While suspended it is not used at all: falling back to it whenever no proxy
was free - routine under 10 s spacing - kept sending connects down a blocked
address. The request waits (`SATURATED_BODY`, owed) instead.

The line is not "did it time out". An IP-level drop answers NOTHING - no RST
comes back and the attempt simply expires, which is WinError 10060 on Windows
and errno 110 on Linux - so a connect timeout IS the block's signature and
counts. A READ that timed out is the endpoint being slow, and a name that
would not resolve is our own resolver; neither says anything about whether we
are welcome. Narrowing this to the word "refused" made the detector blind to
the exact event it exists for: 61 connect timeouts were recorded on this
project while it counted none of them as evidence of anything.

**Every progress line prints the mix CURRENTLY in use** - `egress now 30%
direct (life 29%), 228/228 routes, conc 96`. Over a long run a lifetime
average moves too slowly to show anything: the direct route can stop being
used altogether and the reported share still looks healthy for hours. The
rolling figure covers the last 400 requests, and it is what caught the latch
above - within minutes, while lifetime still read 26%.

**Extraction must be deterministic.** The source returns a proposal's CAF
revisions and its plots in no fixed order. An extractor that reads "the last
one" reads a different revision between fetches: measured over 58,107 records
fetched twice, 985 disagreed, 109 of them on declared land, because the figures
came from whichever revision arrived last. Plots and points are sorted, and the
operative revision is chosen explicitly - the highest `id`, the latest, because
a proposal is judged on the form it now stands on and not a superseded draft.

**`fetch_caf.py` records `EXTRACT_VERSION` on every line and resumes only over records at the current version.** Change what `extract()` captures and you MUST bump it, or every id already on disk is skipped for ever and quietly keeps its old shape - a cache that no amount of re-running repairs. `--rewrite-stale` drops older records so the file does not carry two shapes at once.

The suites below guard this. Run all of them before and after any pipeline change, then `npm test`:

```bash
python scripts/instruments/test_district_resolution.py
```

```bash
python scripts/instruments/test_geometry.py
```

```bash
python scripts/instruments/test_net.py
```

```bash
python scripts/instruments/test_sync.py
```

```bash
python scripts/instruments/check_published.py
```

`test_district_resolution.py` covers the resolver and needs no cache.

`test_net.py` pins the egress behaviours above, offline. Both failures it guards
against looked fine at the time - one looked like speed, the other like caution -
and only the numbers gave them away.

**A cache keyed on id is never revisited, so a changed row must be named.**
Both per-proposal caches skip any id already on disk. A proposal cached while
pending therefore keeps that state for ever: its CAF is never re-read and its
appraisal history never gains the decision step, so it publishes a null
duration while the register plainly says it was decided. `sync.py` writes the
ids whose register row moved and passes them to both fetchers as
`--ids-file`, which bypasses the resume set for exactly those.

`test_sync.py` pins the scheduled run's claims about time, offline. The
watermark may only advance over ground a run actually covered: a sector that
fails leaves a hole, and advancing past it means the next delta starts after
the hole and nothing ever asks for those changes again - the proposals in it
keep a stale status permanently while the job goes green and the site reports
a successful check. The window is held instead, widening until
MAX_DELTA_DAYS escalates it to a full sweep. Likewise a run where every
sector failed does not stamp the register as fetched, because dating the
sources to a read that did not happen restarts every open proposal's clock.

`test_geometry.py` covers the boundary reader in two halves: a structural half that builds synthetic polygons and runs anywhere, and a file half that runs only where the boundary file is present. Its point checks are chosen to fail on a wrong-vintage boundary file - four districts created *after* 2011 that must resolve to their 2011 parent, and the Mizoram/Nagaland pair a shared district code would union.

`check_published.py` asserts the contract between the published files and the code that reads them. 285 assertions, and they are written to *fail*: flipping every geometric verdict to `inside`, blanking the located district, swapping a rate's denominator, misstating an aggregate's coverage, or hiding an email in `lookup.json` are each caught. It also runs on the sync job **after** the rebuild, not only on pull requests - that job is the one that changes the published files.

`build_register_index.py` and `legal_reference.py` read only committed data, so they can be re-run without a fetch cache.

### Data traps that have already cost time

- **The CAF's `clearence` block carries the other clearances.** Forest
  clearance (involved, FP proposal number, status, hectares), the wildlife
  board (protected area, status), eco-sensitive zone, protected area, CRZ and
  land tenure. The same block also carries the undertaking signatory's NAME
  and ADDRESS - never extract `ecOthersDetail`.
- **Vercel caps a function's response at 4.5 MB.** Rajasthan's proposals
  are 7.3 MB as CSV and sixty days of events 14 MB; both worked on a laptop
  and would fail deployed. CSVs are served in parts of `PART_ROWS` (8,000)
  with `X-Parts` and a `Link: rel="next"` header (`lib/instruments/csv.ts`).
- **The forest register can answer badly with HTTP 200.** `fetch_forest`
  checks the envelope status and refuses an EMPTY answer for a state whose
  last read held records (keeping the previous copy). `forest_meta.json`
  keeps when EACH state code was last read; `forest.json` publishes
  `state_read_at` and dates each record by its own State, and `read_at` is
  the oldest. One date for all of it once stamped every status "read today"
  after a night on which 37 of 38 codes failed.
- **Raw shards are not cached wholesale on the server.** 35 of them are
  ~117 MB of heap. `shard()` keeps four, most recently used; anything that
  sweeps every State (`allSummaries`, the nearby table, sitemaps) reads with
  `shardOnce()` and keeps only what it derives.
- **The forest register's state filter takes LGD state codes**, not the ids
  `getListOfAllState` returns (asked with list id 36 it answered Telangana,
  LGD 36). `sync.fetch_forest()` asks codes 1..38. The wildlife register
  answers in minutes per state and is not swept; its facts come from the EC
  form.
- **Environmental and forest registers share no key.** `project_id`,
  `singleWindowNumber` and `cafnumber` are per application: 0 of 552 forest
  records matched. Join through the FP number the EC form declares.
- **`app_updated_on` is IST-local** (hour histogram peaks 10:00-19:00, plus a
  02:00-03:00 system batch). It is published as `upd`; the change log does not
  rely on it.

- **`public/geo/india-states.topojson` is NOT Census 2011 district geometry.** It carries a `districts` layer that looks like exactly the right thing and is not: 102 of its 723 features post-date 2011, so Palghar, Gir Somnath, Morbi, Paschim Bardhaman and others exist as their own features and the 2011 parent they were carved from is present with that area already removed - Thane's polygon is 45% of the real district, Karimnagar's is 19%. Its `year` property does not identify them (Thane is tagged `2011_c` and is the post-2014 shape), and its `dt_code` is not unique: eight Mizoram districts share codes 261-268 with eight Nagaland districts, and four Tamil Nadu districts carry `"0"`. Used for the geometric test it reported inland projects in Palghar as being in no district at all, and corroborated a proposal filed in Mon against coordinates in Aizawl. **District geometry comes from datameet's `2011_Dist.shp` in the fetch cache**, the same file the gazetteer's `.dbf` comes from, so `censuscode` joins by construction. The topojson remains correct for the state-level index maps.
- **The CAF endpoint wants the record's `id`, not its `proposal_id`.** `POST /parivesh_api/proponentApplicant/getCafDataByProposalNo?proposal_id=<id>` - the parameter is named after the field that breaks it, and passing that field returns HTTP 500. The same collision applies to the appraisal history: `POST /workgroupmaster/process/getProcessHis?application_id=<id>` wants the record's `id`, and passing its `application_id` (a small integer naming the form type) returns HTTP 200 with an empty array - a silent nothing rather than an error.
- **A project is a set of places.** A mine is one mapped block; an expressway is four hundred across two states. Reducing both to one point and testing that point manufactures disagreements out of the reduction - one observed filing produced a 590 km "the coordinates are elsewhere" verdict that existed only because the envelope centre fell between two real blocks. Every block centre is carried and the verdict is satisfied by any one of them; the point published is the block the verdict rests on.
- **CAF blocks carry `type`: PRIMARY, ALTERNATIVE1, ALTERNATIVE2.** Spanning all of them puts the site between a real location and a rejected one. Only PRIMARY blocks are used.
- **The register has two filing dates.** `dateOfSubmission` is the LATEST submission and moves forward on re-submission; the appraisal history keeps the original. They disagree for a third of the register, by up to eight months. Durations are measured from the history's first step, and both dates are published so the arithmetic closes.
- **13% of decided proposals were auto-delisted mid-flight and revived.** Nothing is pending with the authority during that interval, so it is subtracted from the time to decision and published separately as `dsu`. Across the register it is 681,624 days.
- **Source timestamps are labelled `+00:00` and really are UTC** - the hour histogram over 1.49 million of them peaks at 11:00 UTC, which is 16:30 IST. They are converted to IST before a date is taken, because 9.6% fall after 18:00 UTC and would otherwise publish a day early. `dateOfSubmission`, by contrast, is already IST-local; do not convert it twice.
- **PARIVESH will block your IP at the TCP layer.** Sustained concurrency on the CAF endpoint - 48 workers, plus a second process probing alongside - got this project refused at connect for many hours, across every endpoint on the host. The circuit breaker in the fetchers exists for this. Keep `--workers` modest and never run two fetchers at once.

- **SHRUG `pc11_district_id` is the NATIONAL census code (1..640)**, matching datameet `censuscode`, *not* `DT_CEN_CD`. Joining on state+district serial matches almost nothing while looking like partial success.
- **SHRUG `?format=original` serves Stata binary** despite the `.tab` extension. Use `pandas.read_stata`. All ID columns are **zero-padded strings**; converting to int destroys the padding and breaks every join silently.
- **PARIVESH ignores `page`/`size`.** An unfiltered call returns ~128 MB. Always scope by sector. `other_property` is a JSON-encoded *string*, not an object.
- **PARIVESH has no district field.** The finest structured location is `state`. District is recovered from the free-text `projectName`; roughly a third of the register resolves and the rest is reported unresolved, never guessed.
- **A shard's state is the FILING state, not the site state.** `projects/<state>.json` is keyed by the register's `state`, which is the authority the application went to. Sites are routinely elsewhere: 141 districts draw proposals from more than one shard. Anything listing a district's proposals must read every slug in that district's `register/districts.json` `slugs` array, never one derived from its own state name. Reading a single shard once hid 18,361 proposals — Jaipur's page listed 1 of 1,106 while captioning it as complete. `check_published.py` asserts `slugs` is exhaustive.
- **A count and the list under it must come from the same filter.** The caption ("All N proposals … Nothing is truncated") is the instrument's promise. Both the 300-row cap and the single-shard read broke it while leaving the caption confidently intact, which is worse than an obviously empty page. If you change how the list is built, change or re-verify the count in the same edit.
- **Census literacy is defined over population aged 7+**, not total population. The registry records each rate's denominator for this reason; computing it over total population yields a materially different and non-comparable number.
- **Several Village Directory columns are unusable** and are excluded with reasons recorded in `measures.py`: `pc11_vd_ph_cntr` is corrupt at this aggregation, and the `power_*` / `wat_*` / `bus_*` columns are binary "any village here" flags, not coverage shares.
- **`scripts/optimize_landing.py` re-encodes every target by default** and the served tiles are not all 3:2 (health-bg is square). Pass explicit names: `python scripts/optimize_landing.py instruments-bg`.
- **Windows Python defaults to cp1252.** Pass `encoding="utf-8"` on every text `open()`.
- **SHRUG's `pc11_subdistrict_id == 99999` means "this district has no sub-district".** It recurs across 30 districts with an empty name, so anything keyed on the code alone folds them into one record - which published Chennai's population as the sub-district of 1,723 Mumbai Suburban proposals. It is excluded in `location.NO_SUBDISTRICT`. Separately, 31 Assam tehsils straddle a district boundary under one code ("Barnagar part"); sub-districts are grouped by code with every parent listed in `districts`, taken from the village-level index because the PCA carries only one parent.
- **datameet carries ~98,700 km² of Jammu & Kashmir as `censuscode 0`, "Data Not Available".** A point there is in no district for a reason unrelated to the site, so it is published `unmapped`, never `offshore` ("at sea"). The same file places Srinagar city inside Baramula; J&K geometric verdicts are weak and no landmark is pinned there.
- **C.O. 123 (Maharashtra) lists by district, although it schedules by village.** Its eleven entries are each headed "The following in <X> District", so its silence on a district IS a finding; the 23 unnamed districts are `outside`. Read from the gazette scan on 2026-09-24; before that the list came from a State compilation and they were withheld as `not_determined`. Maharashtra's official count of 13 districts is these eleven, as twelve Census 2011 districts (Dhule's entry covers Nandurbar), plus Palghar.
- **Two versions of one Order can disagree, and only the current one counts.** C.O. 109 (1977) lists four Dhar tahsils; C.O. 192 (2003), which superseded it for Madhya Pradesh, lists six. A second source agreeing with the 1977 text is not corroboration of a 2003 fact.
- **A transcribed Presidential Order is not necessarily the last word.** C.O. 229 (Jharkhand, 2007) is complete at 14 entries and omits Garhwa, but the Ministry of Panchayati Raj lists Garhwa as a Fifth Schedule Area. `legal_reference.NAMED_BY_MOPR_NOT_BY_ORDER` withdraws such a denial to `not_determined`; it never manufactures a Scheduled Area. `check_published.py` asserts no district the Ministry names is published `outside`.
- **Never type a source's age or span into a page.** "Fourteen years ago", "Live register" and "2022 onward" were each written by hand and each went stale or wrong. The Census's age, each updating source's read date and the register's first submission month come from `lib/instruments/vintage.ts` (`censusAge()`, `sourceVintageLabel()`, `registerStart(meta.register_span)`); the build measures `register_span` from the rows and `check_published.py` re-measures it. `vintage.test.ts` fails if a page spells any of them out again.
- **SECC shares are shares of rural HOUSEHOLDS, per sub-district.** A district's share is the household-weighted mean - `sum(share x secc_hh) / sum(secc_hh)` over sub-districts reporting it - never the plain mean. `secc_weighted()` builds the two summable columns and `SECC_SHARES` in `measures.py` names which column each measure reads. Wholly urban districts have no rural SECC and publish `null`, not zero.
- **`sameDefinition` is a comparison.** `measures.json` carries `benchmarks.definitions`, the formula each benchmark was computed with; `buildFact()` sets `sameDefinition` only when it equals the value's own formula, and `check_published.py` asserts they are the registry formulas. Without the block every comparison silently disappears.
- **Heredocs through Git Bash collapse a backslash-n escape into a real newline.** Patch scripts containing escapes must be written with the Write tool, or use `chr(10)`.
