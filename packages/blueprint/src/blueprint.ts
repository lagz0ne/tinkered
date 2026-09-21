import * as yaml from "yaml";
import { z } from "zod";
import { raise } from "./errors.ts";

export { isError } from "./errors.ts";
export type { Errors } from "./errors.ts";

/** One parsed blueprint node. `kind` is the YAML key; `depends` is always an array. */
export declare namespace Blueprint {
  /** One parsed node. `kind` is the YAML key; `depends` is always an array. */
  export type Node = {
    readonly kind: "data" | "resource" | "operation" | "tag";
    readonly name: string;
    readonly promise: string;
    readonly why: string;
    readonly depends: readonly string[];
    readonly work?: string;
    readonly target?: "scope" | "session";
  };
  /** The parsed file: nodes in file order plus the two edge readers. */
  export type Graph = {
    readonly nodes: readonly Node[];
    /** The nodes `name` lists in `depends` (missing names are skipped). */
    readonly uses: (name: string) => readonly Node[];
    /** The nodes whose `depends` name `name`. */
    readonly usedBy: (name: string) => readonly Node[];
  };
  /** A node field, or a neighbour list, a template may read. */
  export type StateField =
    | "kind"
    | "name"
    | "promise"
    | "why"
    | "depends"
    | "work"
    | "target"
    | "uses"
    | "usedBy";
  /** One loaded template. A `choice` template's `compare` names the field its pick is
   * measured against; a template with no `compare` never produces a choice finding. */
  export type Template = {
    readonly id: string;
    readonly scope: "node" | "pair";
    readonly applies: readonly Node["kind"][];
    readonly needs: readonly StateField[];
    readonly status: "provisional" | "proven";
    readonly ask: string;
  } & (
    | {
        readonly kind: "boolean";
        readonly true: string;
        readonly false: string;
        readonly threshold: number;
      }
    | {
        readonly kind: "choice";
        readonly choices: Readonly<Record<string, string>>;
        readonly minConfidence: number;
        readonly compare?: StateField;
      }
  );
  /** The loaded corpus: every template, sorted by id, plus a reader per kind. */
  export type Corpus = {
    readonly templates: readonly Template[];
    /** The node-scope templates that apply to `kind`. */
    readonly forKind: (kind: Node["kind"]) => readonly Template[];
    /** The pair-scope templates. */
    readonly pairs: readonly Template[];
  };
  /** The Jev engine: which model, which key. Bound at the root; a test never binds it. */
  export type Engine = { readonly model: string; readonly apiKey: string };
  /** What the judge sees for one node: the node, plus its one-hop neighbours. */
  export type NodeState = Node & {
    readonly uses: readonly Node[];
    readonly usedBy: readonly Node[];
  };
  /** What the judge sees for a pair template. */
  export type PairState = { readonly a: NodeState; readonly b: NodeState };
  /** One answer: a boolean's probability, or a choice with its confidence. */
  export type Answer =
    | { readonly type: "boolean"; readonly probability: number }
    | {
        readonly type: "choice";
        readonly choice: string;
        readonly probabilities?: Readonly<Record<string, number>>;
      };
  /** One question, as the engine takes it. */
  export type Question =
    | {
        readonly type: "boolean";
        readonly instructions: string;
        readonly criteria: { readonly true: string; readonly false: string };
      }
    | {
        readonly type: "choice";
        readonly instructions: string;
        readonly criteria: Readonly<Record<string, string>>;
      };
  /** The judge: asks every question in one call about one state. */
  export type Judge = {
    readonly ask: (
      state: NodeState | PairState,
      questions: Readonly<Record<string, Question>>,
      signal: AbortSignal,
    ) => Promise<Readonly<Record<string, Answer>>>;
  };
  /** One result line. `source` is `"plain"` or a template id. `blocking` is true for a plain
   * finding or a hit from a `proven` template. */
  export type Finding = {
    readonly source: string;
    readonly check: string;
    readonly node: string;
    readonly detail: string;
    readonly probability?: number;
    readonly blocking: boolean;
  };
  /** What `check` answers: how many nodes it read and every finding. */
  export type Report = {
    readonly nodes: number;
    readonly findings: readonly Finding[];
  };
  /** One eval file: a small blueprint plus what the judge should say about one
   * node (`target` names it) or one pair (`target` names both). */
  export type Eval = {
    readonly file: string;
    readonly target: string | readonly [string, string];
    readonly expect: boolean | string;
    readonly graph: Graph;
  };
  /** One template's grade against its evals: `bad`/`clean` are the per-case
   * numbers `gradeTemplate` scored (a probability, or a choice's `1 - probabilities[declared]`). */
  export type Grade = {
    readonly id: string;
    readonly status: "proven" | "provisional" | "noisy";
    readonly bad: readonly number[];
    readonly clean: readonly number[];
    readonly sep: number;
    readonly ordered: number;
  };
}

