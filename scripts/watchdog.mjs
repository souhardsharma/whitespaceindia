// The site's daily check, run by GitHub after every nightly sync and once a
// day, with nothing but the workflow's own token. It needs no person and no
// assistant: when something is wrong it opens (or updates) one issue titled
// WATCHDOG_TITLE, which GitHub mails to the owner, and the run fails; when
// everything is right again it closes that issue.
//
// It covers what can be measured from outside: the nightly data, every kind of
// public page and download, the backend being awake (and wakes it if not),
// Cloudflare and Render deployments of main, the month's build and instance-hour
// budgets on both free plans, and Vercel's state. The assembled site's file
// and rule counts are checked by the workflow's build job (limits.mjs).
//
//   GH_TOKEN=... GITHUB_REPOSITORY=owner/name node scripts/watchdog.mjs [--dry-run]
import fs from "node:fs";

export const SITE = "https://whitespaceindia.pages.dev";
export const BACKEND = "https://whitespaceindia-backend.onrender.com";
export const VERCEL = "https://whitespaceindia.vercel.app";
export const WATCHDOG_TITLE = "Watchdog: the site needs attention";

// Free-plan budgets, and the share at which the watchdog speaks up.
export const BUDGET = {
  pagesBuilds: 500, // Cloudflare Pages builds a month
  pagesBuildsWarn: 400,
  renderHours: 750, // Render free instance hours a month, whole workspace
  renderHoursWarn: 748,
  renderBuildMinutes: 500,
  renderBuildMinutesWarn: 450,
  // Worst case per Render deploy: both instances counted while the new one
  // starts (Render does not document whether the overlap is counted), and the
  // build time it takes from the pipeline allowance. Measured 2026-11: a deploy
  // is ~3 minutes start to live, and 40 build minutes covered 27 deploys.
  overlapMinutesPerDeploy: 3,
  buildMinutesPerDeploy: 2,
};

const REPO = process.env.GITHUB_REPOSITORY;
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const DRY = process.argv.includes("--dry-run");

async function gh(path, init = {}) {
  const r = await fetch(`https://api.github.com/${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${TOKEN}`,
      "x-github-api-version": "2022-11-28",
      ...(init.headers || {}),
    },
  });
  if (!r.ok) throw new Error(`GitHub ${init.method || "GET"} ${path}: ${r.status}`);
  return r.status === 204 ? null : r.json();
}

async function ghAll(path, key) {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const j = await gh(`${path}${sep}per_page=100&page=${page}`);
    const rows = key ? j[key] : j;
    out.push(...rows);
    if (rows.length < 100) break;
  }
  return out;
}

async function http(url, init = {}, timeoutMs = 120000) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { redirect: "manual", ...init, signal: AbortSignal.timeout(timeoutMs) });
    const body = Buffer.from(await r.arrayBuffer());
    return { status: r.status, headers: r.headers, body, ms: Date.now() - t0 };
  } catch (e) {
    return { status: 0, headers: new Headers(), body: Buffer.alloc(0), ms: Date.now() - t0, error: String(e) };
  }
}

// Month arithmetic in UTC, which is how both providers reset.
export function monthWindow(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const days = (end - start) / 86400000;
  const elapsedDays = Math.max((now - start) / 86400000, 1 / 24);
  return { start, end, days, elapsedDays };
}

// Projects a count to the month's end at the faster of the month's pace and
// the last seven days' pace, so a busy week is not averaged away.
export function project(timestamps, now = new Date()) {
  const { start, days, elapsedDays } = monthWindow(now);
  const inMonth = timestamps.filter((t) => t >= start && t <= now);
  const weekAgo = new Date(now - 7 * 86400000);
  const lastWeek = inMonth.filter((t) => t >= weekAgo).length;
  const weekDays = Math.min(7, elapsedDays);
  const pace = Math.max(inMonth.length / elapsedDays, lastWeek / weekDays);
  return { sofar: inMonth.length, projected: Math.round(inMonth.length + pace * (days - elapsedDays)), pace };
}

