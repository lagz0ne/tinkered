import { spawnSync } from "node:child_process";
import { existsSync, globSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { configOf } from "./check";
import { raise } from "./errors";
import { graphOf, slotMark, unseen } from "./graph";
import type { Graph } from "./graph";
import { emptyOf, none } from "./mutant";
import type { Mutant } from "./mutant";

export declare namespace Pins {
  /**
   * A mutant no test killed: where its op is, its fault, the fact it is at as one word, and the
   * test files that ran it: those whose trace holds the fact.
   */
  type Live = {
    path: string;
    line: number;
    fault: Mutant.Fault;
    fact: string;
    reachedBy: string[];
  };
  /**
   * The answer of `tinker pins` (ADR 0173). `ran` is the only answer that ran: it put in
   * `mutants` faults, `live` lived, over `files` test files. `untraced` are the files whose
   * trace run wrote no line: their scopes list no `exits`, so no fault reaches them, and a live
   * mutant may still be checked by one of them. A live mutant is a fact, never a failure. `untested`: `tinker.json` names no `tests` command. `red`: `file` failed with no
   * mutant in, and `output` is what it said.
   */
  type Report =
    | { kind: "ran"; mutants: number; files: number; untraced: string[]; live: Live[] }
    | { kind: "untested" }
    | { kind: "red"; file: string; output: string };
}

/** A test file, by its ending: `.test.` and `ts`, `tsx`, `mts` or `mjs`, outside `node_modules`. */
const testFile = /\.test\.(?:tsx?|mts|mjs)$/;

const isModules = (path: string) => /(?:^|[\\/])node_modules$/.test(path);

/** How long one test run may take. A run that takes longer kills its mutant. */
const timeout = 120_000;

/**
 * What one test file reached, from its trace: each fact as the capsule writes it
 * (`exit<tab>op<tab>exit`, `write<tab>op<tab>cell`, `call<tab>op<tab>callee`), and one sample
 * answer's JSON by `op<tab>exit`.
 */
type Trace = { facts: Set<string>; samples: Map<string, string> };

/** A mutant before it runs: its fault, its fact as one word, and its fact as the trace has it. */
type Planned = { op: Graph.Line; fault: Mutant.Fault; fact: string; traced: string };

/** A path as one shell word: quoted only when it has more than plain path signs. */
const word = (path: string) =>
  /^[\w./-]+$/.test(path) ? path : `'${path.replaceAll("'", "'\\''")}'`;

/**
 * The env of a test run or a git command: this process's, with no value of `tinker check` or
 * `tinker pins` and no `GIT_` value. A git hook sets `GIT_DIR`, which points git at the hook's
 * repo, not the app's.
 */
function envWith(values: Record<string, string>) {
  const own = ["TINKER_EXITS", "TINKER_TRACE", "TINKER_MUTANT"];
  const env = Object.entries(process.env).filter(
    ([name]) => !own.includes(name) && !name.startsWith("GIT_"),
  );
  return { ...Object.fromEntries(env), ...values };
}

/**
 * Run `files` by the app's own test command, in its folder: the shell line, then each path, as
 * `tinker check` runs it. A run that ends past `timeout` did not pass.
 */
function runFiles(root: string, command: string, files: string[], env: NodeJS.ProcessEnv) {
  const line = [command, ...files.map(word)].join(" ");
  const done = spawnSync(line, {
    cwd: root,
    env,
    shell: true,
    encoding: "utf8",
    maxBuffer: 1 << 28,
    timeout,
  });
  const output = `${done.error ? `${done.error.message}\n` : ""}${done.stdout ?? ""}${done.stderr ?? ""}`;
  return { passed: done.status === 0, output };
}

/** The facts and samples of a trace file's lines. A sample's JSON has no tab of its own. */
function traceIn(lines: readonly string[]): Trace {
  const trace: Trace = { facts: new Set(), samples: new Map() };
  for (const line of lines) {
    const [first = "", op, exit, json] = line.split("\t");
    if (first === "sample") trace.samples.set(`${op}\t${exit}`, json ?? "null");
    else if (line) trace.facts.add(line);
  }
  return trace;
}

/** One run of a test file alone, with `TINKER_TRACE`: what it reached, and whether it passed. */
function traceOf(root: string, command: string, file: string) {
  const folder = mkdtempSync(join(tmpdir(), "tinker-pins-"));
  const path = join(folder, "trace.tsv");
  const run = runFiles(root, command, [file], envWith({ TINKER_TRACE: path }));
  const lines = existsSync(path) ? readFileSync(path, "utf8").split("\n") : [];

  rmSync(folder, { recursive: true, force: true });
  return { ...run, trace: traceIn(lines) };
}

/** Every file's trace in one: the facts any file reached, and the first sample of each exit. */
function unionOf(traces: readonly Trace[]): Trace {
  const all: Trace = { facts: new Set(), samples: new Map() };
  for (const { facts, samples } of traces) {
    for (const fact of facts) all.facts.add(fact);
    for (const [key, json] of samples) if (!all.samples.has(key)) all.samples.set(key, json);
  }
  return all;
}

/**
 * The swaps of an op: where it answered one declared exit, it answers another, by that exit's
 * sample. Never from or to `refused`: a refusal is a hook's fact, and Core's own mark.
 */
function swapsOf(op: Graph.Line, { facts, samples }: Trace): Planned[] {
  const { label, exits } = op;
  return exits.flatMap((from) => {
    const traced = `exit\t${label}\t${from}`;
    if (from === "refused" || !facts.has(traced)) return [];
    return exits.flatMap((to) => {
      const sample = samples.get(`${label}\t${to}`);
      if (to === from || to === "refused" || sample === undefined) return [];
      const fault: Mutant.Fault = { kind: "swap", op: label, from, to, value: JSON.parse(sample) };
      return [{ op, fault, fact: `${from}->${to}`, traced }];
    });
  });
}

/** The empties of an op: each declared exit whose sample has an empty twin. */
function emptiesOf(op: Graph.Line, { facts, samples }: Trace): Planned[] {
  const { label, exits } = op;
  return exits.flatMap((from) => {
    const traced = `exit\t${label}\t${from}`;
    const sample = samples.get(`${label}\t${from}`);
    if (from === "refused" || !facts.has(traced) || sample === undefined) return [];
    if (emptyOf(JSON.parse(sample)) === none) return [];
    return [{ op, fault: { kind: "empty", op: label, from }, fact: from, traced }];
  });
}

/** The drops of an op: each cell its `writes{}` names (`dispatch.line.set` is `dispatch.line`). */
function dropsOf(op: Graph.Line, { facts }: Trace): Planned[] {
  const { label, writes } = op;
  const cells = new Set(
    writes.filter((fact) => fact !== unseen).map((fact) => fact.slice(0, fact.lastIndexOf("."))),
  );
  return [...cells].flatMap((cell) => {
    const traced = `write\t${label}\t${cell}`;
    if (!facts.has(traced)) return [];
    return [{ op, fault: { kind: "drop", op: label, cell }, fact: cell, traced }];
  });
}

/**
 * The ops a capsule hook runs, by the `runs{…}` of its hook lines (#72). A hook that runs one
 * inside an op shows in the trace as that op's call.
 */
function hookRunsOf(hooks: readonly Graph.Row[]) {
  const head = "runs{";
  const runs = hooks
    .flatMap(({ parts }) => parts.filter((part) => part.startsWith(head)))
    .flatMap((part) => part.slice(head.length, -1).split(","));
  return new Set(runs.filter((label) => label && label !== unseen));
}

/**
 * The fails of an op: each call its `calls{}` names. A `slot:` call names no op, so each op
 * the trace shows it call that `calls{}` does not name is the slot's, unless a hook line runs
 * it: that call is the hook's, and a hook's fact gets no mutant (ADR 0173 decision 5).
 */
function failsOf(op: Graph.Line, { facts }: Trace, hookRuns: ReadonlySet<string>): Planned[] {
  const { label, calls } = op;
  const head = `call\t${label}\t`;
  const slot = calls.some((call) => call.startsWith(slotMark));
  const callees = [...facts]
    .filter((fact) => fact.startsWith(head))
    .map((fact) => fact.slice(head.length))
    .filter((callee) => calls.includes(callee) || (slot && !hookRuns.has(callee)));
  return callees.map((callee) => ({
    op,
    fault: { kind: "fail", op: label, callee },
    fact: callee,
    traced: `${head}${callee}`,
  }));
}

/** Lines `from` to `to` of a file, both in. */
type Span = { from: number; to: number };

/**
 * The lines a `git diff --unified=0` changed, by path. A hunk that only deletes (`+n,0`)
 * changed the lines on each side of it.
 */
function changedIn(diff: string) {
  const changed = new Map<string, Span[]>();
  let spans: Span[] = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) changed.set(line.slice(4), (spans = []));
    const hunk = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!hunk) continue;

    const [, start = "", size = "1"] = hunk;
    const from = Number(start);
    const count = Number(size);
    spans.push({ from, to: count ? from + count - 1 : from + 1 });
  }
  return changed;
}

