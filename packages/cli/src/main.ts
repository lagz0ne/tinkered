import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { IntentCoreError } from "@tanstack/intent/core";

import { readApp } from "./check";
import type { Check } from "./check";
import { isError } from "./errors";
import { applyGaps } from "./gaps";
import { graphFile, graphFileText, graphFindings, graphOf, graphText } from "./graph";
import type { Graph } from "./graph";
import { ruleFindings } from "./graph-rules";
import { readPins } from "./pins";
import type { Pins } from "./pins";
import { rules } from "./rules";
import { fixOf, listSkills, loadSkill, sectionsOf } from "./skills";
import type { Skills } from "./skills";
import { runTests, runTools } from "./tools";
import type { Tools } from "./tools";

export declare namespace Main {
  /** What the command would print and exit with. Nothing is printed here. */
  type Result = { code: number; out: string; err: string };
  /** A finding as it prints: the skill's `Right:` lines, or the tool's own hint. */
  type Finding = Omit<Tools.Found, "help"> & { fix: string[]; skill?: string };
  /**
   * The answer of `tinker check`. `ok` is the only answer that means done: every stage ran
   * and is clean. `failed` names the first stage that failed, its first findings, and how many
   * it has in all. `incomplete` is clean, but a tool did not run for want of its config. `red`
   * is the app's tests failing: `output` is the end of what they said.
   */
  type Report =
    | { kind: "ok"; ran: string[]; gaps: Check.Gap[] }
    | { kind: "incomplete"; ran: string[]; skipped: string[]; gaps: Check.Gap[] }
    | { kind: "red"; output: string; gaps: Check.Gap[] }
    | {
        kind: "failed";
        stage: Tools.Stage;
        total: number;
        findings: Finding[];
        gaps: Check.Gap[];
      };
}

/** A writer fixes a few findings at a time: more than this is noise. */
const shown = 5;

/** The end of a red test run: where a test runner names what failed. */
const lines = 40;

function tail(output: string) {
  return output.trimEnd().split("\n").slice(-lines).join("\n");
}

const usage = `usage:
  tinker check [root] [--json]
  tinker graph [root] [--write]
  tinker pins [root] [--since <ref>] [--json]
  tinker skill list
  tinker skill load <skill>

check runs the app's types (tsc, the kind gate, the cast gate), then its rules (Tinker's
rules and the app's other lint), then its graph (the code's graph must match tinker.graph,
and keep each graph rule in tinker.json), then its tests when tinker.json names their
command: each exit an operation declares must be reached by a test. Only the first stage
that fails prints. Each finding prints its fix.
"tinker check: OK" and exit 0 is the only sign that the work is done.

graph prints the app's graph: one line per operation, with its exits and what its run reads,
writes and calls. The lines are facts; the reader judges them. --write writes them to
tinker.graph, for the app to commit.

pins puts one fault at a time at each fact of the graph a test reaches: an op answers another
exit, or an emptied answer, or loses a write, or a call it makes throws. It runs only the test
files that reach the fact, and prints each mutant they let live. --since <ref> keeps only the
ops whose lines changed since ref. A live mutant is a fact, never a failure: either dead API
or a missing check, and the reader judges. Exit 1 only when it cannot run.
`;

/** One line per gaps row: marked lines over the row's count, as `G3 5/5`. */
function gapLine(gaps: readonly Check.Gap[]) {
  const rows = gaps.map(
    ({ gap, marked, lines, open }) => `${gap} ${marked}/${lines}${open ? "" : " closed"}`,
  );
  return rows.length ? `gaps: ${rows.join(", ")}\n` : "";
}

function fixed({ help, ...found }: Tools.Found, sections: readonly Skills.Section[]): Main.Finding {
  const fix = fixOf(sections, found.rule, found.what);
  if (fix) return { ...found, fix: fix.right, skill: fix.skill };
  if (rules.includes(found.rule)) {
    return { ...found, fix: ["No skill you have teaches this rule: run `tinker skill list`."] };
  }
  return { ...found, fix: help ? [`help: ${help}`] : [] };
}

