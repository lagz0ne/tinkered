// Contributor self-check BEFORE reporting (ADR: docs/roadmap/jev-loop/PLAN.md).
// Same proven judge set as review, run on your working-tree diff so you clear or explain the
// lead's usual nits first, then the per-unit lint (tools/jev/lint.mjs) on the same files. ADVISORY — never blocks your commit; exits 0. Report the flags and
// your resolutions in the "jev pre-flight" line of your contributor report.
//
//   node tools/jev/preflight.mjs [<range>]   (default: HEAD = all changes since last commit)
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

/** Per-judge status from `tools/jev/calibrate.mjs`; a `noisy` judge prints as `~` (a note, not a flag). */
const CALIBRATION = readCalibration();
import { loadKey, ask, changedSources, fileAt, JUDGES, pct, readCalibration } from "./lib.mjs";

const range = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "HEAD";
if (!loadKey()) process.exit(0);

console.log(`jev pre-flight (advisory) — clear or explain these before reporting\n`);
let flags = 0;
const files = changedSources(range);
if (files.length === 0) console.log("(no source files changed)");
for (const f of files) {
  const code = fileAt(range, f);
  if (!code.trim()) continue;
  const answers = await ask(
    { file: f, code },
    Object.fromEntries(Object.entries(JUDGES).map(([id, j]) => [id, j.q])),
  );
  const hits = Object.entries(JUDGES)
    .filter(([id, j]) => answers[id].probability >= j.threshold)
    .map(
      ([id]) =>
        `${CALIBRATION[id]?.status === "noisy" ? "~" : ""}${id} ${pct(answers[id].probability)}`,
    );
  if (hits.length) {
    flags++;
    console.log(`  ⚠ ${f}: ${hits.join(", ")}`);
  } else console.log(`  ✓ ${f}`);
}
if (files.length) {
  console.log("");
  execFileSync("node", ["tools/jev/lint.mjs", ...files.filter((f) => existsSync(f))], {
    stdio: "inherit",
  });
}
console.log(
  `\njev pre-flight: ${flags} file flag(s) plus the lint notes above. An ℹ note is a hint: no fix or label owed. A ~ hit is a calibrated-noisy judge: read it, no line owed. Every other flag: fixed or explained, then label it (tools/jev/label.mjs). Not a gate.`,
);
process.exit(0);