/**
 * What one git command printed, run in the app's folder.
 *
 * @throws `ToolFailed` when it fails: a ref that is no commit, or an app in no repo.
 */
function gitIn(root: string, command: string, args: string[]) {
  const done = spawnSync("git", [command, ...args], {
    cwd: root,
    env: envWith({}),
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
  const output = `${done.stdout ?? ""}${done.stderr ?? ""}`;
  if (done.status !== 0) raise("ToolFailed", { tool: `git ${command}`, output });
  return done.stdout;
}

/**
 * The ops whose `operation(…)` call has a line changed since `ref`: `git diff <ref>`, the
 * working tree included, with paths from the app's root. A file git does not track yet
 * (`git ls-files --others --exclude-standard`) is changed on every line.
 *
 * @throws `ToolFailed` when `git diff` or `git ls-files` fails.
 */
function opsSince(root: string, ops: Graph.Line[], ref: string) {
  const diff = ["--relative", "--no-prefix", "--no-color", "--unified=0", ref];
  const changed = changedIn(gitIn(root, "diff", diff));
  for (const path of gitIn(root, "ls-files", ["-z", "--others", "--exclude-standard"]).split(
    "\0",
  )) {
    if (path) changed.set(path, [{ from: 1, to: Infinity }]);
  }

  return ops.filter(({ path, line, end }) =>
    (changed.get(path) ?? []).some(({ from, to }) => from <= end && line <= to),
  );
}

/**
 * Put one fault at a time at each graph fact a test reached, and run only the test files whose
 * trace holds that fact (ADR 0173). A file whose trace is empty is named, never run: its scopes
 * list no `exits`, so the fault cannot reach them. A mutant is killed when its run fails or times out. Only a
 * fact the graph states gets a mutant: a hook's write or call has no line, so it gets none.
 * `since` keeps only the ops whose lines changed since that ref.
 *
 * @throws `BadConfig` for a `tinker.json` it cannot read.
 * @throws `ToolFailed` when `git diff <since>` or `git ls-files` fails.
 */
export function readPins(root: string, since?: string): Pins.Report {
  const { tests } = configOf(root);
  if (!tests) return { kind: "untested" };
  const files = globSync("**", { cwd: root, exclude: isModules })
    .map((path) => path.replaceAll("\\", "/"))
    .filter((path) => testFile.test(path))
    .sort();
  const { ops, hooks } = graphOf(root);
  const chosen = since === undefined ? ops : opsSince(root, ops, since);
  if (!chosen.length) {
    return { kind: "ran", mutants: 0, files: files.length, untraced: [], live: [] };
  }

  const traces: { file: string; trace: Trace }[] = [];
  for (const file of files) {
    const run = traceOf(root, tests, file);
    if (!run.passed) return { kind: "red", file, output: run.output };
    traces.push({ file, trace: run.trace });
  }

  const untraced = traces.filter(({ trace }) => !trace.facts.size).map(({ file }) => file);
  const all = unionOf(traces.map(({ trace }) => trace));
  const hookRuns = hookRunsOf(hooks);
  const mutants = chosen.flatMap((op) => [
    ...swapsOf(op, all),
    ...emptiesOf(op, all),
    ...dropsOf(op, all),
    ...failsOf(op, all, hookRuns),
  ]);
  const live = mutants.flatMap(({ op, fault, fact, traced }): Pins.Live[] => {
    const reachedBy = traces.filter(({ trace }) => trace.facts.has(traced)).map(({ file }) => file);
    const env = envWith({ TINKER_MUTANT: JSON.stringify(fault) });
    if (!runFiles(root, tests, reachedBy, env).passed) return [];
    return [{ path: op.path, line: op.line, fault, fact, reachedBy }];
  });
  return { kind: "ran", mutants: mutants.length, files: files.length, untraced, live };
}
