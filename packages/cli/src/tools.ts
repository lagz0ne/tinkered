import { spawnSync } from "node:child_process";
import { existsSync, globSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import ts from "typescript-api";

import type { Check } from "./check";
import { raise } from "./errors";
import { gates, taught } from "./rules";

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

/** Where a lint diagnostic points. */
type Span = { offset: number; length: number; line: number };

/** One lint error, as `vp lint --format json` prints it. A file-wide one has no span. */
type Diagnostic = { code: string; message: string; help?: string; filename: string; span?: Span };

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
 * Run a tool in the app's folder. `stdout` is the tool's answer; `output` is all it said, and
 * why it could not start, for a failure.
 */
function run(root: string, bin: string, args: readonly string[]) {
  const done = spawnSync(bin, args, { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 });
  const error = done.error ? `${done.error.message}\n` : "";
  const stdout = done.stdout ?? "";
  return { status: done.status, stdout, output: `${error}${stdout}${done.stderr ?? ""}` };
}

function needed(root: string, name: string, why: string) {
  return binOf(root, name) ?? raise("MissingTool", { tool: name, reason: why });
}

/**
 * `tsc --noEmit`: each error line is one finding; a project error lands on its tsconfig.
 *
 * @throws `BadConfig` for a solution tsconfig: with `references`, `tsc --noEmit` checks no file.
 */
function tsc(root: string): Tools.Found[] {
  const bin = needed(root, "tsc", "the app has a tsconfig.json; add typescript");
  if (/"references"\s*:/.test(readFileSync(join(root, "tsconfig.json"), "utf8"))) {
    const reason =
      "it lists `references`, so `tsc --noEmit` checks no file; run the check per project";
    raise("BadConfig", { path: "tsconfig.json", reason });
  }
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
function spanOf(labels: unknown): Span | undefined {
  const label: unknown = Array.isArray(labels) ? labels[0] : undefined;
  const span = isRecord(label) ? label.span : undefined;
  if (!isRecord(span)) return undefined;

  const { offset, length, line } = span;
  const numbers = typeof offset === "number" && typeof length === "number";
  return numbers && typeof line === "number" ? { offset, length, line } : undefined;
}

/** An error diagnostic; a field it lacks reads as unknown, so no error is lost. */
function diagnosticOf(value: unknown): Diagnostic[] {
  if (!isRecord(value) || value.severity !== "error") return [];
  const { code, message, help, filename } = value;
  const span = spanOf(value.labels);

  return [
    {
      code: typeof code === "string" ? code : "lint(unknown)",
      message: typeof message === "string" ? message : "a lint error",
      filename: typeof filename === "string" ? filename : ".",
      ...(span ? { span } : {}),
      ...(typeof help === "string" ? { help } : {}),
    },
  ];
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * The lint report's errors. Text that is not the report, or a failed lint with no error in
 * it, means the lint did not run.
 */
function lintReport({ status, stdout, output }: ReturnType<typeof run>) {
  const report = parsed(stdout.slice(Math.max(0, stdout.search(/\{\s*"diagnostics"/))));
  const errors =
    isRecord(report) && Array.isArray(report.diagnostics)
      ? report.diagnostics.flatMap(diagnosticOf)
      : undefined;
  if (!errors || (status !== 0 && !errors.length)) raise("ToolFailed", { tool: "vp lint", output });
  return errors ?? [];
}

/** The code a diagnostic points at, on one line and cut short. */
function codeAt(root: string, filename: string, { offset, length }: Span) {
  const text = readFileSync(join(root, filename), "utf8").slice(offset, offset + length);
  const flat = text.replaceAll(/\s+/g, " ").trim();
  return flat.length > 48 ? `${flat.slice(0, 47)}…` : flat;
}

/** What a gate finding says: the kinds with no case, or the cast it found. */
function gateWhat(root: string, rule: string, diagnostic: Diagnostic) {
  const { filename, span } = diagnostic;
  if (rule === "tinker/cast" && span) return `\`${codeAt(root, filename, span)}\` hides the type`;
  const kinds = /Cases not matched: (.+)$/.exec(diagnostic.message)?.[1];
  if (kinds) return `kind ${kinds} has no case`;
  return /default case is unnecessary/.test(diagnostic.message)
    ? "a `default` beside a case for every kind"
    : diagnostic.message;
}

const isOn = (level: unknown): boolean =>
  level === "deny" || level === "error" || (Array.isArray(level) && isOn(level[0]));

/**
 * The gates the app's lint config does not run: a gate rule that is at error nowhere, in its
 * rules or in an override, and `typeAware`, which the kind gate needs.
 */
function offGates(root: string, bin: string) {
  const { stdout, output } = run(root, bin, ["lint", "--print-config"]);
  const config = parsed(stdout.slice(Math.max(0, stdout.search(/^\{\s*$/m))));
  if (!isRecord(config)) return raise("ToolFailed", { tool: "vp lint --print-config", output });

  const overrides = Array.isArray(config.overrides) ? config.overrides : [];
  const sets: unknown[] = [config.rules, ...overrides.map((item) => isRecord(item) && item.rules)];
  const off = Object.keys(gates)
    .map((code) => code.replace(/^(.+)\((.+)\)$/, "$1/$2"))
    .filter((name) => !sets.some((set) => isRecord(set) && isOn(set[name])));
  const aware = isRecord(config.options) && config.options.typeAware === true;
  return aware ? off : ["options.typeAware", ...off];
}

/** `vp lint`: a gate's error goes to `types`, every other error to `rules`. */
function lint(root: string) {
  const bin = needed(root, "vp", "the app has a vite.config; add vite-plus");
  const off = offGates(root, bin);
  const types: Tools.Found[] = [];
  const rules: Tools.Found[] = [];

  for (const diagnostic of lintReport(run(root, bin, ["lint", "--format", "json"]))) {
    const { code, message, help, filename: path, span } = diagnostic;
    const line = span?.line ?? 1;

    const gate = gates[code];
    if (gate) {
      types.push({ path, line, rule: gate, what: gateWhat(root, gate, diagnostic) });
      continue;
    }
    const rule = taught[code] ?? code.replace(/^(.+)\((.+)\)$/, "$1/$2");
    rules.push({ path, line, rule, what: message, ...(help ? { help } : {}) });
  }
  return { types, rules, off };
}

/** A lint comment that turns rules off, and the rules it names (none names every rule). */
const disable = /(?:\/\/|\/\*)\s*(?:es|ox)lint-disable(?:-next-line|-line)?(?![\w-])([^\n]*)/;

/** A gate's rule name with no plugin: oxlint takes `typescript/x`, `@typescript-eslint/x`, `x`. */
const gateNames = Object.keys(gates).map((code) => code.replace(/^.+\((.+)\)$/, "$1"));

/**
 * A comment in the app's code that turns a gate off. The lint then reports nothing there, so
 * the check reports the comment: an exception to a gate is a gap row (ADR 0156).
 */
function turnedOff({ path, text }: Check.Source): Tools.Found[] {
  return text.split("\n").flatMap((line, index) => {
    const match = disable.exec(line);
    if (!match) return [];
    const [list = ""] = (match[1] ?? "").replace(/\*\/.*$/, "").split("--");
    const named = list.split(",").flatMap((name) => name.trim().split("/").slice(-1));
    const rules = named.filter((name) => name !== "");
    const off = rules.length ? gateNames.filter((gate) => rules.includes(gate)) : gateNames;

    const what = (gate: string) => `a \`lint-disable\` comment turns off the gate ${gate}`;
    return off.map((gate) => ({ path, line: index + 1, rule: "tinker/gap", what: what(gate) }));
  });
}

/** The `switch` that starts on 1-based `line`, as the parser reads it. */
function switchAt(source: ts.SourceFile, line: number): ts.SwitchStatement | undefined {
  const lineOf = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart()).line;
  const visit = (node: ts.Node): ts.SwitchStatement | undefined =>
    ts.isSwitchStatement(node) && lineOf(node) === line - 1 ? node : ts.forEachChild(node, visit);
  return visit(source);
}

/** A function's body, when the node is a function that has one. */
function bodyOf(node: ts.Node): ts.Node | undefined {
  const isFunction =
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node);
  return isFunction ? node.body : undefined;
}

/**
 * The lines from the start of the function around the `switch` on `line` to the start of its
 * body. `tsc` puts TS7030 there: on the name, or on the arrow.
 */
function headOf(root: string, { path, line }: Tools.Found) {
  const text = readFileSync(join(root, path), "utf8");
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  let node: ts.Node | undefined = switchAt(source, line);
  while (node && !bodyOf(node)) node = node.parent;
  const body = node && bodyOf(node);
  if (!node || !body) return undefined;

  const lineOf = (at: number) => source.getLineAndCharacterOfPosition(at).line + 1;
  return { path, from: lineOf(node.getStart()), to: lineOf(body.getStart()) };
}

/**
 * A kind with no case fails twice: lint names the kind at the `switch`, and `tsc` gives
 * TS7030 (or TS2366, with a return type) at the head of the function around it. Keep the one
 * that names the kind.
 */
function once(root: string, found: readonly Tools.Found[]) {
  const heads = found
    .filter(({ rule }) => rule === "tinker/kind")
    .flatMap((kind) => {
      const head = headOf(root, kind);
      return head ? [head] : [];
    });
  const isHead = ({ path, line, rule }: Tools.Found) =>
    (rule === "TS7030" || rule === "TS2366") &&
    heads.some((head) => head.path === path && head.from <= line && line <= head.to);

  const seen = new Set<string>();
  return found.filter((item) => {
    const key = `${item.path}:${item.line}:${item.rule}:${item.what}`;
    if (isHead(item) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Run the app's own `tsc` and lint, each where the app has its config: `tsconfig.json` for
 * `tsc`, a `vite.config` for `vp lint`. The command has no config of its own for either.
 *
 * `sources` are the app files the rules read: a comment there that turns a gate off is a
 * `types` finding.
 *
 * @throws `MissingTool` when the config is there but the tool is not installed.
 * @throws `ToolFailed` when a tool fails and prints no finding.
 */
export function runTools(root: string, sources: readonly Check.Source[]): Tools.Report {
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
    types.push(...found.types, ...sources.flatMap(turnedOff));
    rules.push(...found.rules);
    ran.push("lint");
    if (found.off.length) {
      skipped.push(`gates not at error in the lint config (${found.off.join(", ")})`);
    }
  } else skipped.push("lint (no vite.config)");

  return { types: once(root, types), rules, ran, skipped };
}
