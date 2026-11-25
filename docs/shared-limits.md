# Shared limits: what every domain and tool lives inside

Every part of the site (CSR, Instrument 01, Instrument 02, and every domain
or tool added later) is served by one Cloudflare Pages project, one Render free service and
one GitHub repository, all on free plans. When one tool runs into a limit, the
nightly update stops for all of them. These are the limits, what already
enforces each one, and what a new tool has to do.

| Limit | Free allowance | Enforced by |
|---|---|---|
| Files in one Pages deployment | 20,000 | `scripts/cloudflare/limits.mjs`, run by `assemble.mjs` in CI on every branch and in the daily watchdog; warns at 80% |
| One file | 25 MiB | same |
| `_redirects` | 2,000 static + 100 dynamic | same |
| `_headers` / `_routes.json` rules | 100 each | same |
| Pages builds | 500 a month | branch previews are opt-in (`preview-*` only); the watchdog projects the month |
| Pages Function requests | 100,000 a day | static files cost nothing; only `/api/*`, `/instruments/consent/latest`, `/feed` and `/_be/*` run a function |
| Render instance hours | 750 a month, whole workspace | ONE service, awake all day (at most 744 h); the watchdog projects the worst case, every deploy counted twice |
| Render build minutes | 500 a month | the watchdog projects them from the month's deploys |
| Render memory | 512 MB | server code reads bounded slices, never whole datasets |
| Render bandwidth | 5 GB a month; past it Render SUSPENDS every free service until the month ends | the Pages proxy keeps GET answers in Cloudflare's cache for an hour (`proxy.mjs`) |
| Pages build time | 20 minutes a build | builds of main take 80-210 s (measured Nov 2026) |
| Pages Function CPU | 10 ms a request (free Workers plan) | the functions only proxy and cache; the heavy work runs on Render |
| GitHub API (owner's account) | 5,000 requests an hour | shared with the Worker that starts the nightly sync |
| Vercel (Hobby) | 10 GB Fast Origin Transfer, 100 GB Fast Data Transfer, 1M edge requests a month; a breach pauses the whole team | `vercel.json` builds nothing and only redirects, `site.test.ts` pins that; Deployment Protection keeps old deployments behind a login; the watchdog fails on a 402, a 200 or an unprotected deployment address |

Measured 2026-11-25, with 25 of 30 days gone: Render 453 of 750 instance
hours, 41 MB of 5 GB bandwidth, 72 of 500 pipeline minutes; Pages Functions 66
requests in 24 hours (limit 100,000 a day), no CPU-limit errors (p99 16 ms);
Vercel Fast Origin Transfer 2.65 of 10 GB over 30 days, nearly all of it from
before the pause. Function requests and Render bandwidth have no free API the
watchdog can read without a token, so they are read from the two dashboards.

## A new tool, from its first branch

1. **Branches.** Any name works and costs nothing on Pages. Name a branch
   `preview-<something>` only when you want a Pages preview URL; each push to
   it is one of the month's 500 builds.
2. **Files.** Pack data into grouped files (by state, by id modulo N), not one
   file per entity. About 10,600 files are used today; Instrument 01's
   per-proposal view files alone are 9,376. Instrument 02 (Meal Claims Check)
   adds about 290 pages and at most 64 school files a month, for the twelve
   months it keeps.
3. **Live features** (search, downloads, anything per request) go into this
   Next app under `app/api/`. `functions/api/[[path]].js` already proxies them
   to the one Render service. Never create a second Render service: there are
   no free hours left for one.
4. **Server memory.** Read one shard or one bucket at a time and keep a small
   cache, as `lib/instruments/server.ts` does. The free plan shows no memory
   graph, and `next start` already peaked at 468 MB of 512.
5. **Nightly data.** Commit once a night. Each commit to `main` is one Pages
   build and one Render deploy (~2 build minutes and up to 3 minutes of
   overlap). A data path the backend never reads goes in `render.yaml`
   `buildFilter.ignoredPaths`, so it does not redeploy Render. Instrument
   02 is the example: its nightly commit (`meal-claims-sync.yml`) is one Pages
   build and no Render deploy.
6. **Scheduled workflows** join a concurrency group and check out the branch
   head (as `instruments-sync.yml` does), so two nightly jobs never race a push.
   A second nightly job is started by the first one's completion
   (`workflow_run`), not by its own cron, with a gate that lets one run
   through a day: GitHub's cron is hours late here, and the Worker's GitHub
   allowance is spent on starting Instrument 01.
7. **Polling GitHub** from scripts or agents: 150 seconds apart or more, never
   several at once.
8. **Vercel** is redirect-only and deploys `main` alone (`vercel.json`
   `git.deploymentEnabled`); nothing new is ever served from it. The team was
   paused 2026-10-27 to 2026-11-25 and was lifted with Vercel's ONE-TIME Hobby
   grace period (help agent at vercel.com/help, "Unblock My Account"), so a
   second breach has no free way back. Never give `vercel.json` a framework, a
   function, ISR or image optimisation, and never turn Deployment Protection
   off: every old deployment's own URL still holds the full app.

## When something goes wrong

The **Watchdog** workflow (`.github/workflows/watchdog.yml`) runs after every
nightly sync and daily at 12:00 IST. It opens one issue, "Watchdog: the site
needs attention", naming each failed check with its numbers, and closes it
when they pass again. A backend found asleep is woken from the runner before
the issue is written.
