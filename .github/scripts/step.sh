#!/usr/bin/env bash
# Run a CI step; on failure, surface the last lines of output as a GitHub
# annotation so the result is readable from the PR's Checks tab (and the
# check-runs API) without opening raw logs.
# Usage: .github/scripts/step.sh "<title>" <command...>
set -uo pipefail
title="$1"; shift
log="$(mktemp)"
"$@" 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
if [ "$status" -ne 0 ]; then
  msg="$(tail -n 80 "$log" | sed -e 's/%/%25/g' -e 's/\r//g' | awk '{printf "%s%%0A", $0}')"
  echo "::error title=${title} failed (exit ${status})::${msg}"
else
  echo "::notice title=${title}::passed"
fi
exit "$status"
