#!/usr/bin/env bash
# Run bench/ab.sh through benchd, the box's benchmark queue.
# The queue runs one job at a time, so "an idle host" stops being a hope.
# Same settings as ab.sh: N, CORE, A, OUT.
set -uo pipefail
B=$(git rev-parse --show-toplevel)
A=${A:-$(dirname "$B")/tinkered-base}   # a sibling worktree; /tmp is not shared with the host
OUT=${OUT:-$B/.bench/ab.csv}
N=${N:-31}
CORE=${CORE:-6}

if [ ! -d "$A" ]; then
  echo "queued.sh: the baseline tree $A is missing." >&2
  echo "  git worktree add $A <sha>   # then link node_modules and vp pack packages/core" >&2
  echo "  (keep it under /home/paseo: /tmp is not shared with the host)" >&2
  exit 1
fi
mkdir -p "$(dirname "$OUT")"

if ! command -v benchctl >/dev/null; then
  echo "queued.sh: benchctl is missing, running straight on the host" >&2
  exec env N="$N" CORE="$CORE" A="$A" OUT="$OUT" bash bench/ab.sh
fi

echo "queued.sh: N=$N core=$CORE" >&2
echo "  A $A" >&2
echo "  B $B" >&2
echo "  -> $OUT" >&2
exec benchctl exec --cwd "$B" --rw "$A" --rw "$(dirname "$OUT")" --timeout 7200 \
  --env N="$N" --env CORE="$CORE" --env A="$A" --env OUT="$OUT" \
  -- bash bench/ab.sh