// Render's worst case: the one service awake every hour of the month, plus
// every deploy's overlap counted as a second instance.
export function renderHoursWorstCase(deployProjection, now = new Date()) {
  const { days } = monthWindow(now);
  return 24 * days + (deployProjection * BUDGET.overlapMinutesPerDeploy) / 60;
}

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
}

async function checkSync() {
  const runs = (await gh(`repos/${REPO}/actions/workflows/instruments-sync.yml/runs?branch=main&per_page=20`))
    .workflow_runs;
  // A run is green when its `sync` JOB is: a scheduled run that stands down
  // (the gate) and a diagnostic run both finish green with no sync at all.
  let lastGreen = null;
  for (const run of runs.filter((r) => r.status === "completed" && r.conclusion === "success")) {
    const jobs = (await gh(`repos/${REPO}/actions/runs/${run.id}/jobs?per_page=50`)).jobs;
    if (jobs.some((j) => j.name === "sync" && j.conclusion === "success")) {
      lastGreen = run;
      break;
    }
  }
  const ageH = lastGreen ? (Date.now() - new Date(lastGreen.created_at)) / 3600000 : Infinity;
  const running = runs.find((r) => r.status !== "completed");
  record(
    "nightly sync",
    ageH <= 36,
    lastGreen
      ? `last green run started ${ageH.toFixed(1)} h ago (${lastGreen.html_url})${running ? "; one is running now" : ""}`
      : "no green run in the last 20",
  );
}

async function checkFreshness() {
  const r = await http(`${SITE}/data/instruments/consent/freshness.json?wd=${Date.now()}`);
  if (r.status !== 200) return record("published data", false, `freshness.json answered ${r.status}`);
  const f = JSON.parse(r.body.toString("utf8"));
  const ageH = (Date.now() - new Date(f.checked_at)) / 3600000;
  record(
    "published data",
    ageH <= 50 && f.proposals_published > 0,
    `register read ${ageH.toFixed(1)} h ago, ${f.proposals_published} proposals, ${f.resolution_rate_pct}% located`,
  );
}

// Instrument 02 reads its source once a day in its own workflow
// (meal-claims-sync.yml). The published read time says whether that happened,
// whichever trigger started it; a refusal is published as an outcome, and is
// the owner's to hear about because the run halves its own budget after one.
async function checkMealClaims() {
  const r = await http(`${SITE}/data/instruments/meal-claims/freshness.json?wd=${Date.now()}`);
  if (r.status !== 200) return record("meal claims data", false, `freshness.json answered ${r.status}`);
  const f = JSON.parse(r.body.toString("utf8"));
  const ageH = (Date.now() - new Date(f.checked_at)) / 3600000;
  record(
    "meal claims data",
    ageH <= 50 && f.outcome !== "refused",
    `source read ${ageH.toFixed(1)} h ago for ${f.day}: ${f.outcome}, ${f.sent} of ${f.budget} requests, ${f.failed} failed`,
  );
}