type Parsed = z.infer<typeof entries>;

/** A node name holds letters, digits, and `_` — a dot is an error. */
const name = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]*$/, 'a name holds letters, digits, and _; a "." is an error');

const base = z.strictObject({
  name,
  promise: z.string().min(1),
  why: z.string().min(1),
  depends: z.array(name).default([]),
});

const dataEntry = z.strictObject({ data: base });
const tagEntry = z.strictObject({ tag: base });
const operationEntry = z.strictObject({
  operation: base.extend({ work: z.string().optional() }),
});
const resourceEntry = z.strictObject({
  resource: base.extend({
    work: z.string().optional(),
    target: z.enum(["scope", "session"]).default("scope"),
  }),
});

const entries = z.array(z.union([dataEntry, tagEntry, operationEntry, resourceEntry]));

/** Read one parsed entry into a node: the kind is the key, the rest is the value. */
function readNode(entry: Parsed[number]): Blueprint.Node {
  if ("data" in entry) return { kind: "data", ...entry.data };
  if ("tag" in entry) return { kind: "tag", ...entry.tag };
  if ("operation" in entry) return { kind: "operation", ...entry.operation };
  return { kind: "resource", ...entry.resource };
}

/** Build a graph's edge readers over its nodes, in file order. */
function graphFrom(nodes: readonly Blueprint.Node[]): Blueprint.Graph {
  const byName = new Map(nodes.map((node) => [node.name, node]));
  return {
    nodes,
    uses: (called) => {
      const node = byName.get(called);
      if (node === undefined) return [];
      return node.depends.flatMap((dep) => {
        const found = byName.get(dep);
        return found === undefined ? [] : [found];
      });
    },
    usedBy: (called) => nodes.filter((candidate) => candidate.depends.includes(called)),
  };
}

/** Parse yaml text into a graph. Throws `InvalidBlueprint` (registry) on a yaml
 * or schema failure, with the zod issues in the payload. */
export function readBlueprint(text: string): Blueprint.Graph {
  let parsed: unknown;
  try {
    parsed = yaml.parse(text);
  } catch (error: unknown) {
    raise("InvalidBlueprint", { text, issues: [error] });
  }
  const result = entries.safeParse(parsed);
  if (!result.success) raise("InvalidBlueprint", { text, issues: result.error.issues });
  return graphFrom(result.data.map(readNode));
}

/** One finding line: what `check` prints, one per line. A non-blocking (provisional
 * template) finding starts with `~`. */
export function findingLine(finding: Blueprint.Finding): string {
  const prefix = finding.blocking ? "" : "~";
  const pct =
    finding.probability === undefined ? "" : ` (${Math.round(finding.probability * 100)}%)`;
  return `${prefix}${finding.check}  ${finding.node}  ${finding.detail}${pct}`;
}

/** One finding per repeated name; `node` is the name. */
function duplicateNames(nodes: readonly Blueprint.Node[]): readonly Blueprint.Finding[] {
  const counts = new Map<string, number>();
  for (const node of nodes) counts.set(node.name, (counts.get(node.name) ?? 0) + 1);
  const seen = new Set<string>();
  const found: Blueprint.Finding[] = [];
  for (const node of nodes) {
    if ((counts.get(node.name) ?? 0) < 2 || seen.has(node.name)) continue;
    seen.add(node.name);
    found.push({
      source: "plain",
      check: "duplicateName",
      node: node.name,
      detail: `the name "${node.name}" names ${counts.get(node.name)} nodes`,
      blocking: true,
    });
  }
  return found;
}

