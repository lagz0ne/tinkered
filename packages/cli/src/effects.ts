import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Graph } from "./graph";
import type { Tools } from "./tools";

/** The app's committed write sets, at its root, beside `tinker.graph` (ADR 0175). */
export const effectsFile = "tinker.effects";

/** The line shape `effectsFileText` writes. A change to the shape raises it, as for the graph. */
const effectsFormat = 1;

/** The first line of `tinker.effects`. */
const formatLine = `# ${effectsFile} ${effectsFormat}`;

/** The format a file says on its first line; 0 when it says none. */
function formatOf(text: string) {
  return Number(/^# tinker\.effects (\d+)/.exec(text)?.[1] ?? 0);
}

/**
 * Each cell a graph line names: a `reads{…}` or `writes{…}` fact is the cell's label, then a
 * kind (`issues.list.set`). A `?` names none.
 */
function namedCells(rows: readonly Graph.Row[]) {
  const named = new Set<string>();
  for (const part of rows.flatMap(({ parts }) => parts)) {
    const facts = /^(?:reads|writes)\{(.*)\}$/.exec(part)?.[1] ?? "";
    for (const fact of facts.split(",")) {
      if (fact.includes(".")) named.add(fact.slice(0, fact.lastIndexOf(".")));
    }
  }
  return named;
}

/**
 * The file's lines from what the tests' runs wrote: `label<tab>exit<tab>cells`, with the cells
 * joined by `,`. Only an op `tinker.graph` has a line for, and only a cell a graph line names:
 * a library's cells and a test's own cells have no place (point 6). An exit the op does not
 * declare is its plain return, as the exits stage reads it (#74). Sorted, each line once.
 */
export function effectLines(written: readonly string[], { ops, views, hooks }: Graph.Of) {
  const declared = new Map(ops.map(({ label, exits }) => [label, exits]));
  const named = namedCells([...ops, ...views, ...hooks]);

  const lines = written.flatMap((line) => {
    const [label = "", exit = "", cells = ""] = line.split("\t");
    const exits = declared.get(label);
    if (!exits) return [];

    const kept = cells.split(",").filter((cell) => named.has(cell));
    const way = exits.includes(exit) ? exit : "value";
    return [`${label} ${way} writes{${[...new Set(kept)].sort().join(",")}}`];
  });
  return [...new Set(lines)].sort();
}

/** `tinker.effects` as the file holds it: the format line, then one line per write set. */
export function effectsFileText(lines: readonly string[]) {
  return [formatLine, ...lines, ""].join("\n");
}

/** The write sets of one op and exit, and the line of the file they first show on. */
type Sets = { line: number; sets: string[] };

/** The write sets of each op and exit, by `label exit`, and the line each first shows on. */
function setsBy(lines: readonly { text: string; line: number }[]) {
  const sets = new Map<string, Sets>();
  for (const { text, line } of lines) {
    const [label = "", exit = "", set = ""] = text.split(" ");
    const key = `${label} ${exit}`;
    const at = sets.get(key) ?? { line, sets: [] };
    sets.set(key, { line: at.line, sets: [...at.sets, set] });
  }
  return sets;
}

/** The sets of one op and exit, as a finding says them: `writes{a} or writes{}`. */
const said = (sets: readonly string[]) => [...sets].sort().join(" or ");

/** What a finding says of one op and exit, or nothing when the runs and the file agree. */
function differ(key: string, ran: Sets | undefined, file: Sets | undefined) {
  const seen = said(ran?.sets ?? []);
  const kept = said(file?.sets ?? []);
  if (seen === kept) return undefined;

  return `${key}: ${seen || "no run"}, ${file ? `file says ${kept}` : "file has no line"}`;
}

/**
 * A `tinker/effect` finding for each op and exit whose write sets in `lines`, what the tests'
 * runs wrote, and in `tinker.effects` differ (ADR 0175). It points at the op; an op the graph
 * no longer has points at the file. No file is one finding, when the runs wrote a line.
 */
export function effectFindings(
  root: string,
  lines: readonly string[],
  ops: readonly Graph.Line[],
): Tools.Found[] {
  const path = join(root, effectsFile);
  const rule = "tinker/effect";
  if (!existsSync(path)) {
    const what = `there is no ${effectsFile}: run \`tinker check --write\` and commit it`;
    return lines.length ? [{ path: effectsFile, line: 1, rule, what }] : [];
  }

  const text = readFileSync(path, "utf8");
  const format = formatOf(text);
  if (format !== effectsFormat) {
    const has = `${effectsFile} has format ${format}; this CLI writes format ${effectsFormat}`;
    const what = `${has}: run \`tinker check --write\`, read the diff, and commit it`;
    return [{ path: effectsFile, line: 1, rule, what }];
  }

  const filed = setsBy(
    text
      .split("\n")
      .map((row, index) => ({ text: row.trim(), line: index + 1 }))
      .filter(({ text: row }) => row && !row.startsWith("#")),
  );
  const ran = setsBy(lines.map((line) => ({ text: line, line: 0 })));
  const where = new Map(ops.map(({ label, path: at, line }) => [label, { path: at, line }]));

  const keys = new Set(ran.keys());
  for (const key of filed.keys()) keys.add(key);
  return [...keys].sort().flatMap((key): Tools.Found[] => {
    const file = filed.get(key);
    const what = differ(key, ran.get(key), file);
    if (!what) return [];

    const at = where.get(key.slice(0, key.indexOf(" "))) ?? { path: effectsFile, line: file?.line };
    return [{ path: at.path, line: at.line ?? 1, rule, what }];
  });
}
