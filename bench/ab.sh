#!/usr/bin/env bash
# Big-sample alternating A/B of bench/core-probe.mjs: N process runs per tree per scenario on one pinned core.
# usage: through the queue, N=61 A=../tinkered-base bench/queued.sh → .bench/ab.csv (tree,scenario,ns,bytes); summarize with a short python/awk.
# Alternating A/B, one pinned core, N process runs per tree per scenario. Output: CSV tree,scenario,ns,bytes
set -u
A=${A:-../tinkered-base}            # baseline worktree under /home/paseo (benchd cannot see /tmp): git worktree add ../tinkered-base <sha>; build packages/core
B=${B:-$(git rev-parse --show-toplevel)}   # the tree under test
N=${N:-31}
CORE=${CORE:-6}
OUT=${OUT:-/tmp/ab.csv}          # set OUT when /tmp is not shared, e.g. under benchd
SCEN=${SCEN:-op run opres inline session tagged create cold warm lifecycle}
: > "$OUT"
for s in $SCEN; do
  for i in $(seq 1 $N); do
    for t in A B; do
      dir=${!t}
      line=$(cd "$dir" && taskset -c $CORE node --expose-gc bench/core-probe.mjs $s 2>/dev/null | grep METRIC)
      if [ -z "$line" ]; then echo "ab.sh: no METRIC line from tree $t ($dir), scenario $s" >&2; exit 1; fi
      ns=$(echo "$line" | sed -E 's/.*_ns=([0-9.]+).*/\1/'); b=$(echo "$line" | sed -E 's/.*_b=([^ ]+).*/\1/')
      echo "$t,$s,$ns,$b" >> "$OUT"
    done
  done
  echo "done $s $(date +%H:%M:%S)"
done
echo ALLDONE
