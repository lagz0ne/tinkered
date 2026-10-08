// Jev docs (advisory): coding-convention rule 10 over TSDoc blocks. Per file: the plain S26 rows
// (a doc the TSDoc parser rejects, a @param naming no parameter). No doc judge is live: ADR 0054
// retired `docRestatesCode` (bank.mjs DOCS). Exits 0 always.
//
//   node tools/jev/docs.mjs <files or globs…> [--plain]
//   --plain is kept so older commands run; the parser is all that runs, no key needed
//   globs are Node's (`**`, `{ts,tsx}`); node_modules, dist, and .d.ts files never count
import { existsSync, globSync, readFileSync, statSync } from "node:fs";
import { tsdocRows } from "./plain.mjs";

const specs = process.argv.slice(2).filter((a) => !a.startsWith("--"));

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

if (specs.length === 0) {
  console.error("usage: node tools/jev/docs.mjs <files or globs…> [--plain]");
  process.exit(0);
}

const files = listFiles();
const byFolder = {};
let plainRows = 0;
console.log(`jev docs (advisory) — ${files.length} file(s), parser only\n`);

for (const file of files) {
  const rows = tsdocRows(readFileSync(file, "utf8"), file);
  if (rows.length === 0) continue;
  console.log(file);
  for (const r of rows) console.log(`  ▪ L${r.line} ${r.id}: ${r.message}`);
  plainRows += rows.length;
  byFolder[folderOf(file)] = (byFolder[folderOf(file)] ?? 0) + rows.length;
}

console.log(`\njev docs: ${files.length} file(s), ${plainRows} S26 row(s).`);
console.log(`S26 by folder: ${JSON.stringify(byFolder)}`);

console.log(
  "Advisory only — an S26 row is a doc to fix. Whether a doc says what code cannot is the reviewer's call (rule 10).",
);

process.exit(0);