/** One finding per missing name per node. */
function unknownNames(nodes: readonly Blueprint.Node[]): readonly Blueprint.Finding[] {
  const known = new Set(nodes.map((node) => node.name));
  return nodes.flatMap((node) =>
    node.depends
      .filter((dep) => !known.has(dep))
      .map((dep) => ({
        source: "plain" as const,
        check: "unknownDepends",
        node: node.name,
        detail: `depends on "${dep}": no such node`,
        blocking: true,
      })),
  );
}

/** One finding per `data` node no operation or resource names in `depends`.
 * The file cannot tell a read from a write, so any dependent counts as a writer. */
function unwrittenData(graph: Blueprint.Graph): readonly Blueprint.Finding[] {
  return graph.nodes
    .filter(
      (node) =>
        node.kind === "data" && !graph.usedBy(node.name).some((user) => user.kind !== "data"),
    )
    .map((node) => ({
      source: "plain" as const,
      check: "dataNoWriter",
      node: node.name,
      detail: "no operation or resource depends on it",
      blocking: true,
    }));
}

/** The plain checks, in this order: duplicateName, unknownDepends, dataNoWriter. */
export function plainChecks(graph: Blueprint.Graph): readonly Blueprint.Finding[] {
  return [...duplicateNames(graph.nodes), ...unknownNames(graph.nodes), ...unwrittenData(graph)];
}

/** Parse the operation's raw input (the file text) into a graph. A yaml or
 * schema failure throws `InvalidBlueprint` — the input admits it as the
 * operation's parse failure, which the cli maps to exit 2. */
export function parseGraph(raw: unknown): Blueprint.Graph {
  if (typeof raw !== "string") raise("InvalidBlueprint", { text: "", issues: [raw] });
  return readBlueprint(raw);
}

/** Parse `check`'s raw input (the cli's `{ text, json }`) into its typed input: the
 * graph (via {@link parseGraph}) beside the flag `respond` needs later. */
export function parseCheckInput(raw: unknown): {
  readonly graph: Blueprint.Graph;
  readonly json: boolean;
} {
  const call = checkCall.safeParse(raw);
  if (!call.success) raise("InvalidBlueprint", { text: "", issues: call.error.issues });
  return { graph: parseGraph(call.data.text), json: call.data.json };
}

/** What the cli row hands `check`: the file text beside the `--json` flag. */
const checkCall = z.object({ text: z.string(), json: z.boolean().default(false) });

/** Every kind a template may apply to. */
const nodeKind = z.enum(["data", "resource", "operation", "tag"]);

/** Every field a template may read: the node's own fields plus the edge readers. */
const stateField = z.enum([
  "kind",
  "name",
  "promise",
  "why",
  "depends",
  "work",
  "target",
  "uses",
  "usedBy",
]);

const booleanTemplate = z.strictObject({
  id: z.string().min(1),
  scope: z.enum(["node", "pair"]).default("node"),
  applies: z.array(nodeKind).min(1),
  needs: z.array(stateField).default([]),
  status: z.enum(["provisional", "proven"]),
  ask: z.string().min(1),
  kind: z.literal("boolean"),
  true: z.string().min(1),
  false: z.string().min(1),
  threshold: z.number().default(0.5),
});

const choiceTemplate = z.strictObject({
  id: z.string().min(1),
  scope: z.enum(["node", "pair"]).default("node"),
  applies: z.array(nodeKind).min(1),
  needs: z.array(stateField).default([]),
  status: z.enum(["provisional", "proven"]),
  ask: z.string().min(1),
  kind: z.literal("choice"),
  choices: z.record(z.string(), z.string().min(1)),
  minConfidence: z.number().default(0.6),
  compare: stateField.optional(),
});

