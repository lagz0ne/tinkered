import type { Check } from "./check";

/** A marker allows the finding on the next line: `// tinker-gap: G3`, alone on its line. */
const markerLine = /^\s*\/\/ tinker-gap: (G\d+)\s*$/;

/** One row of the gaps doc: where its head is, and the two lines the check reads. */
type Row = { line: number; open: boolean; lines: number };

type Marker = { path: string; line: number; gap: string };

/** The rows of the doc: `## G<n>: ...`, then `- Status: open` and `- Lines: <count>`. */
function rowsOf(doc: string) {
  const rows = new Map<string, Row>();
  let row: Row | undefined;

  for (const [index, text] of doc.split("\n").entries()) {
    const head = /^## (G\d+):/.exec(text);
    if (head) rows.set(head[1]!, (row = { line: index + 1, open: false, lines: 0 }));
    else if (text.startsWith("## ")) row = undefined;

    if (!row) continue;
    if (/^- Status: open\s*$/.test(text)) row.open = true;
    const lines = /^- Lines: (\d+)\s*$/.exec(text);
    if (lines) row.lines = Number(lines[1]);
  }
  return rows;
}

function markersOf({ path, text }: Check.Source): Marker[] {
  return text.split("\n").flatMap((line, index) => {
    const match = markerLine.exec(line);
    return match ? [{ path, line: index + 1, gap: match[1]! }] : [];
  });
}

const broken = (path: string, line: number, what: string): Check.Finding => ({
  path,
  line,
  rule: "tinker/gap",
  what,
});

/** Split findings into the ones a marker on an open row allows, and the rest. */
function allow(
  findings: readonly Check.Finding[],
  markers: Map<string, Marker>,
  rows: Map<string, Row>,
) {
  const kept: Check.Finding[] = [];
  const marked = new Map<string, Set<string>>();

  for (const finding of findings) {
    const at = `${finding.path}:${finding.line}`;
    const marker = markers.get(at);
    if (marker && rows.get(marker.gap)?.open) {
      marked.set(marker.gap, (marked.get(marker.gap) ?? new Set()).add(at));
    } else kept.push(finding);
  }
  return { kept, marked };
}

/** What is wrong with one marker: no finding below it, no row, or a closed row. */
function markerProblem(marker: Marker, found: Set<string>, rows: Map<string, Row>, doc: string) {
  const { path, line, gap } = marker;
  const row = rows.get(gap);

  if (!found.has(`${path}:${line + 1}`)) {
    return broken(path, line, `${gap}: a marker with no finding on the next line`);
  }
  if (!row) return broken(path, line, `${gap}: no row in ${doc}`);
  return row.open ? undefined : broken(path, line, `${gap}: the row is closed`);
}

/**
 * Hedl's gap rule (Duke 2026-11-04, S16), for any app that names a gaps doc. A finding is
 * allowed when the line above it is a marker for an open row of the doc. The run breaks on a
 * marker with no finding below it, a marker whose row is missing or closed, and a row with
 * more marked lines than its count, so the count can only go down.
 */
export function applyGaps(
  findings: readonly Check.Finding[],
  sources: readonly Check.Source[],
  doc: Check.Source,
): Pick<Check.Report, "findings" | "gaps"> {
  const rows = rowsOf(doc.text);
  const list = sources.flatMap(markersOf);
  const markers = new Map(list.map((marker) => [`${marker.path}:${marker.line + 1}`, marker]));
  const found = new Set(findings.map(({ path, line }) => `${path}:${line}`));
  const { kept, marked } = allow(findings, markers, rows);

  for (const marker of list) {
    const problem = markerProblem(marker, found, rows, doc.path);
    if (problem) kept.push(problem);
  }

  const gaps = [...rows].map(([gap, { open, lines }]) => {
    return { gap, open, lines, marked: marked.get(gap)?.size ?? 0 };
  });
  for (const { gap, lines, marked: count } of gaps) {
    if (count <= lines) continue;
    const what = `${gap}: ${count} marked lines, the row allows ${lines}`;
    kept.push(broken(doc.path, rows.get(gap)!.line, what));
  }
  return { findings: kept, gaps };
}
