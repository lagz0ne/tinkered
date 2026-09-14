#!/usr/bin/env bash
# Regression guard for style-census.sh rules that have bitten us.
# Runs the census over throwaway fixtures and asserts the S16 (preset call in
# source) count. Exits non-zero on any regression. Usage: bash style-census.selftest.sh
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
census="$here/style-census.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

s16_count() {
  bash "$census" "$1" 2>/dev/null | awk '$1 == "S16" { print $2 }'
}

fail=0
check() {
  local label=$1 want=$2 got=$3
  if [[ "$got" == "$want" ]]; then
    printf 'ok   %s (S16=%s)\n' "$label" "$got"
  else
    printf 'FAIL %s (S16 want %s, got %s)\n' "$label" "$want" "$got"
    fail=1
  fi
}

# Positive: real preset() calls in source must be flagged, incl. generics and a space.
cat >"$tmp/calls.ts" <<'TS'
import { data, preset } from "@tinker/core";
const count = data({ initial: 0 });
export const a = preset(count, 1);
export const b = preset<number>(count, 2);
export const c = preset (count, 3);
TS
check "flags real preset calls" 3 "$(s16_count "$tmp/calls.ts")"

# Negative: the definition, doc/inline comments, and string literals must not be flagged.
cat >"$tmp/clean.ts" <<'TS'
/** Seed via `createScope({ presets: [preset(node, ...)] })`. */
export function preset(node: unknown): unknown {
  return node;
}
export function preset<T>(node: T): T {
  return node;
}
export const help = "Use preset(node, value) in tests.";
const inline = 1; /** preset(a, b) */
export const near = presetFor(0);
function presetFor(n: number): number {
  return n;
}
TS
check "ignores definition, comments, strings" 0 "$(s16_count "$tmp/clean.ts")"

if (( fail )); then
  echo "style-census selftest: FAIL"
  exit 1
fi
echo "style-census selftest: OK"