const templateFile = z.discriminatedUnion("kind", [booleanTemplate, choiceTemplate]);

/** Read one template file (yaml text) into a template. A yaml or schema failure
 * throws `InvalidTemplate` with the file name and the issues; the message names
 * the file and, per issue, the path and what zod said — that is what stderr shows. */
export function readTemplate(text: string, file: string): Blueprint.Template {
  let parsed: unknown;
  try {
    parsed = yaml.parse(text);
  } catch (error: unknown) {
    raise("InvalidTemplate", { file, issues: [error] }, `${file}: ${String(error)}`);
  }
  const result = templateFile.safeParse(parsed);
  if (!result.success) {
    const lines = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    raise("InvalidTemplate", { file, issues: result.error.issues }, `${file}: ${lines.join("; ")}`);
  }
  return result.data;
}

/** Read the loaded templates into a corpus: sorted by id, node-scope templates
 * per kind, pair-scope templates under `pairs`. */
export function readCorpus(loaded: readonly Blueprint.Template[]): Blueprint.Corpus {
  const templates = [...loaded].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    templates,
    forKind: (kind) =>
      templates.filter((item) => item.scope === "node" && item.applies.includes(kind)),
    pairs: templates.filter((item) => item.scope === "pair"),
  };
}

/** One eval file's own shape: `target` (a node name, or a pair), `expect`
 * (a boolean, or the option name a choice template should pick), and
 * `blueprint` (the same node list `readBlueprint` parses). */
const evalFile = z.strictObject({
  target: z.union([name, z.tuple([name, name])]),
  expect: z.union([z.boolean(), z.string()]),
  blueprint: entries,
});

/** Read one eval file (yaml text) into an eval. A yaml or schema failure
 * throws `InvalidEval` with the file name and the issues, same shape as
 * {@link readTemplate}'s `InvalidTemplate`. */
export function readEval(text: string, file: string): Blueprint.Eval {
  let parsed: unknown;
  try {
    parsed = yaml.parse(text);
  } catch (error: unknown) {
    raise("InvalidEval", { file, issues: [error] }, `${file}: ${String(error)}`);
  }
  const result = evalFile.safeParse(parsed);
  if (!result.success) {
    const lines = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    raise("InvalidEval", { file, issues: result.error.issues }, `${file}: ${lines.join("; ")}`);
  }
  return {
    file,
    target: result.data.target,
    expect: result.data.expect,
    graph: graphFrom(result.data.blueprint.map(readNode)),
  };
}

/** One template as a question, straight from its fields. */
function templateQuestion(template: Blueprint.Template): Blueprint.Question {
  return template.kind === "boolean"
    ? {
        type: "boolean",
        instructions: template.ask,
        criteria: { true: template.true, false: template.false },
      }
    : { type: "choice", instructions: template.ask, criteria: template.choices };
}

/** One `judge.ask` questions map, keyed by template id. */
function questionsOf(
  templates: readonly Blueprint.Template[],
): Readonly<Record<string, Blueprint.Question>> {
  return Object.fromEntries(templates.map((template) => [template.id, templateQuestion(template)]));
}

/** The field a choice template's pick is measured against, or `undefined` (no `compare`,
 * or a boolean template — it never compares). */
function compareValueOf(template: Blueprint.Template, state: Blueprint.NodeState): unknown {
  if (template.kind !== "choice" || template.compare === undefined) return undefined;
  return state[template.compare];
}

/** A boolean template's finding, or `undefined` below `threshold`. */
function booleanFinding(
  template: Blueprint.Template & { readonly kind: "boolean" },
  answer: Blueprint.Answer,
  node: string,
): Blueprint.Finding | undefined {
  if (answer.type !== "boolean" || answer.probability < template.threshold) return undefined;
  return {
    source: template.id,
    check: template.id,
    node,
    detail: template.true,
    probability: answer.probability,
    blocking: template.status === "proven",
  };
}

