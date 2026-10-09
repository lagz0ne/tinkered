#!/usr/bin/env bash
# Check CPU pins with a fake probe. No code is timed or sent to benchd.
set -Eeuo pipefail
check_name=setup
scratch=
trap 'status=$?; echo "FAIL $check_name (exit $status)" >&2;
  if [ -n "$scratch" ] && [ -f "$scratch/stderr" ]; then
    cat "$scratch/stderr" >&2
  fi
  exit "$status"' ERR
cd "$(git rev-parse --show-toplevel)"
source bench/cpu-list.sh
harness=${1:-bench/ab.sh}
scratch=$(mktemp -d "$PWD/.bench-affinity.XXXXXX")
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$scratch/probe" "$scratch/queue"

runner_cpus=$(LC_ALL=C taskset -pc $$)
runner_cpus=${runner_cpus##*: }
export JOB_CPU=${runner_cpus%%[-,]*}
override_cpu=${runner_cpus##*[-,]}
if [ "$JOB_CPU" = "$override_cpu" ]; then
  echo 'affinity.test.sh: the runner needs at least two CPUs' >&2
  false
fi

check_parse() {
  local cpus=$1 expected=$2
  check_name="parse CPU list $cpus"
  test "$(last_cpu "$cpus")" = "$expected"
  echo "PASS parse=$cpus: last CPU $expected"
}

check_parse 7 7
check_parse 0-7 7
check_parse 0-2,4-6 6
check_parse 3,7 7

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
exec env -u CORE "${envs[@]}" taskset -c "$JOB_CPU" "$@"
SH
chmod +x "$scratch/probe/node" "$scratch/queue/benchctl"
export PROBE_CPUS="$scratch/cpus" QUEUE_ENVS="$scratch/envs"
export A="$PWD" B="$PWD" N=1 SCEN=op OUT="$scratch/out.csv"
probe_path="$scratch/probe:/usr/bin:/bin"

check_ab() {
  local affinity=$1 core=$2 expected=$3
  check_name="ab affinity=$affinity CORE=$core"
  : > "$PROBE_CPUS"
  : > "$scratch/stderr"
  local setting=(-u CORE)
  if [ "$core" != unset ]; then setting=(CORE="$core"); fi
  env "${setting[@]}" PATH="$probe_path" taskset -c "$affinity" \
    bash "$harness" > "$scratch/stdout" 2> "$scratch/stderr"
  diff -u <(printf '%s\n%s\n' "$expected" "$expected") "$PROBE_CPUS"
  if [ "$core" = unset ] && [[ ! "$affinity" =~ ^[0-9]+$ ]]; then
    grep -Fx "ab.sh: CPU list $affinity; picked last CPU $expected" "$scratch/stderr"
  else
    test ! -s "$scratch/stderr"
  fi
  echo "PASS affinity=$affinity CORE=$core: both probes CPU $expected"
}

check_ab "$JOB_CPU" unset "$JOB_CPU"
check_ab "$JOB_CPU" "$override_cpu" "$override_cpu"
check_ab "$runner_cpus" unset "$override_cpu"

check_queue() {
  local mode=$1 core=$2 expected=$3
  check_name="$mode CORE=$core"
  local path=$probe_path setting=(-u CORE)
  if [ "$mode" = queue ]; then path="$scratch/queue:$path"; fi
  if [ "$core" != unset ]; then setting=(CORE="$core"); fi
  : > "$PROBE_CPUS"
  : > "$QUEUE_ENVS"
  : > "$scratch/stderr"
  env "${setting[@]}" PATH="$path" taskset -c "$JOB_CPU" \
    bash bench/queued.sh > "$scratch/stdout" 2> "$scratch/stderr"
  diff -u <(printf '%s\n%s\n' "$expected" "$expected") "$PROBE_CPUS"
  if [ "$mode" = queue ]; then
    if [ "$core" = unset ]; then
      if grep -q '^CORE=' "$QUEUE_ENVS"; then
        echo 'queued.sh passed CORE when the caller left it unset' >&2
        false
      fi
    else
      grep -Fxq "CORE=$core" "$QUEUE_ENVS"
    fi
  else
    grep -q 'benchctl is missing, running straight on the host' "$scratch/stderr"
  fi
  echo "PASS $mode CORE=$core: both probes CPU $expected"
}

check_queue queue unset "$JOB_CPU"
check_queue queue "$override_cpu" "$override_cpu"
check_queue host unset "$JOB_CPU"
check_queue host "$override_cpu" "$override_cpu"