async function checkPages() {
  const n = Date.now();
  const expect = [
    ["/", 200],
    ["/csr", 200],
    ["/data/csr/meta.json", 200],
    ["/csr-spending", 200],
    ["/instruments", 200],
    ["/instruments/consent", 200],
    ["/instruments/consent/data", 200],
    ["/instruments/consent/methodology", 200],
    ["/instruments/consent/district/110", 200],
    ["/instruments/consent/1232987606", 200],
    ["/view/consent/rows/0.json", 200],
    ["/instruments/meal-claims", 200],
    ["/instruments/meal-claims/states", 200],
    ["/instruments/meal-claims/state/tripura", 200],
    ["/instruments/meal-claims/latest", 200],
    ["/instruments/meal-claims/methodology", 200],
    ["/instruments/meal-claims/data", 200],
    // A school page is one static page behind a redirect rule; this is the rule.
    ["/instruments/meal-claims/school/16050718101-1", 200],
    ["/data/instruments/meal-claims/states.json", 200],
    ["/sitemap-index.xml", 200],
    ["/robots.txt", 200],
    [`/instruments/consent/feed?wd=${n}`, 200],
    [`/api/instruments/consent/status?ids=1232987606&wd=${n}`, 200],
    [`/api/instruments/consent/changes?wd=${n}`, 200],
    [`/api/instruments/consent/changes.csv?wd=${n}`, 200],
    [`/does-not-exist-${n}`, 404],
  ];
  const bad = [];
  for (const [path, want] of expect) {
    const r = await http(SITE + path);
    if (r.status !== want) bad.push(`${path.split("?")[0]} ${r.status || r.error} (want ${want})`);
  }
  record("public pages and downloads", bad.length === 0, bad.length ? bad.join("; ") : `${expect.length} answered as expected`);

  const pdf = await http(`${SITE}/api/instruments/consent/export`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: SITE },
    body: JSON.stringify({ proposalId: "1232987606", state: "uttar-pradesh" }),
  });
  const isPdf = pdf.status === 200 && pdf.body.subarray(0, 5).toString() === "%PDF-";
  record("PDF export", isPdf, isPdf ? `${pdf.body.length} bytes in ${pdf.ms} ms` : `answered ${pdf.status || pdf.error}`);
}

// Never sleeps (the keep-warm Worker pings every 10 minutes). If it has slept
// anyway, a request from here wakes it - Render refuses wakes that come from
// Cloudflare, not from a GitHub runner - and the check still fails, because a
// sleep means the Worker or Render changed something.
async function checkAwake() {
  const q = `${SITE}/api/instruments/consent/search?q=watchdog${Date.now()}`;
  const r = await http(q);
  if (r.status === 200 && !r.headers.get("x-backend-wake")) {
    return record("backend awake", true, `search answered in ${r.ms} ms`);
  }
  let woke = "not woken";
  for (let i = 0; i < 4; i++) {
    const h = await http(`${BACKEND}/healthz`, {}, 150000);
    if (h.status === 200) {
      woke = `woken from the runner (/healthz 200 after ${Math.round(h.ms / 1000)} s)`;
      break;
    }
    await new Promise((res) => setTimeout(res, 60000));
  }
  record("backend awake", false, `search answered ${r.status || r.error} asleep; ${woke}. Check the keep-warm Worker's trigger and log`);
}

async function checkDeploys() {
  const head = (await gh(`repos/${REPO}/commits/main`)).sha;
  const commitAge = (Date.now() - new Date((await gh(`repos/${REPO}/commits/${head}`)).commit.committer.date)) / 60000;
  const runs = (await gh(`repos/${REPO}/commits/${head}/check-runs?per_page=100`)).check_runs;
  const pages = runs.find((c) => c.app?.slug === "cloudflare-workers-and-pages");
  const pagesOk = pages ? pages.conclusion === "success" || (pages.status !== "completed" && commitAge < 40) : commitAge < 40;
  record(
    "Cloudflare deploy of main",
    pagesOk,
    pages ? `${head.slice(0, 7)}: ${pages.status} ${pages.conclusion ?? ""}`.trim() : `${head.slice(0, 7)}: no Pages check yet (${Math.round(commitAge)} min old)`,
  );

  const deps = await gh(`repos/${REPO}/deployments?per_page=5`);
  const backend = deps.find((d) => /backend/.test(d.environment));
  if (!backend) return record("Render deploy of main", false, "no Render deployment found");
  const statuses = await gh(`repos/${REPO}/deployments/${backend.id}/statuses?per_page=1`);
  const state = statuses[0]?.state ?? "none";
  const age = (Date.now() - new Date(backend.created_at)) / 60000;
  const ok = state === "success" || (["pending", "queued", "in_progress"].includes(state) && age < 40);
  record("Render deploy of main", ok, `${backend.sha.slice(0, 7)}: ${state}`);
}

