// The Jev gate over files on disk: the judging path review.mjs check
// runs over a saved snapshot, and app-gate.mjs runs over a repo folder.
// It reads each file and never runs it; the rule is gate.mjs.
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { isJudgedPath, judgeSource } from "./broker.mjs";
import { gateFiles } from "./gate.mjs";
import { reusedAnswer } from "./answers.mjs";

/** One file's report, or an error report (unavailable). A link or a path that leaves
 *  `root` is never followed. `answers` holds the writer's reports to reuse for
 *  unchanged bytes (an empty Map reuses none). */
export async function judgeFile(root, file, { jevDir, judges, ask, answers, suite }) {
  const path = join(root, file);
  try {
    if (!lstatSync(path).isFile() || !realpathSync(path).startsWith(`${realpathSync(root)}/`))
      return { file, error: "not a regular file inside the judged folder" };
    const source = readFileSync(path, "utf8");
    if (source.length > 40000) return { file, error: "file exceeds 40000 characters" };
    // Same bytes the writer already asked about: keep the writer's answer.
    return (
      reusedAnswer(answers, file, source) ??
      (await judgeSource({ source, file, jevDir, judges, ask, suite }))
    );
  } catch (error) {
    return { file, error: error.message };
  }
}

const byText = (a, b) => a.localeCompare(b);

const below = (root, top) => {
  try {
    return readdirSync(join(root, top), { recursive: true, encoding: "utf8" }).map(
      (rel) => `${top}/${rel}`,
    );
  } catch {
    return [];
  }
};

/** The judged paths below `root`: `.ts` and `.tsx` files in `src/` and `tests/`, sorted. */
export const judgedFiles = (root) =>
  ["src", "tests"]
    .flatMap((top) => below(root, top))
    .filter(isJudgedPath)
    .sort(byText);

/** Judge every judged file below `root`, then gate them together. No file is unavailable. */
export async function gateFolder(root, { jevDir, judges, ask }) {
  const files = judgedFiles(root);
  const reports = [];
  for (const file of files)
    reports.push(await judgeFile(root, file, { jevDir, judges, ask, answers: new Map() }));
  return { files, reports, gate: gateFiles(reports) };
}

/** 0 when nothing blocks, 1 when something blocks, 2 when the gate is unavailable. */
export const exitCodeOf = (gate) => ({ pass: 0, block: 1 })[gate.status] ?? 2;

const blockLine = (item) =>
  `  block ${item.rule ?? item.judge} line ${item.line ?? "-"}` +
  `${item.unit ? ` (${item.unit})` : ""}: ${item.fix ?? "no fix line"}`;

const adviceLine = (item) =>
  `  advice ${item.judge} line ${item.line ?? "-"} (${item.unit}), ` +
  `${Math.round(item.probability * 100)}% ${item.calibration}`;

/** The readable gate: per file its blocking items, then its advice, then every
 *  unavailable check, then the counts and the verdict. */
export function summaryOf(gate) {
  const files = [...new Set([...gate.blocking, ...gate.advice].map((item) => item.file))].sort(
    byText,
  );
  const lines = files.flatMap((file) => [
    file,
    ...gate.blocking.filter((item) => item.file === file).map(blockLine),
    ...gate.advice.filter((item) => item.file === file).map(adviceLine),
  ]);
  const unavailable = gate.reasons.map((reason) => `unavailable ${reason}`);
  const counts =
    `blocking ${gate.blocking.length}, advice ${gate.advice.length}, ` +
    `unavailable ${gate.reasons.length}`;
  return [...lines, ...unavailable, counts, `gate: ${gate.status}`].join("\n") + "\n";
}
