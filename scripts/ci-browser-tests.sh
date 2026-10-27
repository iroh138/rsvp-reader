#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Runs browser tests (tests/e2e/*.py) the way CI does: builds dist/, serves it with the production headers,
# serves the repository root for storage.py, and builds BASE_SHA (the version before this change) for upgrade.py.
#   scripts/ci-browser-tests.sh <test> [<test> ...]      e.g. scripts/ci-browser-tests.sh smoke csp upgrade
# Python packages: pip install --require-hashes -r tests/e2e/requirements.txt (exact versions with hashes).
set -uo pipefail
cd "$(dirname "$0")/.."
npm run build >/dev/null
(cd tests/a11y && npm ci --no-audit --no-fund >/dev/null)
node scripts/serve.mjs dist 8080 >/dev/null 2>&1 & S1=$!
node scripts/serve.mjs . 8081 >/dev/null 2>&1 & S2=$!
trap 'kill $S1 $S2 2>/dev/null' EXIT
sleep 1
URL=http://localhost:8080/
failed=()
for t in "$@"; do
  echo "::group::$t"
  start=$(date +%s)
  case "$t" in
    smoke)   cmd=(python3 tests/e2e/smoke.py "${URL}index.html?dev" tests/fixtures/book.pdf) ;;
    storage) cmd=(python3 tests/e2e/storage.py http://localhost:8081/) ;;
    upgrade)
      base=${BASE_SHA:-}
      if [ -z "$base" ] || ! git cat-file -e "$base^{commit}" 2>/dev/null; then base=$(git rev-parse HEAD~1); fi
      rm -rf /tmp/rsvp-base && git worktree add -q --detach /tmp/rsvp-base "$base" && (cd /tmp/rsvp-base && node scripts/build.mjs >/dev/null)
      cmd=(python3 tests/e2e/upgrade.py /tmp/rsvp-base/dist dist tests/fixtures/book.pdf) ;;
    *)       cmd=(python3 tests/e2e/$t.py "$URL") ;;
  esac
  if timeout 1200 "${cmd[@]}" > "/tmp/e2e-$t.log" 2>&1; then r=pass; else r=FAIL; failed+=("$t"); fi
  tail -n 40 "/tmp/e2e-$t.log"
  echo "::endgroup::"
  echo "$t: $r ($(( $(date +%s) - start )) s)"
  echo "| $t | $r | $(( $(date +%s) - start )) s |" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
done
if [ ${#failed[@]} -gt 0 ]; then echo "Failed: ${failed[*]}"; exit 1; fi