/** A choice template's finding: the pick differs from `compareValue`, at or above `minConfidence`. */
function choiceFinding(
  template: Blueprint.Template & { readonly kind: "choice" },
  answer: Blueprint.Answer,
  node: string,
  compareValue: unknown,
): Blueprint.Finding | undefined {
  if (answer.type !== "choice") return undefined;
  const confidence = answer.probabilities?.[answer.choice] ?? 0;
  if (confidence < template.minConfidence || answer.choice === compareValue) return undefined;
  return {
    source: template.id,
    check: template.id,
    node,
    detail: `reads as ${answer.choice}`,
    probability: confidence,
    blocking: template.status === "proven",
  };
}

/** One template's finding from its answer, or `undefined` when it does not hit
 * (tools/jev/lint.mjs hit rules): {@link booleanFinding} or {@link choiceFinding}. */
function templateFinding(
  template: Blueprint.Template,
  answer: Blueprint.Answer | undefined,
  node: string,
  compareValue: unknown,
): Blueprint.Finding | undefined {
  if (answer === undefined) return undefined;
  return template.kind === "boolean"
    ? booleanFinding(template, answer, node)
    : choiceFinding(template, answer, node, compareValue);
}

/** One node plus its one-hop neighbours, as the judge sees it. */
function nodeStateOf(graph: Blueprint.Graph, node: Blueprint.Node): Blueprint.NodeState {
  return { ...node, uses: graph.uses(node.name), usedBy: graph.usedBy(node.name) };
}

/** Every unordered pair of nodes, in file order (`nodes[i]` before `nodes[j]`, `i < j`). */
function pairsOf(
  nodes: readonly Blueprint.Node[],
): readonly (readonly [Blueprint.Node, Blueprint.Node])[] {
  const pairs: (readonly [Blueprint.Node, Blueprint.Node])[] = [];
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) pairs.push([nodes[i], nodes[j]]);
  return pairs;
}

/** One `judge.ask` per node: every `forKind` template, keyed by id, against the node's state. */
async function nodeFindings(
  graph: Blueprint.Graph,
  corpus: Blueprint.Corpus,
  judge: Blueprint.Judge,
  signal: AbortSignal,
): Promise<readonly Blueprint.Finding[]> {
  const findings: Blueprint.Finding[] = [];
  for (const node of graph.nodes) {
    const templates = corpus.forKind(node.kind);
    if (templates.length === 0) continue;
    const state = nodeStateOf(graph, node);
    const answers = await judge.ask(state, questionsOf(templates), signal);
    for (const template of templates) {
      const finding = templateFinding(
        template,
        answers[template.id],
        node.name,
        compareValueOf(template, state),
      );
      if (finding) findings.push(finding);
    }
  }
  return findings;
}

/** One `judge.ask` per unordered pair whose two kinds both match a pair template's `applies`. */
async function pairFindings(
  graph: Blueprint.Graph,
  corpus: Blueprint.Corpus,
  judge: Blueprint.Judge,
  signal: AbortSignal,
): Promise<readonly Blueprint.Finding[]> {
  const findings: Blueprint.Finding[] = [];
  for (const [a, b] of pairsOf(graph.nodes)) {
    const applicable = corpus.pairs.filter(
      (template) => template.applies.includes(a.kind) && template.applies.includes(b.kind),
    );
    if (applicable.length === 0) continue;
    const state: Blueprint.PairState = { a: nodeStateOf(graph, a), b: nodeStateOf(graph, b) };
    const answers = await judge.ask(state, questionsOf(applicable), signal);
    for (const template of applicable) {
      const finding = templateFinding(
        template,
        answers[template.id],
        `${a.name}, ${b.name}`,
        undefined,
      );
      if (finding) findings.push(finding);
    }
  }
  return findings;
}

/** `check`'s core: plain checks, then one `judge.ask` per node, then one `judge.ask` per matching
 * pair. `blocking` never throws here — the caller decides what a blocking finding means. */
export async function runCheck(
  graph: Blueprint.Graph,
  corpus: Blueprint.Corpus,
  judge: Blueprint.Judge,
  signal: AbortSignal,
): Promise<Blueprint.Report> {
  const findings = [
    ...plainChecks(graph),
    ...(await nodeFindings(graph, corpus, judge, signal)),
    ...(await pairFindings(graph, corpus, judge, signal)),
  ];
  return { nodes: graph.nodes.length, findings };
}

