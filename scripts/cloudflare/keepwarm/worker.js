// Keeps the Render backend awake in the hours people use the site, and starts
// the nightly data sync on time.
//
// Awake: the free plan sleeps the service after 15 idle minutes and a cold
// start takes up to a minute, which the CSR brief, the subscribe form and
// /latest all wait on. GitHub never delivered the backend-warm workflow's
// schedule, so a Cloudflare cron asks instead (wrangler.toml beside this
// file): every 10 minutes from 06:30 to 23:30 IST, about 530 of Render's 750
// free instance hours a month. /healthz is open, so no key is needed.
//
// On time: GitHub delivers the sync's 01:30 UTC schedule 4.5-6 hours late on
// this repository (06:08-07:25 UTC, 2026-10-22 to 10-29), so the register is
// read at midday IST rather than before the working day. From 01:30 UTC this
// asks GitHub to start the sync (workflow_dispatch), once a day: any sync run
// already created that day, by either route, means it does nothing. The
// workflow's own schedule stays as the fallback, and stands down when a run
// that day has already synced (its `gate` job). It needs the secret
// GITHUB_TOKEN: a fine-grained token for this repository alone, with Actions
// read and write. Without it the Worker only keeps the backend awake.
//
// Deployed from the dashboard as Worker `whitespaceindia-keepwarm`; this copy
// is the source of record. Pasting a change there, or `npx wrangler deploy` in
// this folder, publishes it.
const HEALTHZ = "https://whitespaceindia-backend.onrender.com/healthz";
const REPO = "souhardsharma/whitespaceindia";
const WORKFLOW = "instruments-sync.yml";
const BRANCH = "main";
const UA = "whitespaceindia-keepwarm";

// The ticks that may start the sync: 01:30 to 02:59 UTC. Later ticks retry a
// dispatch GitHub did not take; the once-a-day rule keeps it to one run.
function syncTick(when) {
  const m = when.getUTCHours() * 60 + when.getUTCMinutes();
  return m >= 90 && m < 180;
}

function github(env, path, init = {}) {
  return fetch(`https://api.github.com/repos/${REPO}${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "x-github-api-version": "2022-11-28",
      "user-agent": UA,
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
  });
}

async function startSync(env, when) {
  if (!env.GITHUB_TOKEN) {
    console.log("sync: no GITHUB_TOKEN secret; GitHub's own schedule starts it");
    return;
  }
  const day = when.toISOString().slice(0, 10);
  const list = await github(
    env,
    `/actions/workflows/${WORKFLOW}/runs?branch=${BRANCH}&created=${encodeURIComponent(`>=${day}`)}&per_page=30`,
  );
  if (!list.ok) {
    console.log(`sync: listing today's runs answered ${list.status}; asking again next tick`);
    return;
  }
  const runs = (await list.json()).workflow_runs || [];
  if (runs.length) {
    console.log(`sync: run ${runs[0].id} (${runs[0].event}, ${runs[0].status}) already started today`);
    return;
  }
  const r = await github(env, `/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
    body: JSON.stringify({ ref: BRANCH }),
  });
  console.log(r.status === 204 ? `sync: started for ${day}` : `sync: dispatch answered ${r.status}`);
}

export default {
  async scheduled(event, env) {
    const when = new Date(event.scheduledTime || Date.now());
    const started = Date.now();
    try {
      const r = await fetch(HEALTHZ, { headers: { "user-agent": UA } });
      console.log(`healthz ${r.status} in ${Date.now() - started} ms`);
    } catch (e) {
      console.log(`healthz failed after ${Date.now() - started} ms: ${e}`);
    }
    if (syncTick(when)) {
      try {
        await startSync(env, when);
      } catch (e) {
        console.log(`sync: ${e}`);
      }
    }
  },
  async fetch() {
    return new Response("Not found\n", { status: 404 });
  },
};
