// Eval: once a response needs trimming, let Jev pick HOW (a choice), and the SCRIPT
// executes the chosen strategy deterministically. Jev routes; code cuts.
//
// Strategies (all deterministic, generic — no per-line judgment):
//   whole   — keep as-is (it is all signal)
//   pointer — collapse everything to a one-line pointer (all chatter)
//   head    — keep the first lines + pointer (answer is up top: usage, header)
//   tail    — keep the last lines + pointer (answer is at the end: build/test summary)
//   errors  — keep only lines matching error/fail/warn patterns + pointer
//
// Choice is a CLASSIFIER: trust the pick only at prob >= 60% (proven weaker than boolean).
//   run:  node scripts/jev/evals/trim-how.mjs
import { loadKey, ask, pct } from "../lib.mjs";

const HOW_Q = {
  type: "choice",
  instructions:
    "This output must be shortened. Which single strategy keeps what the goal needs and drops the rest?",
  criteria: {
    whole: "almost all of it matters; do not shorten",
    pointer: "none of it matters; replace it all with a pointer",
    head: "what the goal needs is in the first lines",
    tail: "what the goal needs is in the last lines",
    errors: "what the goal needs is the error / failure / warning lines scattered inside",
  },
};
const MIN = 0.6;
const CASES = [
  {
    expect: "errors",
    goal: "Did the test pass, and where did it fail?",
    out:
      "RUN v2 setup...\nloading 40 files\n" +
      Array(20).fill("PASS trivial").join("\n") +
      "\nFAIL src/auth/session.test.ts:42\nAssertionError: expected null to be object\n" +
      Array(10).fill("PASS other").join("\n"),
  },
  {
    expect: "tail",
    goal: "Did the build succeed?",
    out:
      Array(40).fill("compiling module...").join("\n") +
      "\nBuilt 40 modules in 3.1s\nBuild succeeded.",
  },
  {
    expect: "head",
    goal: "What is the usage line for this command?",
    out:
      "Usage: vp <command> [options]\n\n" +
      Array(40).fill("  --some-flag   a long description").join("\n"),
  },
  {
    expect: "pointer",
    goal: "Fix the null-session bug in auth.",
    out:
      Array(30).fill("npm warn deprecated pkg@1: use other").join("\n") +
      "\nadded 428 packages in 12s",
  },
  {
    expect: "whole",
    goal: "Read the createSession implementation.",
    out: "export function createSession(user) {\n  if (!user) return null;\n  return { id: user.id, at: clock.now() };\n}",
  },
];

if (!loadKey()) process.exit(0);
let ok = 0;
console.log("=== trim-how (strategy choice) eval ===");
for (const c of CASES) {
  const a = await ask({ goal: c.goal, output: c.out }, { how: HOW_Q });
  const got = a.how.choice;
  const conf = a.how.probabilities[got];
  const pass = got === c.expect;
  if (pass) ok++;
  console.log(
    `  ${pass ? "✓" : "✗"} want=${c.expect} got=${got} (${pct(conf)})${conf >= MIN ? "" : " — below 60%, keep whole"}  :: ${c.goal.slice(0, 38)}`,
  );
}
console.log(
  `\n  -> ${ok}/${CASES.length} correct; trust a pick only at >= ${pct(MIN)}, else keep whole (safe default).`,
);
