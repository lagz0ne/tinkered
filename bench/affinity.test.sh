#!/usr/bin/env bash
# Check CPU pins with a fake probe. No code is timed or sent to benchd.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
harness=${1:-bench/ab.sh}
scratch=$(mktemp -d "$PWD/.bench-affinity.XXXXXX")
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$scratch/probe" "$scratch/queue"

cat > "$scratch/probe/node" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
cpus=$(LC_ALL=C taskset -pc $$)
echo "${cpus##*: }" >> "$PROBE_CPUS"
echo 'METRIC probe_ns=1 probe_b=0 mode=batch'
SH

cat > "$scratch/queue/benchctl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
envs=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    exec) shift ;;
    --env) envs+=("$2"); echo "$2" >> "$QUEUE_ENVS"; shift 2 ;;
    --cwd) cd "$2"; shift 2 ;;
    --rw|--timeout) shift 2 ;;
    --) shift; break ;;
    *) exit 1 ;;
  esac
done
exec env -u CORE "${envs[@]}" taskset -c 7 "$@"
SH
chmod +x "$scratch/probe/node" "$scratch/queue/benchctl"
export PROBE_CPUS="$scratch/cpus" QUEUE_ENVS="$scratch/envs"
export A="$PWD" B="$PWD" N=1 SCEN=op OUT="$scratch/out.csv"
probe_path="$scratch/probe:/usr/bin:/bin"

check_ab() {
  local affinity=$1 core=$2 expected=$3
  : > "$PROBE_CPUS"
  local setting=(-u CORE)
  if [ "$core" != unset ]; then setting=(CORE="$core"); fi
  env "${setting[@]}" PATH="$probe_path" taskset -c "$affinity" \
    bash "$harness" > "$scratch/stdout" 2> "$scratch/stderr"
  diff -u <(printf '%s\n%s\n' "$expected" "$expected") "$PROBE_CPUS"
  if [ "$core" = unset ] && [ "$expected" = 6 ]; then
    grep -Fx "ab.sh: CPU list $affinity has more than one CPU; picked CPU 6" "$scratch/stderr"
  else
    test ! -s "$scratch/stderr"
  fi
  echo "PASS affinity=$affinity CORE=$core: both probes CPU $expected"
}

check_ab 7 unset 7
check_ab 7 5 5
check_ab 0-7 unset 6
check_ab 0,7 unset 6

check_queue() {
  local mode=$1 core=$2 expected=$3
  local path=$probe_path setting=(-u CORE)
  if [ "$mode" = queue ]; then path="$scratch/queue:$path"; fi
  if [ "$core" != unset ]; then setting=(CORE="$core"); fi
  : > "$PROBE_CPUS"
  : > "$QUEUE_ENVS"
  env "${setting[@]}" PATH="$path" taskset -c 7 \
    bash bench/queued.sh > "$scratch/stdout" 2> "$scratch/stderr"
  diff -u <(printf '%s\n%s\n' "$expected" "$expected") "$PROBE_CPUS"
  if [ "$mode" = queue ]; then
    if [ "$core" = unset ]; then
      if grep -q '^CORE=' "$QUEUE_ENVS"; then exit 1; fi
    else
      grep -Fxq "CORE=$core" "$QUEUE_ENVS"
    fi
  else
    grep -q 'benchctl is missing, running straight on the host' "$scratch/stderr"
  fi
  echo "PASS $mode CORE=$core: both probes CPU $expected"
}

check_queue queue unset 7
check_queue queue 5 5
check_queue host unset 7
check_queue host 5 5
