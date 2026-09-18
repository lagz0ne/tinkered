// Eval: use Jev to decide WHETHER a whole response should be trimmed — not which
// lines. One boolean per response: does this output carry anything the goal needs?
//   keep  = contains the answer / a fact the goal needs → pass it through whole
//   trim  = all chatter / unrelated → collapse to a one-line pointer (full saved)
//
// This is a WHOLE-CALL judgment (Jev's strong zone), unlike per-fragment trimming
// (reading-intention.mjs — flat ~0%). Metric is separation, same as the others.
//   run:  node scripts/jev/evals/should-trim.mjs
import { loadKey, ask, pct } from "../lib.mjs";

// Positive, single, concrete question (Jev is literal; avoid negation/compound).
const NEEDS_Q = {
  type: "boolean",
  instructions: "Does this output contain information the goal needs?",
  criteria: {
    true: "it carries a fact, result, path, number, or error the goal needs",
    false: "it is all chatter, progress, or unrelated to the goal",
  },
};
// keep if needs >= 0.5; trim (collapse whole) if below.
const CASES = [
  {
    keep: true,
    goal: "Did the login test pass, and if not, where did it fail?",
    out: "> vitest run auth\n\nFAIL src/auth/session.test.ts > login > returns a session\nAssertionError: expected null to be an object\n  at src/auth/session.ts:42:11\n\nTest Files  1 failed\nTests  1 failed (1)",
  },
  {
    keep: false,
    goal: "Did the login test pass, and if not, where did it fail?",
    out: "npm warn deprecated some-pkg@1.2.3: use other-pkg instead\nnpm warn deprecated another@0.1.0\nFetching dependency tree...\nResolving 428 packages, deduping, linking, building fresh...\nadded 428 packages in 12s",
  },
  {
    keep: true,
    goal: "Find the function that validates the auth token",
    out: "src/auth/token.ts:44:  export function validateToken(raw) {\nsrc/auth/token.ts:45:    return verify(raw, secret);\nsrc/auth/token.ts:46:  }",
  },
  {
    keep: false,
    goal: "Find the function that validates the auth token",
    out: "$ vp install\nLockfile up to date, resolving...\nProgress: resolved 512, reused 512, downloaded 0, added 0\nDone in 1.2s",
  },
  {
    keep: true,
    goal: "What port does the server listen on?",
    out: "server:\n  host: 0.0.0.0\n  port: 8443\ncache:\n  ttlSeconds: 300",
  },
  {
    keep: false,
    goal: "Fix the null-session bug in auth; no UI changes.",
    out: "Formatting 3 files with oxfmt...\n  src/ui/button.tsx\n  src/ui/theme.css\n  src/ui/card.tsx\nAll files formatted. 0 changed.",
  },
  {
    keep: true,
    goal: "Fix the null-session bug in auth; no UI changes.",
    out: "export function createSession(user) {\n  if (!user) return null; // returns a null session\n  return { id: user.id, at: clock.now() };\n}",
  },
  {
    keep: true, // "no matches" IS the answer the goal needs
    goal: "Is there any remaining call to the old resolve() API?",
    out: "$ grep -rn '\\.resolve(' src\n(no matches)",
  },
];

if (!loadKey()) process.exit(0);

let keepP = [];
let trimP = [];
let ok = 0;
console.log("=== should-trim (whole response) eval ===");
for (const c of CASES) {
  const a = await ask({ goal: c.goal, output: c.out }, { needs: NEEDS_Q });
  const p = a.needs.probability; // high => keep
  const predictedKeep = p >= 0.5;
  const correct = predictedKeep === c.keep;
  if (correct) ok++;
  (c.keep ? keepP : trimP).push(p);
  console.log(
    `  [want ${c.keep ? "KEEP" : "trim"}] ${correct ? "✓" : "✗"} needs=${pct(p)}  :: ${c.goal.slice(0, 40)} | ${c.out.split("\n")[0].slice(0, 30)}`,
  );
}
const worst = Math.min(...keepP) - Math.max(...trimP);
const mean =
  keepP.reduce((s, p) => s + p, 0) / keepP.length - trimP.reduce((s, p) => s + p, 0) / trimP.length;
console.log(`\n  accuracy: ${ok}/${CASES.length}`);
console.log(`  worst-case separation (min-keep − max-trim): ${pct(worst)}`);
console.log(`  mean separation (mean-keep − mean-trim):      ${pct(mean)}`);
console.log(
  `\n  Strong+positive → wire a whole-response collapse into \`after\`: trim-labeled outputs\n` +
    `  become a one-line pointer to .jev/last-output.txt; keep-labeled pass through whole.`,
);