/** One eval's state, as the judge sees it: `target`'s node (or, for a pair template, both
 * nodes), each with its one-hop neighbours. Throws `InvalidEval` when `target` names no node. */
function evalStateOf(
  template: Blueprint.Template,
  evalCase: Blueprint.Eval,
): Blueprint.NodeState | Blueprint.PairState {
  const find = (called: string): Blueprint.Node => {
    const node = evalCase.graph.nodes.find((candidate) => candidate.name === called);
    if (node === undefined)
      raise(
        "InvalidEval",
        { file: evalCase.file, issues: [`target "${called}": no such node`] },
        `${evalCase.file}: target "${called}": no such node`,
      );
    return node;
  };
  if (template.scope === "pair") {
    const [a, b] = evalCase.target as readonly [string, string];
    return { a: nodeStateOf(evalCase.graph, find(a)), b: nodeStateOf(evalCase.graph, find(b)) };
  }
  return nodeStateOf(evalCase.graph, find(evalCase.target as string));
}

/** One eval case's score: a boolean's probability, or a choice's `1 - probabilities[declared]`
 * (0 when `probabilities` is absent) — `declared` is the field `compare` names on the target node. */
async function scoreEval(
  template: Blueprint.Template,
  question: Blueprint.Question,
  evalCase: Blueprint.Eval,
  judge: Blueprint.Judge,
  signal: AbortSignal,
): Promise<number> {
  const state = evalStateOf(template, evalCase);
  const answers = await judge.ask(state, { [template.id]: question }, signal);
  const answer = answers[template.id];
  if (answer === undefined) return 0;
  if (answer.type === "boolean") return answer.probability;
  if (answer.probabilities === undefined) return 0;
  const declared = compareValueOf(template, state as Blueprint.NodeState);
  return 1 - (answer.probabilities[declared as string] ?? 0);
}

/** The middle value, sorted ascending; `NaN` with nothing to average. */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return NaN;
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** The share of (bad, clean) pairs where the bad score outranks the clean one; 0 with no pairs. */
function orderedShare(bad: readonly number[], clean: readonly number[]): number {
  let ordered = 0;
  for (const b of bad) for (const c of clean) if (b > c) ordered++;
  const pairs = bad.length * clean.length;
  return pairs === 0 ? 0 : ordered / pairs;
}

/** The grade for one template's `bad`/`clean` scores — `tools/jev/calibrate.mjs`'s bar, copied:
 * fewer than 2 cases on either side is `provisional`; enough cases, separation ≥ 0.30 and
 * ordering ≥ 0.90 is `proven`; enough cases otherwise is `noisy`. */
function gradeFrom(id: string, bad: readonly number[], clean: readonly number[]): Blueprint.Grade {
  const enough = bad.length >= 2 && clean.length >= 2;
  const sep = median(bad) - median(clean);
  const ordered = orderedShare(bad, clean);
  const status = !enough ? "provisional" : sep >= 0.3 && ordered >= 0.9 ? "proven" : "noisy";
  return { id, status, bad, clean, sep, ordered };
}

/** Grade one template against its evals with the judge (ADR 0052 decision 5): every bad
 * case should score high, every clean case low. Pure over its inputs — no file read, no
 * corpus lookup. */
export async function gradeTemplate(
  template: Blueprint.Template,
  evals: { readonly bad: readonly Blueprint.Eval[]; readonly clean: readonly Blueprint.Eval[] },
  judge: Blueprint.Judge,
  signal: AbortSignal,
): Promise<Blueprint.Grade> {
  const question = templateQuestion(template);
  const bad: number[] = [];
  for (const evalCase of evals.bad)
    bad.push(await scoreEval(template, question, evalCase, judge, signal));
  const clean: number[] = [];
  for (const evalCase of evals.clean)
    clean.push(await scoreEval(template, question, evalCase, judge, signal));
  return gradeFrom(template.id, bad, clean);
}
