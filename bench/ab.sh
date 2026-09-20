#!/usr/bin/env bash
# Big-sample alternating A/B of bench/core-probe.mjs: N process runs per tree per scenario on one pinned core.
# usage: N=31 CORE=6 A=/tmp/tinkered-base bench/ab.sh   → /tmp/ab.csv (tree,scenario,ns,bytes); summarize with a short python/awk.
# Alternating A/B, one pinned core, N process runs per tree per scenario. Output: CSV tree,scenario,ns,bytes
set -u
A=${A:-/tmp/tinkered-base}            # baseline worktree: git worktree add /tmp/tinkered-base <sha>; link node_modules; vp pack in packages/core
B=${B:-$(git rev-parse --show-toplevel)}   # the tree under test
N=${N:-31}
CORE=${CORE:-6}
OUT=/tmp/ab.csv
: > "$OUT"
for s in op run opres inline session tagged create cold warm lifecycle; do
  for i in $(seq 1 $N); do
    for t in A B; do
      dir=${!t}
      line=$(cd "$dir" && taskset -c $CORE node --expose-gc bench/core-probe.mjs $s 2>/dev/null | grep METRIC)
      ns=$(echo "$line" | sed -E 's/.*_ns=([0-9.]+).*/\1/'); b=$(echo "$line" | sed -E 's/.*_b=([^ ]+).*/\1/')
      echo "$t,$s,$ns,$b" >> "$OUT"
    done
  done
  echo "done $s $(date +%H:%M:%S)"
done
echo ALLDONE
