// Prose lint: flags words in markdown that have a plainer twin. A word is jargon when it has no
// row in docs/glossary.md and a plain word says the same thing. Repo terms (seam, ambient, blast
// radius, smell) are defined there, so they pass. Code spans, fences, and URLs are skipped.
//
//   node scripts/prose-lint.mjs [file…]   lint the files (default: every tracked .md that is not
//                                          frozen: docs/decisions, docs/roadmap/archive, research)
//   node scripts/prose-lint.mjs --md      print the rule table for docs/writing-style.md
//   node scripts/prose-lint.mjs --wide    per file: table rows over 100 chars, fenced lines over
//                                          60 (phones never scroll sideways); reports, never fails
//
// Exit 1 on any hit. Add a rule only with a plain twin in the `say` column.
import { execSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RULES = [
  // jargon nouns and adjectives
  ["affordance", "a way to …, a hook, a feature"],
  ["bespoke", "custom, our own"],
  ["semantics?", "meaning, behavior, rule"],
  ["orchestrat(e|es|ed|ion|ing)", "run, lead, drive"],
  ["leverag(e|es|ed|ing)", "use"],
  ["utili[sz](e|es|ed|ing)", "use"],
  ["facilitat(e|es|ed|ing)", "help, let"],
  ["plumbing", "wiring"],
  ["footguns?", "trap"],
  ["knobs?", "setting"],
  ["ergonomics?", "easy to use"],
  ["first-class", "built in, supported"],
  ["canonical", "the one, standard"],
  ["idempoten(t|cy)", "safe to repeat"],
  ["granular(ity)?", "fine, per item"],
  ["decoupl(e|es|ed|ing)", "separate"],
  ["cognitive load", "reading effort"],
  ["mental model", "picture"],
  ["opinionated", "makes fixed choices"],
  ["residue", "leftover"],
  ["jagged", "say what it is bad at"],
  ["non-?trivial(ly)?", "hard, real"],
  ["holistic(ally)?", "whole, as one"],
  ["paradigm", "model, way"],
  ["synerg(y|ies|istic)", "work together"],
  ["streamlin(e|es|ed|ing)", "simplify, shorten"],
  // latin and stiff connectors
  ["e\\.g\\.", "for example, such as"],
  ["i\\.e\\.", "that is"],
  ["per se", "as such, by itself"],
  ["de facto", "in practice"],
  ["ad hoc", "one-off"],
  ["a priori", "up front"],
  ["modulo", "except for"],
  ["vis-[àa]-vis", "against, compared with"],
  ["in order to", "to"],
  ["prior to", "before"],
  ["subsequent(ly)?", "later, next"],
  ["aforementioned", "that, the same"],
  ["whilst", "while"],
  ["albeit", "though"],
  ["hence", "so"],
  ["thus", "so"],
  ["therefore", "so"],
  // filler and hedges: delete the word
  ["simply", "delete"],
  ["clearly", "delete"],
  ["obviously", "delete"],
  ["essentially", "delete"],
  ["basically", "delete"],
  ["arguably", "delete, or say who argues it"],
  ["it (is|should be) (worth )?not(ed|ing)( that)?", "delete; state the thing"],
  ["note that", "delete; state the thing"],
  ["needless to say", "delete"],
  ["(might|may) be worth (considering|noting)", "say what to do"],
];

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const FROZEN =
  /^(docs\/decisions\/|docs\/roadmap\/archive\/|research\/|node_modules\/|.*\/node_modules\/)/;
/** Path as the repo sees it, so the frozen list matches whether the caller passed absolute or relative. */
const inRepo = (f) => relative(ROOT, resolve(f));

const rules = RULES.map(([re, say]) => ({
  re: new RegExp(`(?<![\\w-])(${re})(?![\\w-])`, "gi"),
  say,
}));

/** The prose lines of a markdown file: fenced code is dropped, inline code and URLs blanked. */
function proseLines(text) {
  let fence = null;
  return text.split("\n").map((line) => {
    const open = /^[ \t]*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length) fence = null;
      return "";
    }
    if (open) {
      fence = open[1];
      return "";
    }
    return line.replace(/`[^`]*`/g, "").replace(/https?:\/\/\S+/g, "");
  });
}

function lint(file) {
  const hits = [];
  proseLines(readFileSync(resolve(ROOT, file), "utf8")).forEach((line, i) => {
    for (const { re, say } of rules) {
      re.lastIndex = 0;
      for (let m = re.exec(line); m; m = re.exec(line)) {
        hits.push(`${file}:${i + 1}: "${m[1]}" → ${say}`);
      }
    }
  });
  return hits;
}

/** A table row (not the `| --- |` divider) that a phone cannot wrap. */
const isWideRow = (line) =>
  /^\s*\|/.test(line) && !/^\s*\|[\s|:-]*$/.test(line) && line.length > 100;

/** Wide table rows and wide fenced lines: the two things a phone cannot wrap. */
function wide(file) {
  let fence = false;
  let rows = 0;
  let code = 0;
  for (const line of readFileSync(resolve(ROOT, file), "utf8").split("\n")) {
    if (/^[ \t]*(`{3,}|~{3,})/.test(line)) fence = !fence;
    else if (fence) code += Number(line.length > 60);
    else rows += Number(isWideRow(line));
  }
  return rows || code ? `${file}: ${rows} wide table row(s), ${code} wide fenced line(s)` : null;
}

/** Every tracked .md that is not frozen; a symlink (AGENTS.md → CLAUDE.md) is its target, once. */
function trackedDocs() {
  return execSync("git ls-files '*.md'", { encoding: "utf8", cwd: ROOT })
    .split("\n")
    .filter((f) => f && !FROZEN.test(f) && !lstatSync(resolve(ROOT, f)).isSymbolicLink());
}

const args = process.argv.slice(2);
if (args[0] === "--md") {
  console.log("| instead of | say |\n| --- | --- |");
  for (const [re, say] of RULES) console.log(`| \`${re}\` | ${say} |`);
  process.exit(0);
}
const wideMode = args[0] === "--wide";
if (wideMode) args.shift();
const files = (args.length ? args.map(inRepo) : trackedDocs()).filter(
  (f) => f.endsWith(".md") && !FROZEN.test(f),
);
if (wideMode) {
  const lines = files.map(wide).filter(Boolean);
  for (const l of lines) console.log(l);
  console.log(
    `prose-lint --wide: ${lines.length} of ${files.length} file(s) have wide rows or lines`,
  );
  process.exit(0);
}
const hits = files.flatMap(lint);
for (const h of hits) console.log(h);
console.log(`prose-lint: ${hits.length} hit(s) in ${files.length} file(s)`);
process.exit(hits.length ? 1 : 0);