async function checkBudgets() {
  const now = new Date();
  const { start } = monthWindow(now);
  // Production builds on Pages: one per push to main. Commits are an upper
  // bound (a push of several commits is one build); branch previews are
  // opt-in (`preview-*`) and counted from their check runs below.
  const commits = await ghAll(`repos/${REPO}/commits?sha=main&since=${start.toISOString()}`);
  const pushes = commits.map((c) => new Date(c.commit.committer.date));
  const branches = await ghAll(`repos/${REPO}/branches`);
  for (const b of branches.filter((b) => b.name.startsWith("preview-"))) {
    const runs = (await gh(`repos/${REPO}/commits/${b.commit.sha}/check-runs?per_page=100`)).check_runs;
    for (const c of runs.filter((c) => c.app?.slug === "cloudflare-workers-and-pages")) pushes.push(new Date(c.started_at));
  }
  const pb = project(pushes, now);
  record(
    "Cloudflare build budget",
    pb.projected <= BUDGET.pagesBuildsWarn,
    `${pb.sofar} builds this month (upper bound), heading for ${pb.projected} of ${BUDGET.pagesBuilds}`,
  );

  const deps = await ghAll(`repos/${REPO}/deployments`);
  const renderDeploys = deps.filter((d) => /backend/.test(d.environment)).map((d) => new Date(d.created_at));
  const rd = project(renderDeploys, now);
  const hours = renderHoursWorstCase(rd.projected, now);
  record(
    "Render instance hours",
    hours <= BUDGET.renderHoursWarn,
    `worst case ${hours.toFixed(1)} of ${BUDGET.renderHours} h this month (awake all month + ${rd.projected} deploys counted twice for ${BUDGET.overlapMinutesPerDeploy} min)`,
  );
  const minutes = rd.projected * BUDGET.buildMinutesPerDeploy;
  record(
    "Render build minutes",
    minutes <= BUDGET.renderBuildMinutesWarn,
    `about ${minutes} of ${BUDGET.renderBuildMinutes} min (${rd.sofar} deploys so far, heading for ${rd.projected})`,
  );
}

