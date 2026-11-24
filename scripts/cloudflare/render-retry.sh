#!/usr/bin/env bash
# Ask Render to deploy main again after it reported a failed deploy.
#
# Render's free tier sometimes stalls before starting a deploy: on 2026-11-20
# it took 13 min 47 s from "Deploying" to starting the server, on 11-21 it
# started it after 5 min 25 s and then did not pass its health check for nine
# minutes. Each time the 15-minute deploy limit ran out, Render kept the
# previous build running, and the backend (search, downloads, PDF, /latest)
# served the previous night's data until the next night's commit deployed.
#
# Render deploys main on every push that touches a path outside render.yaml's
# buildFilter.ignoredPaths, so a one-line marker commit asks for a new deploy.
# Run from a checkout of main with FAILED_SHA set. It does nothing when:
#   - a newer commit already touches a deployable path (Render is deploying it);
#   - two retries were already pushed today (UTC), so a broken build cannot loop.
# Exit 0 in every case it decides; non-zero only when git itself fails.
set -euo pipefail

: "${FAILED_SHA:?FAILED_SHA is required}"
MARKER="scripts/cloudflare/render-redeploy.txt"
MAX_PER_DAY="${MAX_PER_DAY:-2}"
# render.yaml buildFilter.ignoredPaths, as path patterns.
ignored() {
  case "$1" in
    scripts/instruments/crosscheck_report.json) return 0 ;;
    *.md) return 0 ;;
    .github/*) return 0 ;;
  esac
  return 1
}

head_sha=$(git rev-parse HEAD)
if [ "$head_sha" != "$(git rev-parse "$FAILED_SHA^{commit}")" ]; then
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    if ! ignored "$f"; then
      echo "a newer commit already changes $f: Render is deploying it, no retry"
      exit 0
    fi
  done < <(git diff --name-only "$FAILED_SHA" "$head_sha")
fi

today=$(date -u +%F)
done_today=$(git log --since="$today 00:00 UTC" --format=%s -- "$MARKER" | grep -c '^ops(render): redeploy' || true)
if [ "$done_today" -ge "$MAX_PER_DAY" ]; then
  echo "::warning::Render failed again after $done_today retries today; leaving it for the next commit and the watchdog."
  exit 0
fi

printf '%s failed; redeploy asked %s\n' "$FAILED_SHA" "$(date -u +%FT%TZ)" > "$MARKER"
git add "$MARKER"
git commit -q -m "ops(render): redeploy after the failed deploy of ${FAILED_SHA:0:7}"
echo "retry $((done_today + 1)) of $MAX_PER_DAY today committed"
