#!/usr/bin/env bash
# Big-sample alternating A/B of bench/core-probe.mjs: N process runs per tree per scenario on one pinned core.
# usage: through the queue, N=61 A=../tinkered-base bench/queued.sh → .bench/ab.csv (tree,scenario,ns,bytes); summarize with a short python/awk.
# Alternating A/B, one pinned core, N process runs per tree per scenario. Output: CSV tree,scenario,ns,bytes
# ONE probe for both trees: B's bench/core-probe.mjs runs against A's build and B's build (CORE_DIST),
# so a probe change can never pose as a core change. Each "done" line counts the runs mitata timed in
# batch mode, per tree (see the probe's header).
set -u
A=${A:-../tinkered-base}            # baseline worktree under /home/paseo (benchd cannot see /tmp): git worktree add ../tinkered-base <sha>; build packages/core
B=${B:-$(git rev-parse --show-toplevel)}   # the tree under test; its probe measures both trees
N=${N:-31}
source "$(dirname "${BASH_SOURCE[0]}")/cpu-list.sh"
if [ -z "${CORE:-}" ]; then
  cpus=$(LC_ALL=C taskset -pc $$) || exit 1
  cpus=${cpus##*: }
  if [[ "$cpus" =~ ^[0-9]+$ ]]; then
    CORE=$cpus
  else
    CORE=$(last_cpu "$cpus")
    echo "ab.sh: CPU list $cpus; picked last CPU $CORE" >&2
  fi
fi
OUT=${OUT:-/tmp/ab.csv}          # set OUT when /tmp is not shared, e.g. under benchd
SCEN=${SCEN:-op run opres inline session tagged create cold warm lifecycle}
absolute() { (cd "$2" 2>/dev/null && pwd) || { echo "ab.sh: tree $1 ($2) is missing" >&2; return 1; }; }
A=$(absolute A "$A") || exit 1
B=$(absolute B "$B") || exit 1
: > "$OUT"
for s in $SCEN; do
  batchA=0; batchB=0
  for i in $(seq 1 $N); do
    for t in A B; do
      dir=${!t}
      line=$(cd "$B" && CORE_DIST="$dir/packages/core/dist/index.mjs" taskset -c "$CORE" node --expose-gc bench/core-probe.mjs $s 2>/dev/null | grep METRIC)
      if [ -z "$line" ]; then echo "ab.sh: no METRIC line from tree $t ($dir), scenario $s" >&2; exit 1; fi
      ns=$(echo "$line" | sed -E 's/.*_ns=([0-9.]+).*/\1/'); b=$(echo "$line" | sed -E 's/.*_b=([^ ]+).*/\1/')
      case "$line" in
        *mode=one*) echo "ab.sh: tree $t ($dir), scenario $s ran in one-call mode (mode=one); the probe must time in batch mode" >&2; exit 1 ;;
        *mode=batch*) if [ "$t" = A ]; then batchA=$((batchA + 1)); else batchB=$((batchB + 1)); fi ;;
      esac
      echo "$t,$s,$ns,$b" >> "$OUT"
    done
  done
  echo "done $s $(date +%H:%M:%S) batch A $batchA/$N B $batchB/$N"
done
echo ALLDONE