// What Google needs to discover the site: robots.txt naming both sitemap
// indexes, and the backend host's copy of the sitemaps readable with every
// child listed there and every page in it on the public site. Google never
// read a sitemap on pages.dev (scripts/cloudflare/sitemap-host.mjs).
async function checkCrawlPath() {
  const bad = [];
  const robots = await http(`${SITE}/robots.txt?wd=${Date.now()}`);
  const text = robots.body.toString("utf8");
  if (robots.status !== 200) bad.push(`pages.dev robots.txt ${robots.status || robots.error}`);
  for (const want of [`Sitemap: ${SITE}/sitemap-index.xml`, `Sitemap: ${BACKEND}/sitemap-index.xml`]) {
    if (!text.includes(want)) bad.push(`robots.txt lacks "${want}"`);
  }
  const brobots = await http(`${BACKEND}/robots.txt`);
  if (brobots.status !== 200 || !/Allow: \/sitemap-index\.xml/.test(brobots.body.toString("utf8"))) {
    bad.push(`backend robots.txt ${brobots.status || brobots.error}`);
  }
  const idx = await http(`${BACKEND}/sitemap-index.xml`, {}, 90000);
  const xml = idx.body.toString("utf8");
  const children = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  if (idx.status !== 200 || !xml.startsWith("<?xml")) bad.push(`backend sitemap index ${idx.status || idx.error}`);
  else if (children.length < 2 || children.some((u) => !u.startsWith(`${BACKEND}/`))) {
    bad.push(`backend index lists ${children.length} children, not all on the backend host`);
  } else {
    const child = await http(children[children.length - 1], {}, 90000);
    const cx = child.body.toString("utf8");
    const pages = [...cx.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    if (child.status !== 200 || pages.length === 0) bad.push(`backend child sitemap ${child.status || child.error}`);
    else if (pages.some((u) => !u.startsWith(`${SITE}/`))) bad.push("a backend child sitemap lists pages off the public site");
  }
  record("crawl path for Google", bad.length === 0,
    bad.length ? bad.join("; ") : `robots.txt names both indexes; backend index lists ${children.length} sitemaps, all readable`);
}

async function checkVercel() {
  const r = await http(`${VERCEL}/instruments`);
  const loc = r.headers.get("location") || "";
  if (r.status === 402) return record("Vercel", true, "paused (402); the live site is Cloudflare Pages");
  if ([301, 308].includes(r.status) && loc.startsWith(`${SITE}/instruments`))
    return record("Vercel", true, `redirects to the live site (${r.status})`);
  record(
    "Vercel",
    false,
    r.status === 200
      ? "Vercel is serving the old full app again: the next push to main deploys the redirect-only build; push one if none is due today"
      : `answered ${r.status || r.error} ${loc}`,
  );
}

// The workflow's `limits` job assembles main exactly as Pages does and passes
// its result here, so data growth from the nightly commits (which run no CI)
// is caught at 80% of a limit, not when Pages refuses a deployment.
function checkLimitsJob() {
  const result = process.env.LIMITS_RESULT;
  if (!result) return; // a local run has no build job
  const warnings = Number(process.env.LIMITS_WARNINGS || 0);
  const summary = process.env.LIMITS_SUMMARY || "no summary";
  record(
    "Cloudflare limits (main assembled today)",
    result === "success" && warnings === 0,
    result === "success"
      ? `${summary}${warnings ? `; ${warnings} near a limit, see the run's summary` : ""}`
      : `the assembly ${result}: ${summary}`,
  );
}

async function report() {
  const failed = results.filter((r) => !r.ok);
  const lines = results.map((r) => `- ${r.ok ? "✅" : "❌"} **${r.name}**: ${r.detail}`).join("\n");
  const run = process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${REPO}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : "local run";
  const body = `Checked ${new Date().toISOString().slice(0, 16)} UTC (${run}).\n\n${lines}\n`;
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Watchdog\n\n${body}`);
  if (DRY) return failed.length;

  const open = (await gh(`repos/${REPO}/issues?state=open&creator=github-actions%5Bbot%5D&per_page=50`)).find(
    (i) => i.title === WATCHDOG_TITLE,
  );
  if (failed.length) {
    const text = `${failed.length} check${failed.length > 1 ? "s" : ""} failed.\n\n${body}`;
    if (open) await gh(`repos/${REPO}/issues/${open.number}/comments`, { method: "POST", body: JSON.stringify({ body: text }) });
    else await gh(`repos/${REPO}/issues`, { method: "POST", body: JSON.stringify({ title: WATCHDOG_TITLE, body: text }) });
  } else if (open) {
    await gh(`repos/${REPO}/issues/${open.number}/comments`, { method: "POST", body: JSON.stringify({ body: `All clear.\n\n${body}` }) });
    await gh(`repos/${REPO}/issues/${open.number}`, { method: "PATCH", body: JSON.stringify({ state: "closed" }) });
  }
  return failed.length;
}

async function main() {
  if (!REPO || !TOKEN) throw new Error("GITHUB_REPOSITORY and GH_TOKEN are required");
  for (const check of [checkSync, checkFreshness, checkMealClaims, checkPages, checkAwake, checkDeploys, checkBudgets, checkCrawlPath, checkVercel, checkLimitsJob]) {
    try {
      await check();
    } catch (e) {
      record(check.name.replace(/^check/, "").toLowerCase(), false, `the check itself failed: ${e.message}`);
    }
  }
  // A drill (dispatch with drill: true) adds one deliberate failure, to prove
  // that a failure really opens the issue; the next ordinary run closes it.
  if (process.env.WATCHDOG_DRILL === "true") record("drill", false, "a deliberate failure, to prove the alert path");
  const failed = await report();
  process.exitCode = failed ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("watchdog.mjs")) {
  await main();
}
