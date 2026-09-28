// Jev docs (advisory): coding-convention rule 10 over TSDoc blocks. Per file: the plain S26 rows
// (a doc the TSDoc parser rejects, a @param naming no parameter), then each doc Jev reads as a
// restatement of its declaration (docRestatesCode), with its probability. Exits 0 always.
//
//   node tools/jev/docs.mjs <files or globs…> [--plain]
//   --plain runs only the parser: no model call, no key needed
//   globs are Node's (`**`, `{ts,tsx}`); node_modules, dist, and .d.ts files never count
import { existsSync, globSync, readFileSync, statSync } from "node:fs";
import { loadKey, ask, pct, readCalibration } from "./lib.mjs";
import { DOCS, sliceDocs, forDocJev } from "./bank.mjs";
import { tsdocRows } from "./plain.mjs";

const JUDGE = "docRestatesCode";
const args = process.argv.slice(2);
const plainOnly = args.includes("--plain");
const specs = args.filter((a) => !a.startsWith("--"));
const noisy = readCalibration()[JUDGE]?.status === "noisy";

const SOURCE = /\.tsx?$/;
const SKIPPED = /(^|\/)(node_modules|dist)\/|\.d\.ts$/;

/** The source files the arguments name: a file passes through, anything else is a glob. */
function listFiles() {
  const found = specs.flatMap((s) =>
    existsSync(s) && statSync(s).isFile() ? [s] : globSync(s, { exclude: (p) => SKIPPED.test(p) }),
  );
  return [...new Set(found)].filter((f) => SOURCE.test(f) && !SKIPPED.test(f)).sort();
}

/** The folder a count groups by: `packages/core`, `apps/website`, `examples/sync`. */
const folderOf = (file) => file.split("/").slice(0, 2).join("/");

/** Jev's hits among one file's docs: [{ line, name, p }] at or above the judge's threshold. */
async function hitsIn(source, file) {
  const hits = [];
  for (const block of sliceDocs(source, file)) {
    if (block.declaration === "") continue;
    const p = (await ask(forDocJev(block), { [JUDGE]: DOCS[JUDGE].q }))[JUDGE].probability;
    if (p >= DOCS[JUDGE].threshold) hits.push({ line: block.line, name: block.name, p });
  }
  return hits;
}

if (specs.length === 0) {
  console.error("usage: node tools/jev/docs.mjs <files or globs…> [--plain]");
  process.exit(0);
}
const hasKey = !plainOnly && loadKey();
const files = listFiles();
const byFolder = {};
let plainRows = 0;
let jevHits = 0;
console.log(`jev docs (advisory) — ${files.length} file(s)${plainOnly ? ", parser only" : ""}\n`);
for (const file of files) {
  const source = readFileSync(file, "utf8");
  const rows = tsdocRows(source, file);
  const hits = hasKey ? await hitsIn(source, file) : [];
  if (rows.length === 0 && hits.length === 0) continue;
  console.log(file);
  for (const r of rows) console.log(`  ▪ L${r.line} ${r.id}: ${r.message}`);
  for (const h of hits)
    console.log(`  ${noisy ? "~" : "⚠"} L${h.line} ${h.name || "(no name)"}: ${JUDGE} ${pct(h.p)}`);
  plainRows += rows.length;
  jevHits += hits.length;
  if (rows.length > 0) byFolder[folderOf(file)] = (byFolder[folderOf(file)] ?? 0) + rows.length;
}

const asked = hasKey ? `, ${jevHits} ${JUDGE} hit(s)` : "";
console.log(`\njev docs: ${files.length} file(s), ${plainRows} S26 row(s)${asked}.`);
console.log(`S26 by folder: ${JSON.stringify(byFolder)}`);
if (!plainOnly && !hasKey) console.log("No key: the parser ran; no judge did.");
console.log(
  `Advisory only — an S26 row is a doc to fix; a ${JUDGE} hit is fixed or explained, then labeled. Fix: ${DOCS[JUDGE].fix}`,
);
process.exit(0);