function failed(
  root: string,
  stage: Tools.Stage,
  found: readonly Tools.Found[],
  gaps: Check.Gap[],
): Main.Report {
  const first = [...found]
    .sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.rule.localeCompare(b.rule))
    .slice(0, shown);
  const sections = first.some(({ rule }) => rule.startsWith("tinker/")) ? sectionsOf(root) : [];

  const findings = first.map((item) => fixed(item, sections));
  return { kind: "failed", stage, total: found.length, findings, gaps };
}

/**
 * Report the stages in order: the rules stage prints only when the types stage is clean. Tinker's
 * own rules read the config, so they run first: a bad config stops the run before the tools.
 * The gap rule allows a marked Tinker finding of either stage, never a `tsc` or other lint
 * error; its own findings are rules. The graph stage runs no app code, so it comes before the
 * tests (ADR 0161); no gap allows a graph finding.
 */
function stages(root: string): Main.Report {
  const { sources, found, doc, tests, graphRules } = readApp(root);
  const tools = runTools(root, sources);
  const all = [...tools.types, ...found, ...tools.rules];
  const isOwn = ({ rule }: Tools.Found) => rule.startsWith("tinker/");
  const own = all.filter(isOwn);
  const { findings: allowed, gaps } = doc
    ? applyGaps(own, sources, doc)
    : { findings: own, gaps: [] };
  const findings = [...allowed, ...all.filter((item) => !isOwn(item))];

  const typed = new Set<Tools.Found>(tools.types);
  const types = findings.filter((item) => typed.has(item));
  if (types.length) return failed(root, "types", types, []);

  const broken = findings.filter((item) => !typed.has(item));
  if (broken.length) return failed(root, "rules", broken, gaps);

  const ran = [...tools.ran, `rules (${sources.length} files)`];
  return afterRules(root, {
    ran,
    skipped: tools.skipped,
    gaps,
    graphRules,
    ...(tests ? { tests } : {}),
  });
}

/** A count and its noun: `1 rule`, `2 rules`, `0 views`. */
const counted = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** The lines of the graph, by kind: `2 operations, 3 views`. */
const linesCount = ({ ops, views, hooks }: Graph.Of) => {
  const hooked = hooks.length ? `, ${counted(hooks.length, "hook")}` : "";
  return `${counted(ops.length, "operation")}, ${counted(views.length, "view")}${hooked}`;
};

/** The graph stage on the `ran:` line: its lines, and its rules when the app has any. */
function graphRan(graph: Graph.Of, graphRules: number) {
  const tested = graphRules ? `, ${counted(graphRules, "rule")}` : "";
  return `graph (${linesCount(graph)}${tested})`;
}

/**
 * The stages after clean rules: the graph, then the tests and their exits. The graph stage
 * compares the code's graph with `tinker.graph`, and tests it against the app's graph rules
 * (ADR 0167). `ran` names the graph only when the app has an operation: an app with none needs
 * no `tinker.graph`.
 */
function afterRules(
  root: string,
  {
    ran,
    skipped,
    gaps,
    graphRules,
    tests,
  }: {
    ran: string[];
    skipped: string[];
    gaps: Check.Gap[];
    graphRules: readonly Check.GraphRule[];
    tests?: string;
  },
): Main.Report {
  const graph = graphOf(root);
  const { ops, views, hooks } = graph;
  const rows = [...ops, ...views, ...hooks];
  const changed = [...graphFindings(root, rows), ...ruleFindings(ops, graphRules)];
  if (changed.length) return failed(root, "graph", changed, gaps);

  if (rows.length) ran.push(graphRan(graph, graphRules.length));
  if (skipped.length) return { kind: "incomplete", ran, skipped, gaps };
  if (!tests) return { kind: "ok", ran, gaps };

  const declared = ops.flatMap(({ path, line, label, exits }) =>
    exits.map((exit) => ({ path, line, label, exit })),
  );
  const tested = runTests(root, tests, declared);
  if (tested.status !== 0) return { kind: "red", output: tail(tested.output), gaps };
  if (tested.unreached.length) return failed(root, "exits", tested.unreached, gaps);
  return { kind: "ok", ran: [...ran, "tests", "exits"], gaps };
}

