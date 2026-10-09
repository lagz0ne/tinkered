#!/usr/bin/env bash
# taskset lists CPUs in order; the final entry may be a range.
last_cpu() {
  local last=${1##*,}
  printf '%s\n' "${last##*-}"
}
