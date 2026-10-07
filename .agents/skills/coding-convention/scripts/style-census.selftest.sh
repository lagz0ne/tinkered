#!/usr/bin/env bash
# Regression guard for style-census.sh rules that have bitten us.
# Runs the census over throwaway fixtures and asserts per-id counts: S16 (preset
# call in source), and S11/S14 blind to TSDoc text. Exits non-zero on any regression.
# Usage: bash style-census.selftest.sh
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
census="$here/style-census.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

id_count() {
  bash "$census" "$2" 2>/dev/null | awk -v id="$1" '$1 == id { print $2 }'
}

fail=0
check() {
  local label=$1 id=$2 want=$3 got=$4
  if [[ "$got" == "$want" ]]; then
    printf 'ok   %s (%s=%s)\n' "$label" "$id" "$got"
  else
    printf 'FAIL %s (%s want %s, got %s)\n' "$label" "$id" "$want" "$got"
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
check "flags real preset calls" S16 3 "$(id_count S16 "$tmp/calls.ts")"

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
check "ignores definition, comments, strings" S16 0 "$(id_count S16 "$tmp/clean.ts")"

# Negative: `a/*b` and `x[0]` inside TSDoc, single- and multi-line, are not S11/S14 hits.
cat >"$tmp/doc.ts" <<'TS'
/** Matches a/*b paths; reads x[0] first. */
export const one = 1;
/**
 * Matches a/*b paths.
 * Reads x[0] first.
 */
export const two = 2;
export const path = "src/**/x";
TS
check "ignores a/*b in TSDoc" S11 0 "$(id_count S11 "$tmp/doc.ts")"
check "ignores x[0] in TSDoc" S14 0 "$(id_count S14 "$tmp/doc.ts")"

# Positive: the same text in code still counts, also after `*/` or before `/**` on a line.
cat >"$tmp/code.ts" <<'TS'
declare const a: number, b: number, x: number[];
export const c = a/*b*/ + b;
export const y = x[0] + 1;
/** Doc. */ export const d = x[0] + a/*b*/;
export const e = x[1] + 1; /** Doc. */
/**
 * Doc.
 */ export const f = x[2] + 1;
export const g = "/**"; export const h = x[3] + 1;
TS
check "flags a/*b in code" S11 2 "$(id_count S11 "$tmp/code.ts")"
check "flags x[0] in code" S14 5 "$(id_count S14 "$tmp/code.ts")"

# Positive: a "/**" inside a template string, on its own later line or all on one, opens no doc.
cat >"$tmp/template.ts" <<'TS'
declare const x: number[];
export const t = `
/** looks like a doc
`;
export const a = x[0] + 1;
export const u = `/** one line */`; export const b = x[1] + 1;
TS
check "flags x[0] after a template holding /**" S14 2 "$(id_count S14 "$tmp/template.ts")"

# Build the bad endings so the repo cleanup does not rewrite this negative fixture.
ts='.ts'
tsx='.tsx'
mts='.mts'
cat >"$tmp/imports.mts" <<TS
import a from "./a${ts}";
export * from './b${tsx}';
import(
  "./c${mts}"
);
type D = import("./d${ts}").D;
TS
check "flags static, export, dynamic, and type imports" S17 4 "$(id_count S17 "$tmp/imports.mts")"
if bash "$census" "$tmp/imports.mts" --strict >"$tmp/strict.log" 2>&1; then
  echo "FAIL bad import endings passed strict mode"
  fail=1
fi
cat >"$tmp/imports.test.ts" <<'TS'
import { x } from "../src/index";
export * from "./b";
import "./plain.mjs";
import "./style.css";
import "./data.json";
import "./asset.ts?url";
const path = "./file.ts";
TS
check "keeps extensionless modules, assets, queries, and plain strings" S17 0 "$(id_count S17 "$tmp/imports.test.ts")"
check "allows the extensionless public test entry" T04 0 "$(id_count T04 "$tmp/imports.test.ts")"

if (( fail )); then
  echo "style-census selftest: FAIL"
  exit 1
fi
echo "style-census selftest: OK"
