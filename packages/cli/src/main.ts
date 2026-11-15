import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { IntentCoreError } from "@tanstack/intent/core";

import { readApp } from "./check";
import type { Check } from "./check";
import { isError } from "./errors";
import { applyGaps } from "./gaps";
import { rules } from "./rules";
import { fixOf, listSkills, loadSkill, sectionsOf } from "./skills";
import type { Skills } from "./skills";
import { runTools } from "./tools";
import type { Tools } from "./tools";

export declare namespace Main {
  /** What the command would print and exit with. Nothing is printed here. */
  type Result = { code: number; out: string; err: string };
  /** A finding as it prints: the skill's `Right:` lines, or the tool's own hint. */
  type Finding = Omit<Tools.Found, "help"> & { fix: string[]; skill?: string };
  /**
   * The answer of `tinker check`. `ok` is the only answer that means done: every stage ran
   * and is clean. `failed` names the first stage that failed, its first findings, and how many
   * it has in all. `incomplete` is clean, but a tool did not run for want of its config.
   */
  type Report =
    | { kind: "ok"; ran: string[]; gaps: Check.Gap[] }
    | { kind: "incomplete"; ran: string[]; skipped: string[]; gaps: Check.Gap[] }
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

const usage = `usage:
  tinker check [root] [--json]
  tinker skill list
  tinker skill load <skill>

check runs the app's types (tsc, the kind gate, the cast gate), then its rules (Tinker's
rules and the app's other lint). Only the first stage that fails prints. Each finding
prints its fix. "tinker check: OK" and exit 0 is the only sign that the work is done.
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
 * error; its own findings are rules.
 */
function stages(root: string): Main.Report {
  const { sources, found, doc } = readApp(root);
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
  if (tools.skipped.length) return { kind: "incomplete", ran, skipped: tools.skipped, gaps };
  return { kind: "ok", ran, gaps };
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
    case "failed": {
      const { stage, total, findings } = report;
      const blocks = findings.map((finding, index) =>
        block(finding, findings.findIndex(({ fix }) => sameFix(fix, finding.fix)) === index),
      );
      const count = total > findings.length ? `${total} findings, ${findings.length} shown` : "";
      const after = stage === "types" ? " The rules stage runs once types pass." : "";
      return [
        gaps + blocks.map((lines) => lines.join("\n")).join("\n\n"),
        "",
        `tinker check: ${stage} failed${count ? `, ${count}` : ""}.`,
        `Next: fix each finding, then run \`tinker check\` again.${after}`,
        "",
      ].join("\n");
    }
  }
}

/** Exit 0 only for `ok`; a stage that did not run is a config the command cannot use. */
const codes: Readonly<Record<Main.Report["kind"], number>> = { ok: 0, failed: 1, incomplete: 2 };

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

/**
 * The command, without the process: `argv` is what follows the program name, and `cwd` is
 * the folder a relative root starts from. Exit 0 is done, 1 is a finding, 2 is a call, a
 * config or a tool the command cannot use.
 */
export function main(argv: readonly string[], cwd: string): Main.Result {
  const json = argv.includes("--json");
  const [command, ...args] = argv.filter((arg) => arg !== "--json");
  if (args.some((arg) => arg.startsWith("-"))) return { code: 2, out: "", err: usage };

  if (command === "skill" && !json) return skillCommand(cwd, args);
  const [root = ".", ...rest] = args;
  if (command !== "check" || rest.length) return { code: 2, out: "", err: usage };
  return checkCommand(resolve(cwd, root), json);
}