/** A finding's lines: the finding, then its fix once per rule, then the skill to load. */
function block({ path, line, rule, what, fix, skill }: Main.Finding, first: boolean) {
  const head = `${path}:${line} ${rule} ${what}`;
  if (!first) return fix.length ? [head, "  fix: as above"] : [head];

  const more = skill ? [`more: tinker skill load ${skill}`] : [];
  return [head, ...[...fix, ...more].map((text) => `  ${text}`)];
}

/** Two findings print one fix once: the second points at the first. */
const sameFix = (a: readonly string[], b: readonly string[]) => a.join("\n") === b.join("\n");

function failedText({ stage, total, findings, gaps }: Main.Report & { kind: "failed" }) {
  const blocks = findings.map((finding, index) =>
    block(finding, findings.findIndex(({ fix }) => sameFix(fix, finding.fix)) === index),
  );
  const count = total > findings.length ? `${total} findings, ${findings.length} shown` : "";

  const after = stage === "types" ? " The rules stage runs once types pass." : "";
  const next = stage === "exits" ? "add a test for each finding" : "fix each finding";
  return [
    gapLine(gaps) + blocks.map((lines) => lines.join("\n")).join("\n\n"),
    "",
    `tinker check: ${stage} failed${count ? `, ${count}` : ""}.`,
    `Next: ${next}, then run \`tinker check\` again.${after}`,
    "",
  ].join("\n");
}

function text(report: Main.Report) {
  const gaps = gapLine(report.gaps);
  switch (report.kind) {
    case "ok":
      return `${gaps}ran: ${report.ran.join(", ")}\ntinker check: OK\n`;
    case "incomplete":
      return [
        `${gaps}ran: ${report.ran.join(", ")}`,
        `skipped: ${report.skipped.join(", ")}`,
        "tinker check: not done. A check did not run, so this is no OK.",
        "Next: add the config the skipped line names, then run `tinker check` again.",
        "",
      ].join("\n");
    case "red":
      return [
        report.output,
        "",
        "tinker check: tests failed.",
        "Next: make the tests pass, then run `tinker check` again.",
        "",
      ].join("\n");
    case "failed":
      return failedText(report);
  }
}

/** Exit 0 only for `ok`; a stage that did not run is a config the command cannot use. */
const codes: Readonly<Record<Main.Report["kind"], number>> = {
  ok: 0,
  failed: 1,
  red: 1,
  incomplete: 2,
};

function checkCommand(root: string, json: boolean): Main.Result {
  if (!existsSync(root)) return { code: 2, out: "", err: `tinker check: no folder at ${root}\n` };
  try {
    const report = stages(root);
    const out = json ? `${JSON.stringify(report)}\n` : text(report);
    return { code: codes[report.kind], out, err: "" };
  } catch (error) {
    if (isError(error, "BadConfig")) {
      const { path, reason } = error.payload;
      return { code: 2, out: "", err: `${path}: ${reason}\n` };
    }
    if (isError(error, "MissingTool")) {
      const { tool, reason } = error.payload;
      return { code: 2, out: "", err: `tinker check: no ${tool}: ${reason}\n` };
    }
    if (!isError(error, "ToolFailed")) throw error;
    const { tool, output } = error.payload;
    return { code: 2, out: "", err: `tinker check: ${tool} failed and named no file:\n${output}` };
  }
}

/** Print the app's graph, or write it to `tinker.graph` with `--write`. */
function graphCommand(root: string, write: boolean): Main.Result {
  if (!existsSync(root)) return { code: 2, out: "", err: `tinker graph: no folder at ${root}\n` };
  const graph = graphOf(root);
  const rows = [...graph.ops, ...graph.views, ...graph.hooks];
  if (!write) return { code: 0, out: graphText(rows), err: "" };

  writeFileSync(join(root, graphFile), graphFileText(rows));
  return { code: 0, out: `wrote ${graphFile}: ${linesCount(graph)}\n`, err: "" };
}

