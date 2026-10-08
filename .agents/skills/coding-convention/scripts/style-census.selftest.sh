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

mkdir -p "$tmp/apps/demo/src" "$tmp/examples" "$tmp/packages/demo/src"
cat >"$tmp/apps/demo/src/units.tsx" <<'TS'
import { operation, resource, tag, data, operation as op } from "@tinker/core";
import * as core from "@tinker/core";
const top = operation({ run: () => 1 });
function build() {
  operation({ run: () => 1 });
  resource({ factory: () => 1 });
  tag({ label: "x" });
  data({ initial: 0 });
  op({ run: () => 1 });
  core.operation({ run: () => 1 });
}
const View = () => { data({ initial: 1 }); return <div />; };
class App {
  field = resource({ factory: () => 1 });
  static field = tag({ label: "y" });
  static { core["data"]({ initial: 2 }); }
}
TS
check "flags app functions, aliases, views, and class bodies" P05 10 "$(id_count P05 "$tmp/apps/demo/src/units.tsx")"
cp "$tmp/apps/demo/src/units.tsx" "$tmp/examples/units.tsx"
check "checks examples" P05 10 "$(id_count P05 "$tmp/examples/units.tsx")"
cp "$tmp/apps/demo/src/units.tsx" "$tmp/packages/demo/src/units.tsx"
check "keeps app builder rule off library source" P05 0 "$(id_count P05 "$tmp/packages/demo/src/units.tsx")"
cp "$tmp/apps/demo/src/units.tsx" "$tmp/apps/demo/src/units.test.tsx"
check "skips builder calls in tests" P05 0 "$(id_count P05 "$tmp/apps/demo/src/units.test.tsx")"
cat >"$tmp/apps/demo/src/clean.ts" <<'TS'
import { operation, resource as res } from "@tinker/core";
import * as core from "@tinker/core";
import { data } from "elsewhere";
export const top = res({ factory: () => 1 });
/** operation({}) */
const text = "resource({})";
function foreign() { data({}); }
function shadow(operation, core) { operation({}); core.data({}); }
function local() { const res = () => 1; res({}); }
TS
check "ignores top-level units, foreign names, shadows, docs, and strings" P05 0 "$(id_count P05 "$tmp/apps/demo/src/clean.ts")"
cat >"$tmp/apps/demo/src/blocks.ts" <<'TS'
import { operation } from "@tinker/core";
function blocks() {
  { const operation = () => 1; operation({}); }
  operation({ run: () => 1 });
}
function hoisted() {
  operation({});
  if (true) { var operation = () => 1; }
}
TS
check "keeps a block shadow local and a var shadow in its function" P05 1 "$(id_count P05 "$tmp/apps/demo/src/blocks.ts")"
cat >"$tmp/packages/demo/src/promises.ts" <<'TS'
function dropped(p, yes) {
  p.then(done);
  void p.then(done);
  p?.then(done);
  yes ? p.then(done) : p.then(fail);
  yes && p.then(done);
  (p.then(done), 1);
}
async function kept(p) {
  const next = p.then(done);
  await p.then(done);
  consume(p.then(done));
  p.then(done).catch(fail);
  /** p.then(done) */
  const text = "p.then(done)";
  return p.then(done);
}
TS
check "flags only discarded then promises, including void and branches" P06 7 "$(id_count P06 "$tmp/packages/demo/src/promises.ts")"
cp "$tmp/packages/demo/src/promises.ts" "$tmp/apps/demo/src/promises.ts"
check "keeps library then rule off app source" P06 0 "$(id_count P06 "$tmp/apps/demo/src/promises.ts")"
cp "$tmp/packages/demo/src/promises.ts" "$tmp/packages/demo/src/promises.test.ts"
check "skips then promises in tests" P06 0 "$(id_count P06 "$tmp/packages/demo/src/promises.test.ts")"
for fixture in "$tmp/apps/demo/src/units.tsx" "$tmp/packages/demo/src/promises.ts"; do
  if bash "$census" "$fixture" --strict >"$tmp/fast-strict.log" 2>&1; then
    echo "FAIL fast-code rule passed strict mode: $fixture"
    fail=1
  fi
done

if (( fail )); then
  echo "style-census selftest: FAIL"
  exit 1
fi
echo "style-census selftest: OK"
