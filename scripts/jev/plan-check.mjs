// Planning-time neutral anti-goals (ADR: docs/roadmap/jev-loop/PLAN.md).
// Reads a plan/ADR/ticket markdown file (+ the glossary) and flags upfront smells before the
// design is delegated. Judge-mode booleans. These are NOT yet calibrated on labeled cases, so
// treat every flag as "look here", never as truth. ADVISORY — exits 0.
//
//   node scripts/jev/plan-check.mjs <plan-file.md>
import { readFileSync } from "node:fs";
import { loadKey, ask, pct } from "./lib.mjs";

const file = process.argv[2];
if (!file) {
  console.error("usage: plan-check.mjs <plan-file.md>");
  process.exit(0);
}
if (!loadKey()) process.exit(0);

const plan = readFileSync(file, "utf8").slice(0, 12_000);
let glossary = "";
try {
  glossary = readFileSync("docs/glossary.md", "utf8").slice(0, 8_000);
} catch {
  /* optional */
}

const QS = {
  unfalsifiableGoal: {
    type: "boolean",
    instructions:
      "Does the plan state a goal or done-condition with no observable proof (no test, command output, or measurable result that could show it is met)?",
    criteria: {
      true: "the success condition cannot be observed or checked",
      false: "success is tied to an observable proof",
    },
  },
  bespokeModel: {
    type: "boolean",
    instructions:
      "Does the plan invent a new custom model or mechanism without naming an established precedent it is based on (such as a well-known protocol, transaction, filesystem, or library API)?",
    criteria: {
      true: "it defines a bespoke model with no cited precedent",
      false: "it anchors on a named, established precedent",
    },
  },
  multiPurpose: {
    type: "boolean",
    instructions:
      "Does the plan bundle more than one change that could ship independently of each other?",
    criteria: {
      true: "it mixes two or more separately-shippable changes",
      false: "it is one coherent, single-purpose change",
    },
  },
};

console.log(`jev plan-check (advisory, uncalibrated) — ${file}\n`);
let flags = 0;
const a = await ask({ plan }, QS);
for (const [id, q] of Object.entries(QS)) {
  const p = a[id].probability;
  if (p >= 0.5) {
    flags++;
    console.log(`  ⚠ ${id} ${pct(p)}`);
  } else console.log(`  ✓ ${id} ${pct(p)}`);
}

if (glossary) {
  const g = await ask(
    { plan, glossary },
    {
      glossaryConflict: {
        type: "boolean",
        instructions:
          "Does the plan use a defined term in a way that conflicts with its meaning in the glossary?",
        criteria: {
          true: "a term is used against its glossary definition",
          false: "terms match the glossary, or introduce clearly new terms",
        },
      },
    },
  );
  const p = g.glossaryConflict.probability;
  if (p >= 0.5) {
    flags++;
    console.log(`  ⚠ glossaryConflict ${pct(p)}`);
  } else console.log(`  ✓ glossaryConflict ${pct(p)}`);
}

console.log(`\njev plan-check: ${flags} flag(s). Look-here only — the human owns the plan.`);
process.exit(0);
