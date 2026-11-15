import { spawnSync } from "node:child_process";
import { existsSync, globSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";

import { raise } from "./errors";

export declare namespace Tools {
  /** A stage of `tinker check`: `types` runs first, and `rules` only once it is clean. */
  type Stage = "types" | "rules";
  /**
   * One error from the app's own tools. `rule` is a Tinker rule id, a `TS` code, or a lint
   * rule as `<plugin>/<rule>`. `help` is the tool's own hint, when it gives one.
   */
  type Found = { path: string; line: number; rule: string; what: string; help?: string };
  /** What each stage got from the tools, and the tools that ran or were skipped. */
  type Report = { types: Found[]; rules: Found[]; ran: string[]; skipped: string[] };
}

/** One lint diagnostic, as `vp lint --format json` prints it. */
type Diagnostic = {
  code: string;
  message: string;
  help?: string;
  filename: string;
  offset: number;
  length: number;
  line: number;
};

/** A lint rule that is a gate: its Tinker rule id. A gate's error belongs to `types`. */
const gates: Readonly<Record<string, string>> = {
  "typescript(switch-exhaustiveness-check)": "tinker/kind",
  "typescript(consistent-type-assertions)": "tinker/cast",
  "typescript(no-non-null-assertion)": "tinker/cast",
  "typescript(no-explicit-any)": "tinker/cast",
};

/** A lint rule a skill teaches under a Tinker rule id; it stays in `rules`. */
const taught: Readonly<Record<string, string>> = {
  "typescript(no-floating-promises)": "tinker/floating",
};

const tscLine = /^(?:(.+)\((\d+),\d+\): )?error (TS\d+): (.*)$/;

const viteConfig = "vite.config.{ts,mts,js,mjs}";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The app's own copy of a tool: the nearest `node_modules/.bin/<name>` at or above `root`. */
function binOf(root: string, name: string): string | undefined {
  for (let dir = root; ; dir = dirname(dir)) {
    const bin = join(dir, "node_modules", ".bin", name);
    if (existsSync(bin)) return bin;
    if (dirname(dir) === dir) return undefined;
  }
}

/**
 * Run a tool in the app's folder. A script with a `node` line runs on the runtime that runs
 * this command, so `bun --bun tinker check` keeps Node out.
 */
function run(root: string, bin: string, args: readonly string[]) {
  const file = realpathSync(bin);
  const head = readFileSync(file, "utf8").slice(0, 120).split("\n")[0] ?? "";
  const [command, rest] = /^#!.*\bnode\b/.test(head)
    ? [process.execPath, [file, ...args]]
    : [file, [...args]];
  const done = spawnSync(command, rest, { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 });
  return { status: done.status, output: `${done.stdout ?? ""}${done.stderr ?? ""}` };
}

function needed(root: string, name: string, why: string) {
  return binOf(root, name) ?? raise("MissingTool", { tool: name, reason: why });
}

/** `tsc --noEmit`: each error line is one finding; a project error lands on its tsconfig. */
function tsc(root: string): Tools.Found[] {
  const bin = needed(root, "tsc", "the app has a tsconfig.json; add typescript");
  const { status, output } = run(root, bin, ["--noEmit", "--pretty", "false"]);

  const found = output.split("\n").flatMap((text) => {
    const match = tscLine.exec(text.trimEnd());
    if (!match) return [];
    const [, path = "tsconfig.json", line = "1", rule = "", what = ""] = match;
    return [{ path: path.replaceAll("\\", "/"), line: Number(line), rule, what }];
  });
  if (status !== 0 && !found.length) raise("ToolFailed", { tool: "tsc", output });
  return found;
}

/** Where a diagnostic points: its first label's span. */
function spanOf(labels: unknown) {
  const label: unknown = Array.isArray(labels) ? labels[0] : undefined;
  const span = isRecord(label) ? label.span : undefined;
  if (!isRecord(span)) return undefined;

  const { offset, length, line } = span;
  const numbers = typeof offset === "number" && typeof length === "number";
  return numbers && typeof line === "number" ? { offset, length, line } : undefined;
}

function diagnosticOf(value: unknown): Diagnostic | undefined {
  if (!isRecord(value) || value.severity !== "error") return undefined;
  const { code, message, help, filename } = value;
  const span = spanOf(value.labels);
  if (typeof code !== "string" || typeof message !== "string") return undefined;
  if (typeof filename !== "string" || !span) return undefined;

  return { code, message, filename, ...span, ...(typeof help === "string" ? { help } : {}) };
}

/** The lint report's errors; text that is not the report means the lint did not run. */
function lintReport(output: string): Diagnostic[] {
  const start = output.indexOf("{");
  try {
    const report: unknown = JSON.parse(output.slice(start));
    if (start >= 0 && isRecord(report) && Array.isArray(report.diagnostics)) {
      return report.diagnostics.flatMap((value) => diagnosticOf(value) ?? []);
    }
  } catch {
    // Not JSON: the tool failed before it linted.
  }
  return raise("ToolFailed", { tool: "vp lint", output });
}

/** The code a diagnostic points at, on one line and cut short. */
function codeAt(root: string, { filename, offset, length }: Diagnostic) {
  const text = readFileSync(join(root, filename), "utf8").slice(offset, offset + length);
  const flat = text.replaceAll(/\s+/g, " ").trim();
  return flat.length > 48 ? `${flat.slice(0, 47)}…` : flat;
}

/** What a gate finding says: the kinds with no case, or the cast it found. */
function gateWhat(root: string, rule: string, diagnostic: Diagnostic) {
  if (rule === "tinker/cast") return `\`${codeAt(root, diagnostic)}\` hides the type`;
  const kinds = /Cases not matched: (.+)$/.exec(diagnostic.message)?.[1];
  if (kinds) return `kind ${kinds} has no case`;
  return /default case is unnecessary/.test(diagnostic.message)
    ? "a `default` beside a case for every kind"
    : diagnostic.message;
}

/** `vp lint`: a gate's error goes to `types`, every other error to `rules`. */
function lint(root: string) {
  const bin = needed(root, "vp", "the app has a vite.config; add vite-plus");
  const types: Tools.Found[] = [];
  const rules: Tools.Found[] = [];

  for (const diagnostic of lintReport(run(root, bin, ["lint", "--format", "json"]).output)) {
    const { code, message, help, filename: path, line } = diagnostic;
    const gate = gates[code];
    if (gate) {
      types.push({ path, line, rule: gate, what: gateWhat(root, gate, diagnostic) });
      continue;
    }
    const rule = taught[code] ?? code.replace(/^(.+)\((.+)\)$/, "$1/$2");
    rules.push({ path, line, rule, what: message, ...(help ? { help } : {}) });
  }
  return { types, rules };
}

/**
 * A kind with no case fails twice: lint names the kind at the `switch`, and `tsc` gives
 * TS7030 at the head of the function around it. Keep the one that names the kind.
 */
function once(found: readonly Tools.Found[]) {
  const dropped = new Set<Tools.Found>();
  const heads = found.filter(({ rule }) => rule === "TS7030");

  for (const kind of found.filter(({ rule }) => rule === "tinker/kind")) {
    const above = heads.filter(({ path, line }) => path === kind.path && line <= kind.line);
    const nearest = above.reduce<Tools.Found | undefined>(
      (best, head) => (best && best.line > head.line ? best : head),
      undefined,
    );
    if (nearest) dropped.add(nearest);
  }
  const seen = new Set<string>();
  return found.filter((item) => {
    const key = `${item.path}:${item.line}:${item.rule}`;
    if (dropped.has(item) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Run the app's own `tsc` and lint, each where the app has its config: `tsconfig.json` for
 * `tsc`, a `vite.config` for `vp lint`. The command has no config of its own for either.
 *
 * @throws `MissingTool` when the config is there but the tool is not installed.
 * @throws `ToolFailed` when a tool fails and prints no finding.
 */
export function runTools(root: string): Tools.Report {
  const ran: string[] = [];
  const skipped: string[] = [];
  const types: Tools.Found[] = [];
  const rules: Tools.Found[] = [];

  if (existsSync(join(root, "tsconfig.json"))) {
    types.push(...tsc(root));
    ran.push("tsc");
  } else skipped.push("tsc (no tsconfig.json)");

  if (globSync(viteConfig, { cwd: root }).length) {
    const found = lint(root);
    types.push(...found.types);
    rules.push(...found.rules);
    ran.push("lint");
  } else skipped.push("lint (no vite.config)");

  return { types: once(types), rules, ran, skipped };
}
