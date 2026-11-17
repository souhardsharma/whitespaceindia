# Shared limits: what every domain and tool lives inside

Every part of the site (CSR, Instrument 01, and every domain or tool added
later) is served by one Cloudflare Pages project, one Render free service and
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
| GitHub API (owner's account) | 5,000 requests an hour | shared with the Worker that starts the nightly sync |

## A new tool, from its first branch

1. **Branches.** Any name works and costs nothing on Pages. Name a branch
   `preview-<something>` only when you want a Pages preview URL; each push to
   it is one of the month's 500 builds.
2. **Files.** Pack data into grouped files (by state, by id modulo N), not one
   file per entity. About 10,400 files are used today; Instrument 01's
   per-proposal view files alone are 9,376.
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
   `buildFilter.ignoredPaths`, so it does not redeploy Render.
6. **Scheduled workflows** join a concurrency group and check out the branch
   head (as `instruments-sync.yml` does), so two nightly jobs never race a push.
7. **Polling GitHub** from scripts or agents: 150 seconds apart or more, never
   several at once.
8. **Vercel** is redirect-only and deploys `main` alone (`vercel.json`
   `git.deploymentEnabled`); nothing new is ever served from it.

## When something goes wrong

The **Watchdog** workflow (`.github/workflows/watchdog.yml`) runs after every
nightly sync and daily at 12:00 IST. It opens one issue, "Watchdog: the site
needs attention", naming each failed check with its numbers, and closes it
when they pass again. A backend found asleep is woken from the runner before
the issue is written.
