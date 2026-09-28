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
// The ONE sanctioned place these live is the `systemClock` / `systemRandom` source in core.
// Each is a top-level declaration whose TSDoc carries the `@ambientSource` tag; the scan skips
// every line of a declaration so marked.
//
// Exit 1 on a violation. A `pnpm validate` lane (ADR 0016): every read is off ctx or marked.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const ROOT = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();

// The root has no parser dependency; the Jev tools do, so borrow theirs.
const { parseSync } = createRequire(`${ROOT}/tools/jev/package.json`)("oxc-parser");

/** The hidden reads the ambient clock (ADR 0034) and random (ADR 0062) replace. */
const FORBIDDEN =
  "\\bDate\\.now\\s*\\(|\\bnew Date\\s*\\(\\s*\\)|\\bperformance\\.(now|timeOrigin)\\b|" +
  "\\bMath\\.random\\s*\\(|\\bcrypto\\.randomUUID\\s*\\(|\\bcrypto\\.getRandomValues\\s*\\(";

/** The TSDoc tag that marks a declaration as a sanctioned source. */
const MARK = /(^|\s)@ambientSource(?=\s|$)/;

/** Package src and examples, never tests (a test may build a real Date or seed by hand). A git
 * pathspec `**` needs at least one folder, so files right in `src/` need their own line. */
const PATHS = [
  "packages/*/src/*.ts",
  "packages/*/src/**/*.ts",
  "examples/**/*.ts",
  "examples/**/*.tsx",
  ":(exclude)**/*.test.ts",
];

/** The 1-based line of a source offset. */
const lineOf = (src, at) => src.slice(0, at).split("\n").length;

/** The line spans `[first, last]` of each top-level declaration whose TSDoc carries the mark. */
function markedSpans(file) {
  const src = readFileSync(`${ROOT}/${file}`, "utf8");
  const { program, comments } = parseSync(file, src);
  const byStart = new Map(program.body.map((node) => [node.start, node]));
  return comments
    .filter((c) => c.type === "Block" && c.value.startsWith("*") && MARK.test(c.value))
    .map((c) => byStart.get(c.end + (src.slice(c.end).match(/^\s*/)?.[0].length ?? 0)))
    .filter((node) => node !== undefined)
    .map((node) => [lineOf(src, node.start), lineOf(src, node.end)]);
}

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

// A hit inside a marked declaration is the sanctioned source; drop those.
const spans = new Map();
const offenders = hits
  .split("\n")
  .filter((line) => line !== "")
  .filter((line) => {
    const [file, at] = line.split(":", 2);
    if (!spans.has(file)) spans.set(file, markedSpans(file));
    const n = Number(at);
    return !spans.get(file).some(([first, last]) => first <= n && n <= last);
  });

if (offenders.length === 0) {
  console.log("check-ambient: every time/random read is off ctx or inside an @ambientSource");
  process.exit(0);
}

console.error("check-ambient: read time/randomness off ctx, not a hidden global (ADR 0034, 0062):");
for (const line of offenders) console.error(`  ${line}`);
console.error(
  "\nUse ctx.clock / ctx.random. Only the systemClock/systemRandom declarations carry the " +
    "`@ambientSource` TSDoc tag; nothing else may.",
);
process.exit(1);
