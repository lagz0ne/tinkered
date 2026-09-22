#!/usr/bin/env node
// Ambient capabilities as plain code (ADR 0034 clock, ADR 0062 random). Read "now" and
// randomness off `ctx`, never off a hidden global — that is what makes time- and
// random-dependent code testable without mocks.
//
//   node scripts/check-ambient.mjs        scan every package src and every example
//
// Forbidden in a unit body (and anywhere in package src / examples, minus tests):
//   Date.now(  ·  new Date()  ·  performance.now/timeOrigin  ·  Math.random(
//   crypto.randomUUID(  ·  crypto.getRandomValues(
// Read instead: `ctx.clock.currentTimeMillis()` / `new Date(clock.currentTimeMillis())`,
// `ctx.random.next()` / `ctx.random.uuid()`.
//
// The ONE sanctioned place these live is the `systemClock` / `systemRandom` source in core;
// mark each such line with the trailing comment `ambient-source` and the scan skips it.
//
// Exit 1 on a violation. A `pnpm validate` lane (ADR 0016): every read is off ctx or marked.
import { execSync } from "node:child_process";

const ROOT = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();

/** The hidden reads the ambient clock (ADR 0034) and random (ADR 0062) replace. */
const FORBIDDEN =
  "\\bDate\\.now\\s*\\(|\\bnew Date\\s*\\(\\s*\\)|\\bperformance\\.(now|timeOrigin)\\b|" +
  "\\bMath\\.random\\s*\\(|\\bcrypto\\.randomUUID\\s*\\(|\\bcrypto\\.getRandomValues\\s*\\(";

/** Package src and examples, never tests (a test may build a real Date or seed by hand). */
const PATHS = [
  "packages/*/src/**/*.ts",
  "examples/**/*.ts",
  "examples/**/*.tsx",
  ":(exclude)**/*.test.ts",
];

let hits;
try {
  hits = execSync(
    `git grep --untracked -nE '${FORBIDDEN}' -- ${PATHS.map((p) => `'${p}'`).join(" ")}`,
    {
      cwd: ROOT,
      encoding: "utf8",
    },
  );
} catch {
  hits = ""; // git grep exits 1 when nothing matches — the clean case
}

// A sanctioned source line carries the `ambient-source` marker; drop those.
const offenders = hits.split("\n").filter((line) => line && !line.includes("ambient-source"));

if (offenders.length === 0) {
  console.log("check-ambient: every time/random read is off ctx or marked ambient-source");
  process.exit(0);
}

console.error("check-ambient: read time/randomness off ctx, not a hidden global (ADR 0034, 0062):");
for (const line of offenders) console.error(`  ${line}`);
console.error(
  "\nUse ctx.clock / ctx.random. The systemClock/systemRandom source lines carry the " +
    "`ambient-source` marker; nothing else may.",
);
process.exit(1);
