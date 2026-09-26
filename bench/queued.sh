#!/usr/bin/env bash
# Run bench/ab.sh through benchd, the box's benchmark queue.
# The queue runs one job at a time, so "an idle host" stops being a hope.
# Same settings as ab.sh: N, CORE, A, OUT, SCEN.
# One job per scenario: the queue stops a job at 1 hour, and N=61 of all ten takes ~95 minutes.
set -uo pipefail
B=$(git rev-parse --show-toplevel)
A=${A:-$(dirname "$B")/tinkered-base}   # a sibling worktree; /tmp is not shared with the host
OUT=${OUT:-$B/.bench/ab.csv}
N=${N:-31}
CORE=${CORE:-6}
SCEN=${SCEN:-op run opres inline session tagged create cold warm lifecycle}

if [ ! -d "$A" ]; then
  echo "queued.sh: the baseline tree $A is missing." >&2
  echo "  git worktree add $A <sha>   # then link node_modules and vp pack packages/core" >&2
  echo "  (keep it under /home/paseo: /tmp is not shared with the host)" >&2
  exit 1
fi
mkdir -p "$(dirname "$OUT")"
: > "$OUT"

if ! command -v benchctl >/dev/null; then
  echo "queued.sh: benchctl is missing, running straight on the host" >&2
  exec env N="$N" CORE="$CORE" A="$A" B="$B" OUT="$OUT" SCEN="$SCEN" bash bench/ab.sh
fi

# benchctl maps --cwd and --rw to host paths, but not --env values.
# So A, B, and OUT go in relative to B, the job's working folder.
rel() { realpath -m --relative-to="$B" "$1"; }
part=$(dirname "$OUT")/.part.csv

echo "queued.sh: N=$N core=$CORE" >&2
echo "  A $A" >&2
echo "  B $B" >&2
echo "  -> $OUT" >&2
for s in $SCEN; do
  benchctl exec --cwd "$B" --rw "$A" --rw "$(dirname "$OUT")" --timeout 3600 \
    --env N="$N" --env CORE="$CORE" --env SCEN="$s" \
    --env A="$(rel "$A")" --env B=. --env OUT="$(rel "$part")" \
    -- bash bench/ab.sh || { echo "queued.sh: scenario $s failed" >&2; rm -f "$part"; exit 1; }
  cat "$part" >> "$OUT"
done
rm -f "$part"
echo ALLDONE
