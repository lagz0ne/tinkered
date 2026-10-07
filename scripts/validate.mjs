// t19 release gate (ADR 0016): run every DETERMINISTIC budget lane and report. Wall-clock lanes
// (timing) run separately via `bench` in a sandbox; heap is a memory delta and runs here.
import { execSync } from "node:child_process";

const VP = "/home/paseo/.local/vp/bin/vp";
const strip = "node --experimental-strip-types";
const lanes = [
  ["lint/types/format/complexity", `${VP} check`],
  [
    "module endings in docs, registry JSON, and templates",
    "node --test scripts/strip-import-extensions.test.mjs scripts/check-import-extensions.test.mjs && node scripts/check-import-extensions.mjs",
  ],
  ["tests", `${VP} run --no-cache core#test`],
  // core/size-build: the build renames private fields, so the tests also run on what users import.
  ["core tests on the built files", `${VP} run --no-cache core#test:dist`],
  ["core size (<= 16 KiB gzip)", `${VP} run --no-cache core#size`],
  ["promises (0 sync / <=10 async)", `${strip} bench/promises.mjs`],
  ["deep-chain (no overflow)", `${strip} bench/deep.mjs`],
  ["live-heap-per-request", `node --expose-gc --experimental-strip-types bench/heap.mjs`],
  ["CRAP ceiling", `node scripts/check-crap.mjs ${process.argv[2] ?? 0.6}`],
  // perf/session-slots: V8 gives each top-level name of the bundle a slot; above 255 every use
  // takes a wide bytecode. Names above the release block stay at or below 255. "show" prints
  // the lane's output on PASS too: the headroom.
  ["core hot names at V8 slot <= 255 (release block last)", "node scripts/check-slots.mjs", "show"],
  // The graph produces the trace (ADR 0058): no hand-rolled span outside core, and a package
  // that declares operations ships a span-tree test.
  ["graph (span-tree per source owner, no hand-rolled span)", `${strip} scripts/check-graph.mjs`],
  // Ambient time/random (ADR 0034, 0062): read "now" and randomness off ctx, never a hidden
  // global; only the systemClock/systemRandom declarations carry the `@ambientSource` TSDoc tag.
  ["ambient reads off ctx (no bare time/random)", `node scripts/check-ambient.mjs`],
  ["cast-free examples (0 casts)", "node scripts/check-example-casts.mjs examples/core"],
  [
    "core runtime and testing entries (package imports only)",
    "node scripts/check-core-entries.mjs",
  ],
  // Copied blueprint (ADR 0052, blueprint-v1 t01/t05): the size promise; zod, yaml,
  // and @tinker/* stay out of dist at runtime; the binary ships its corpus and evals.
  ["blueprint tests", `${VP} run --no-cache blueprint#test`],
  ["blueprint size (<= 20 kB gzip)", `${VP} run --no-cache blueprint#size`],
  ["blueprint source retains corpus and evals", "node tools/blueprint/scripts/check-corpus.mjs"],
  [
    "two hands (ADR 0051: Scope.Handle only at a root, in a driver src, or a test)",
    "scripts/two-hands.sh",
  ],
];

let failed = 0;
for (const [name, cmd, show] of lanes) {
  try {
    const out = execSync(cmd, { stdio: "pipe", cwd: process.cwd() }).toString().trim();
    console.log(`PASS  ${name}`);
    if (show === "show" && out) console.log(out.replace(/^/gm, "        "));
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name}`);
    const lines = `${e.stdout ?? ""}${e.stderr ?? ""}`.toString().trim().split("\n");
    // Name each failed test (vitest's ` FAIL ` rows), then the tail: a tail alone can hide the name.
    const named = lines.filter((line) => /^\s*FAIL\s/.test(line));
    const out = [...new Set([...named, ...lines.slice(-3)])].join("\n");
    if (out) console.log(out.replace(/^/gm, "        "));
  }
}
console.log("Mutation lanes: run core and react alone (floor 85).");
console.log(
  `Timing lanes:  run via \`benchctl exec -- ${strip} bench/<lane>.mjs\` from a clean worktree (the queue; never by hand).\n` +
    `               bench/warm-read.mjs: a warm read is O(1) in chain depth (moved out of core#test, tests/busy-host-flake).`,
);
console.log(
  failed ? `\n${failed} lane(s) FAILED` : `\nAll deterministic budget lanes PASS (${lanes.length})`,
);
process.exit(failed ? 1 : 0);