/** The text of a pins report: one entry per live mutant, then the counts. */
function pinsText(report: Pins.Report) {
  switch (report.kind) {
    case "untested":
      return "tinker pins: tinker.json has no `tests` command, so no test can pin a fact.\n";
    case "red":
      return [
        tail(report.output),
        "",
        `tinker pins: ${report.file} fails with no mutant in.`,
        "Next: make it pass, then run `tinker pins` again.",
        "",
      ].join("\n");
    case "ran": {
      const entries = report.live.flatMap(({ path, line, fault, fact, reachedBy }) => [
        `${path}:${line} ${fault.op} ${fault.kind} ${fact} lives`,
        `  reached by: ${reachedBy.join(", ")}`,
      ]);
      const { mutants, live, files, untraced } = report;
      const tested = `${counted(files, "test file")}, ${untraced.length} not traced`;
      const count = `${counted(mutants, "mutant")}, ${live.length} live, ${tested}`;
      return [...entries, `pins: ${count}`, ""].join("\n");
    }
  }
}

/** `tinker pins`'s words: a root, `--since <ref>` and `--json`; any other is no call. */
function pinsCall(args: readonly string[]) {
  const options = { since: { type: "string" }, json: { type: "boolean" } } as const;
  try {
    const { values, positionals } = parseArgs({ args: [...args], options, allowPositionals: true });
    const [root = ".", ...rest] = positionals;
    return rest.length ? undefined : { root, since: values.since, json: values.json === true };
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      String(error.code).startsWith("ERR_PARSE_ARGS")
    ) {
      return undefined;
    }
    throw error;
  }
}

/** Put the graph's mutants in, and print the live ones. Exit 0 when it ran, whatever lived. */
function pinsCommand(cwd: string, args: readonly string[]): Main.Result {
  const call = pinsCall(args);
  if (!call) return { code: 2, out: "", err: usage };
  const root = resolve(cwd, call.root);
  if (!existsSync(root)) return { code: 2, out: "", err: `tinker pins: no folder at ${root}\n` };

  try {
    const report = readPins(root, call.since);
    const out = call.json ? `${JSON.stringify(report)}\n` : pinsText(report);
    return { code: report.kind === "ran" ? 0 : 1, out, err: "" };
  } catch (error) {
    if (isError(error, "BadConfig")) {
      const { path, reason } = error.payload;
      return { code: 2, out: "", err: `${path}: ${reason}\n` };
    }
    if (!isError(error, "ToolFailed")) throw error;
    const { tool, output } = error.payload;
    return { code: 2, out: "", err: `tinker pins: ${tool} failed:\n${output}` };
  }
}

function skillCommand(root: string, args: readonly string[]): Main.Result {
  const [action, use, ...rest] = args;
  try {
    if (action === "list" && use === undefined) return { code: 0, out: listSkills(root), err: "" };
    if (action === "load" && use && !rest.length) {
      return { code: 0, out: loadSkill(root, use), err: "" };
    }
  } catch (error) {
    if (!(error instanceof IntentCoreError)) throw error;
    return { code: 2, out: "", err: `${error.message}\n` };
  }
  return { code: 2, out: "", err: usage };
}

/** The one flag each command takes: `--json` prints data, `--write` writes the file. */
function flagOf(command: string) {
  if (command === "check") return "--json";
  return command === "graph" ? "--write" : undefined;
}

/**
 * The command, without the process: `argv` is what follows the program name, and `cwd` is
 * the folder a relative root starts from. Exit 0 is done, 1 is a finding, 2 is a call, a
 * config or a tool the command cannot use.
 */
export function main(argv: readonly string[], cwd: string): Main.Result {
  const [command, ...args] = argv;
  return command === "pins" ? pinsCommand(cwd, args) : oneFlag(argv, cwd);
}

/** The commands that take at most their one flag, and no value after it. */
function oneFlag(argv: readonly string[], cwd: string): Main.Result {
  const [command = "", ...args] = argv.filter((arg) => !arg.startsWith("-"));
  const flag = flagOf(command);
  const on = argv.some((arg) => arg === flag);
  if (argv.some((arg) => arg.startsWith("-") && arg !== flag)) {
    return { code: 2, out: "", err: usage };
  }

  if (command === "skill") return skillCommand(cwd, args);
  const [root = ".", ...rest] = args;
  if (!flag || rest.length) return { code: 2, out: "", err: usage };
  const at = resolve(cwd, root);
  return command === "graph" ? graphCommand(at, on) : checkCommand(at, on);
}
