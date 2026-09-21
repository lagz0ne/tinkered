// Impact diff for the lead review (ADR 0047, narrowed by ADR 0054: plain code only).
// Compares the plan's declared blast radius (the ```impact <tag> block in the track's
// PROGRESS.md) against SCIP's actual refs per symbol and prints every discrepancy —
// a file the plan named or the code touched, not both. The lead decides which side is
// wrong; no model call. ADVISORY ONLY — always exits 0, never a gate.
//
//   node tools/jev/impact.mjs <tag> [range] [--block <file>]
//   range defaults to <tag>~1..<tag> (or HEAD~1..HEAD when the tag does not exist).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync, execSync } from "node:child_process";

function progressFiles() {
  try {
    return readdirSync("docs/roadmap", { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join("docs/roadmap", d.name, "PROGRESS.md"));
  } catch {
    return [];
  }
}

function readLines(f) {
  try {
    return readFileSync(f, "utf8").split("\n");
  } catch {
    return [];
  }
}

function parseBlockLine(line) {
  const parts = line.split(/\s+/);
  if (parts.length < 2) return null;
  const [pkg, symbol, ...files] = parts;
  const none = files.length === 1 && files[0] === "(none)";
  return { pkg, symbol, expected: none ? [] : files, none };
}

/** Find the ```impact <tag> fence; null when no block declares this tag. */
function readBlock(tag, blockFile) {
  const files = blockFile ? [blockFile] : progressFiles();
  for (const f of files) {
    const lines = readLines(f);
    const open = lines.findIndex((l) => l.trim() === "```impact " + tag);
    if (open < 0) continue;
    const close = lines.findIndex((l, i) => i > open && l.trim().startsWith("```"));
    return lines
      .slice(open + 1, close < 0 ? undefined : close)
      .map((l) => l.trim())
      .filter(Boolean)
      .map(parseBlockLine)
      .filter(Boolean);
  }
  return null;
}

function addDef(line, found, name) {
  const m = line.match(/^(\S+)\s+->\s+(\S+)$/);
  if (!m || m[1] !== name) return;
  const file = m[2].split(":")[0];
  found.defs.push(file);
  found.files.add(file);
}

function addRef(line, found, name) {
  const m = line.match(/^\d+\s+(\S+)\s+(\S+)$/);
  if (m && m[1] === name) found.files.add(m[2]);
}

/** Run scip refs for one block line; return {defs:[file], files:Set} (empty on failure).
 *  The name is a plain substring search; only rows matching it exactly are kept. */
function readRefs(pkg, name) {
  const found = { defs: [], files: new Set() };
  let out = "";
  try {
    out = execFileSync("scripts/scip.sh", ["refs", name, pkg], {
      encoding: "utf8",
    });
  } catch {
    return found;
  }
  let section = "";
  for (const raw of out.split("\n")) {
    const line = raw.trim();
    if (line === "definitions") section = "defs";
    else if (line.startsWith("references")) section = "refs";
    else if (section === "defs") addDef(line, found, name);
    else if (section === "refs") addRef(line, found, name);
  }
  return found;
}

const EXPORT_RE =
  /^\+export (?:async )?(?:const|function|class|interface|type|declare namespace) (\w+)/;
const REMOVED_RE =
  /^-export (?:async )?(?:const|function|class|interface|type|declare namespace) (\w+)/;

function parseDiffExports(text, pkg, lines) {
  const added = new Map();
  const removed = new Set();
  let file = "";
  for (const line of text.split("\n")) {
    if (line.startsWith("+++ b/")) {
      const path = line.slice(6).replace(`packages/${pkg}/`, "");
      // Only source files declare a public surface: README fences, examples, and tests
      // also contain `export` lines but are not the package's API.
      file = path.startsWith("src/") ? path : "";
    }
    const a = line.match(EXPORT_RE);
    if (a && file && !added.has(a[1])) added.set(a[1], file);
    const r = line.match(REMOVED_RE);
    if (r) removed.add(r[1]);
  }
  return [...added]
    .filter(([name]) => !removed.has(name) && !lines.some((l) => name === l.symbol))
    .map(([name, f]) => ({ name, file: f, pkg }));
}

/** Added `export` names in the range diff that no same-package block line covers. */
function findUndeclared(range, pkg, lines) {
  try {
    const text = execSync(`git diff ${range} -- packages/${pkg}`, {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
    return parseDiffExports(
      text,
      pkg,
      lines.filter((l) => l.pkg === pkg),
    );
  } catch {
    return [];
  }
}

/** Deterministic set-diff per line (unexpected / missing), then undeclared exports. */
function findDiscrepancies(lines, actuals, undeclared) {
  const out = [];
  lines.forEach((ln, i) => {
    const actual = actuals[i].files;
    if (ln.none) {
      actuals[i].defs.forEach((f) =>
        out.push({ symbol: ln.symbol, kind: "unexpected", file: f, pkg: ln.pkg }),
      );
      return;
    }
    const exp = new Set(ln.expected);
    [...actual]
      .filter((f) => !exp.has(f))
      .sort((a, b) => (a < b ? -1 : 1))
      .forEach((f) => out.push({ symbol: ln.symbol, kind: "unexpected", file: f, pkg: ln.pkg }));
    ln.expected
      .filter((f) => !actual.has(f))
      .forEach((f) => out.push({ symbol: ln.symbol, kind: "missing", file: f, pkg: ln.pkg }));
  });
  undeclared.forEach((u) =>
    out.push({ symbol: u.name, kind: "undeclared", file: u.file, pkg: u.pkg }),
  );
  return out;
}

function takeFlag(args, i, out, key) {
  if (args[i] === `--${key}`) {
    out[key] = args[i + 1] ?? "";
    return 2;
  }
  return 0;
}

function parseArgs(args) {
  const out = { block: "" };
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const skip = takeFlag(args, i, out, "block");
    if (skip) i += skip - 1;
    else if (!args[i].startsWith("--")) positional.push(args[i]);
  }
  const tag = positional[0] ?? "";
  const rangeArg = positional[1] ?? "";
  return { tag, rangeArg, blockFile: out.block };
}

function tagExists(tag) {
  try {
    execFileSync("git", ["rev-parse", "-q", "--verify", tag], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function indexPkg(pkg) {
  try {
    execFileSync("scripts/scip.sh", ["index", pkg], { stdio: "ignore" });
  } catch {
    /* refs below will report the missing index; the diff still runs */
  }
}

function printUsage() {
  console.error("usage: node tools/jev/impact.mjs <tag> [range] [--block <file>]");
}

function resolveRun(tag, rangeArg, blockFile) {
  if (!tag) return { error: true };
  const lines = readBlock(tag, blockFile);
  if (!lines) return { empty: true };
  const range = rangeArg || (tagExists(tag) ? `${tag}~1..${tag}` : "HEAD~1..HEAD");
  return { lines, range };
}

function reportClean(tag, lines) {
  lines.forEach((l) => console.log(`  ✓ ${l.symbol}: as planned`));
  console.log(`impact ${tag}: as planned (0 discrepancies). Advisory — never a gate.`);
}

/** One line per discrepancy: `unexpected` (the code touched a file the plan did not name),
 *  `missing` (the plan named a file the code never touched), `undeclared` (a new public
 *  symbol outside the block). The lead reads the diff and decides which side is wrong. */
function reportDiscrepancies(tag, discs) {
  discs.forEach((d) => console.log(`  ⚠ ${d.symbol} ${d.kind} ${d.file}`));
  console.log(
    `impact ${tag}: ${discs.length} discrepancies — plan or source, the lead decides. Advisory — never a gate.`,
  );
}

function collect(lines, range) {
  const pkgs = [...new Set(lines.map((l) => l.pkg))];
  pkgs.forEach(indexPkg);
  const actuals = lines.map((l) => readRefs(l.pkg, l.symbol));
  const undeclared = pkgs.flatMap((p) => findUndeclared(range, p, lines));
  return findDiscrepancies(lines, actuals, undeclared);
}

function main() {
  const { tag, rangeArg, blockFile } = parseArgs(process.argv.slice(2));
  const run = resolveRun(tag, rangeArg, blockFile);
  if (run.error) {
    printUsage();
    process.exit(0);
  }
  if (run.empty) {
    console.log(`no impact block for ${tag}`);
    process.exit(0);
  }
  const discs = collect(run.lines, run.range);
  if (discs.length === 0) {
    reportClean(tag, run.lines);
    process.exit(0);
  }
  reportDiscrepancies(tag, discs);
  process.exit(0);
}

try {
  main();
} catch (e) {
  console.error(`impact: ${e?.message ?? e} — advisory only`);
  process.exit(0);
}
