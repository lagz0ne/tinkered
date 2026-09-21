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
  /** One declared unit in the code: what `verify` compares a node with (`src/extract.ts`'s
   * `readUnits`, ADR 0055 §2). */
  export type Unit = {
    readonly kind: Node["kind"];
    readonly label: string;
    /** Relative to the dir `readUnits` was walked from. */
    readonly file: string;
    readonly line: number;
    /** Identifier roots of the `depends` values, in order (a dotted name reads as its own
     * text — ADR 0055 §1: a frame's part is not a unit of its own). */
    readonly depends: readonly string[];
    readonly target?: "scope" | "session";
    /** The source text of `run` / `factory`; `data` and `tag` units carry none. */
    readonly body?: string;
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
  /** The two node fields a choice template's pick may be compared against — the only
   * `StateField`s that are themselves a single string value. */
  export type CompareField = "kind" | "target";
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
        readonly compare?: CompareField;
        /** The target shape per choice, printed by `explain` and `suggest`. When
         * present, its keys must equal `choices`'s keys (checked at load). */
        readonly shapes?: Readonly<Record<string, string>>;
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
  /** What the judge sees for `suggest`: a sentence, not a node. */
  export type WordsState = { readonly description: string };
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
      state: NodeState | PairState | WordsState,
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
  /** What `verify` answers: how many nodes and units it read, and every finding. */
  export type VerifyReport = {
    readonly nodes: number;
    readonly units: number;
    readonly findings: readonly Finding[];
  };
  /** One eval file: a small blueprint plus what the judge should say about one
   * node (`target` holds its one name) or one pair (`target` holds both names). */
  export type Eval = {
    readonly file: string;
    readonly target: readonly string[];
    readonly expect: boolean | string;
    readonly graph: Graph;
  };
  /** One template's grade against its evals: `bad`/`clean` are the per-case
   * numbers `gradeTemplate` scored (a probability, or a choice's `1 - probabilities[declared]`);
   * `clean` includes the golden cases built from `evals/golden.yaml`. `goldenHits` names every
   * golden node (or pair) that scored as a real finding would — any hit forces `noisy`, never
   * `proven`, regardless of `sep`/`ordered`. `goldenTotal` is how many golden cases were asked. */
  export type Grade = {
    readonly id: string;
    readonly status: "proven" | "provisional" | "noisy";
    readonly bad: readonly number[];
    readonly clean: readonly number[];
    readonly sep: number;
    readonly ordered: number;
    readonly goldenHits: readonly string[];
    readonly goldenTotal: number;
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

/** The unit whose `label` is `name` (ADR 0055 §1: a node finds its unit by label), or
 * `undefined` when no unit carries it. */
function unitFor(units: readonly Blueprint.Unit[], name: string): Blueprint.Unit | undefined {
  return units.find((unit) => unit.label === name);
}

/** One finding per graph node with no unit of that label. */
function missingUnits(
  graph: Blueprint.Graph,
  units: readonly Blueprint.Unit[],
): readonly Blueprint.Finding[] {
  return graph.nodes
    .filter((node) => unitFor(units, node.name) === undefined)
    .map((node) => ({
      source: "plain" as const,
      check: "missingUnit",
      node: node.name,
      detail: `no unit labeled "${node.name}"`,
      blocking: true,
    }));
}

/** One finding per declared unit with no node of that label — plain functions and glue are
 * never units, so this only ever names a `data`/`resource`/`operation`/`tag` call. */
function undeclaredUnits(
  graph: Blueprint.Graph,
  units: readonly Blueprint.Unit[],
): readonly Blueprint.Finding[] {
  const names = new Set(graph.nodes.map((node) => node.name));
  return units
    .filter((unit) => !names.has(unit.label))
    .map((unit) => ({
      source: "plain" as const,
      check: "undeclaredUnit",
      node: unit.label,
      detail: `${unit.kind} labeled "${unit.label}" at ${unit.file}:${unit.line} has no node`,
      blocking: true,
    }));
}

/** One finding per node whose kind differs from its unit's. */
function kindMismatches(
  graph: Blueprint.Graph,
  units: readonly Blueprint.Unit[],
): readonly Blueprint.Finding[] {
  return graph.nodes.flatMap((node) => {
    const unit = unitFor(units, node.name);
    if (unit === undefined || unit.kind === node.kind) return [];
    return [
      {
        source: "plain" as const,
        check: "kindMismatch",
        node: node.name,
        detail: `the file says ${node.kind}; ${unit.file}:${unit.line} declares a ${unit.kind}`,
        blocking: true,
      },
    ];
  });
}

/** Two string sets hold exactly the same members, order ignored. */
function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((item) => b.has(item));
}

/** One finding per node whose declared `depends` set differs from its unit's — both read as
 * sets of labels (ADR 0055 §1: a name the code writes that names no unit, such as a frame's
 * part `store.tx`, reads as its own text and so never equals a label). */
function dependsMismatches(
  graph: Blueprint.Graph,
  units: readonly Blueprint.Unit[],
): readonly Blueprint.Finding[] {
  return graph.nodes.flatMap((node) => {
    const unit = unitFor(units, node.name);
    if (unit === undefined) return [];
    const declared = new Set(node.depends);
    const coded = new Set(unit.depends);
    if (sameSet(declared, coded)) return [];
    return [
      {
        source: "plain" as const,
        check: "dependsMismatch",
        node: node.name,
        detail: `the file names [${[...declared].sort().join(", ")}]; the code names [${[...coded].sort().join(", ")}]`,
        blocking: true,
      },
    ];
  });
}

/** One finding per `resource` node whose `target` differs from its unit's. */
function targetMismatches(
  graph: Blueprint.Graph,
  units: readonly Blueprint.Unit[],
): readonly Blueprint.Finding[] {
  return graph.nodes.flatMap((node) => {
    if (node.kind !== "resource") return [];
    const unit = unitFor(units, node.name);
    if (unit === undefined || unit.target === node.target) return [];
    return [
      {
        source: "plain" as const,
        check: "targetMismatch",
        node: node.name,
        detail: `the file says ${node.target}; ${unit.file}:${unit.line} declares ${unit.target}`,
        blocking: true,
      },
    ];
  });
}

/** The five plain checks of ADR 0055 §3, in this order: missingUnit, undeclaredUnit,
 * kindMismatch, dependsMismatch, targetMismatch. Pure over its inputs. */
export function verifyChecks(
  graph: Blueprint.Graph,
  units: readonly Blueprint.Unit[],
): readonly Blueprint.Finding[] {
  return [
    ...missingUnits(graph, units),
    ...undeclaredUnits(graph, units),
    ...kindMismatches(graph, units),
    ...dependsMismatches(graph, units),
    ...targetMismatches(graph, units),
  ];
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

/** What the cli row hands `verify`: the file text, the dir's units (already parsed by
 * `readUnits` at the row, the process edge), the dir (for `NoSource`'s message), and `--json`. */
const verifyCall = z.object({
  text: z.string(),
  units: z.array(z.custom<Blueprint.Unit>()),
  dir: z.string(),
  json: z.boolean().default(false),
});

/** Parse `verify`'s raw input into its typed input: the graph (via {@link parseGraph}) beside
 * the units `readUnits` already extracted. Throws `NoSource` when the dir held no unit — a
 * missing `*.ts` file walks to an empty `units`, same admission point as a bad yaml file. */
export function parseVerifyInput(raw: unknown): {
  readonly graph: Blueprint.Graph;
  readonly units: readonly Blueprint.Unit[];
  readonly json: boolean;
} {
  const call = verifyCall.safeParse(raw);
  if (!call.success) raise("InvalidBlueprint", { text: "", issues: call.error.issues });
  const graph = parseGraph(call.data.text);
  if (call.data.units.length === 0)
    raise("NoSource", { dir: call.data.dir }, `blueprint: no *.ts file under ${call.data.dir}`);
  return { graph, units: call.data.units, json: call.data.json };
}

/** What the cli row hands `suggest`: the words to classify. */
const suggestCall = z.object({ words: z.string() });

/** Parse `suggest`'s raw input into its typed input: the words, rejected empty
 * (after trim) with `NoWords` — the input admits it as the operation's parse
 * failure, which the cli maps to exit 2. */
export function parseSuggestInput(raw: unknown): { readonly words: string } {
  const call = suggestCall.safeParse(raw);
  if (!call.success || call.data.words.trim() === "")
    raise("NoWords", {}, "blueprint: suggest needs words");
  return { words: call.data.words };
}

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

/** The two node fields a choice template's `compare` may name — the only `stateField`
 * values that are themselves a single string, so a pick can be measured against them. */
const compareField = z.enum(["kind", "target"]);

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
  compare: compareField.optional(),
  shapes: z.record(z.string(), z.string().min(1)).optional(),
});

/** `shapes`, when present, must name exactly the same options as `choices` —
 * a shape for an option the question never offers, or a missing shape, is a
 * template-authoring mistake caught at load, same as an unknown `needs`. */
const templateFile = z
  .discriminatedUnion("kind", [booleanTemplate, choiceTemplate])
  .superRefine((template, ctx) => {
    if (template.kind !== "choice" || template.shapes === undefined) return;
    const choiceKeys = Object.keys(template.choices).sort();
    const shapeKeys = Object.keys(template.shapes).sort();
    if (choiceKeys.join(",") !== shapeKeys.join(","))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["shapes"],
        message: "shapes keys must equal choices keys",
      });
  });

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
    target: Array.isArray(result.data.target) ? result.data.target : [result.data.target],
    expect: result.data.expect,
    graph: graphFrom(result.data.blueprint.map(readNode)),
  };
}

/** One template as a question, straight from its fields. */
export function templateQuestion(template: Blueprint.Template): Blueprint.Question {
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
 * or a boolean template — it never compares). `compare` only ever names `kind` or `target`
 * (`CompareField`), so the read is always a single string, never a cast. */
function compareValueOf(
  template: Blueprint.Template,
  state: Blueprint.NodeState,
): string | undefined {
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

/** One name off an eval's `target`, at `index`. Throws `InvalidEval` when the name is
 * missing (too few names) or names no node in the eval's own blueprint. */
function findTarget(evalCase: Blueprint.Eval, index: number): Blueprint.Node {
  const called = evalCase.target[index];
  if (called === undefined)
    raise(
      "InvalidEval",
      { file: evalCase.file, issues: [`target: needs a name at index ${index}`] },
      `${evalCase.file}: target: needs a name at index ${index}`,
    );
  const node = evalCase.graph.nodes.find((candidate) => candidate.name === called);
  if (node === undefined)
    raise(
      "InvalidEval",
      { file: evalCase.file, issues: [`target "${called}": no such node`] },
      `${evalCase.file}: target "${called}": no such node`,
    );
  return node;
}

/** One eval's state, as the judge sees it: `target`'s node (or, for a pair template, both
 * nodes), each with its one-hop neighbours. Throws `InvalidEval` when `target` names no node. */
function evalStateOf(
  template: Blueprint.Template,
  evalCase: Blueprint.Eval,
): Blueprint.NodeState | Blueprint.PairState {
  if (template.scope === "pair")
    return {
      a: nodeStateOf(evalCase.graph, findTarget(evalCase, 0)),
      b: nodeStateOf(evalCase.graph, findTarget(evalCase, 1)),
    };
  return nodeStateOf(evalCase.graph, findTarget(evalCase, 0));
}

/** A boolean's probability, or a choice's `1 - probabilities[declared]` (0 when `probabilities`
 * is absent) — `declared` is the value `compare` names on the target node. */
function pOf(answer: Blueprint.Answer | undefined, declared: string | undefined): number {
  if (answer === undefined) return 0;
  if (answer.type === "boolean") return answer.probability;
  if (answer.probabilities === undefined) return 0;
  return 1 - (answer.probabilities[declared ?? ""] ?? 0);
}

/** One eval case's node label, as `check`'s findings print it: the node name, or
 * `"a, b"` for a pair template — discriminated by shape (`"a" in state`), not `template.scope`. */
function evalNodeOf(state: Blueprint.NodeState | Blueprint.PairState): string {
  return "a" in state ? `${state.a.name}, ${state.b.name}` : state.name;
}

/** One eval case's score (`pOf`) and whether it would have produced a real finding
 * (the same rule {@link runCheck} blocks on) — a golden case that hits names the design
 * this template would have flagged, so a grade never calls that "proven". */
async function scoreEval(
  template: Blueprint.Template,
  question: Blueprint.Question,
  evalCase: Blueprint.Eval,
  judge: Blueprint.Judge,
  signal: AbortSignal,
): Promise<{ readonly p: number; readonly hit: boolean; readonly node: string }> {
  const state = evalStateOf(template, evalCase);
  const answers = await judge.ask(state, { [template.id]: question }, signal);
  const answer = answers[template.id];
  const declared = "a" in state ? undefined : compareValueOf(template, state);
  const node = evalNodeOf(state);
  return {
    p: pOf(answer, declared),
    hit: templateFinding(template, answer, node, declared) !== undefined,
    node,
  };
}

/** The middle value, sorted ascending; `NaN` with nothing to average. */
export function median(values: readonly number[]): number {
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

/** The grade for one template's `bad`/`clean` scores plus its golden hits — `tools/jev/calibrate.mjs`'s
 * bar, copied, with one more veto (ADR 0052 decision 5, amended): fewer than 5 cases on either side
 * is `provisional`; enough cases, separation ≥ 0.30, ordering ≥ 0.90, and no golden hit is `proven`;
 * enough cases otherwise, or any golden hit at all, is `noisy` — a hit on the golden design outranks
 * a clean bar, because the seed cases are the template author's own and the golden design is not. */
function gradeFrom(
  id: string,
  bad: readonly number[],
  clean: readonly number[],
  goldenHits: readonly string[],
  goldenTotal: number,
): Blueprint.Grade {
  const enough = bad.length >= 5 && clean.length >= 5;
  const sep = median(bad) - median(clean);
  const ordered = orderedShare(bad, clean);
  const passesBar = sep >= 0.3 && ordered >= 0.9;
  const status =
    goldenHits.length > 0 ? "noisy" : !enough ? "provisional" : passesBar ? "proven" : "noisy";
  return { id, status, bad, clean, sep, ordered, goldenHits, goldenTotal };
}

/** Grade one template against its evals with the judge (ADR 0052 decision 5, amended): every
 * bad case should score high, every clean case low — `golden` (built from `evals/golden.yaml`,
 * a known-clean design) is folded into the clean pool for `sep`/`ordered`, and separately checked
 * for a hit. Pure over its inputs — no file read, no corpus lookup. */
export async function gradeTemplate(
  template: Blueprint.Template,
  evals: {
    readonly bad: readonly Blueprint.Eval[];
    readonly clean: readonly Blueprint.Eval[];
    readonly golden: readonly Blueprint.Eval[];
  },
  judge: Blueprint.Judge,
  signal: AbortSignal,
): Promise<Blueprint.Grade> {
  const question = templateQuestion(template);
  const bad: number[] = [];
  for (const evalCase of evals.bad)
    bad.push((await scoreEval(template, question, evalCase, judge, signal)).p);
  const clean: number[] = [];
  for (const evalCase of evals.clean)
    clean.push((await scoreEval(template, question, evalCase, judge, signal)).p);
  const goldenHits: string[] = [];
  for (const evalCase of evals.golden) {
    const scored = await scoreEval(template, question, evalCase, judge, signal);
    clean.push(scored.p);
    if (scored.hit) goldenHits.push(scored.node);
  }
  return gradeFrom(template.id, bad, clean, goldenHits, evals.golden.length);
}

/** Every golden case a template asks about: one per node whose kind is in `applies` (node
 * scope), or one per unordered pair of matching nodes (pair scope). `expect` is a placeholder —
 * grading never reads it; only `target` and `graph` feed {@link evalStateOf}. */
export function goldenCasesOf(
  template: Blueprint.Template,
  golden: Blueprint.Graph,
  file: string,
): readonly Blueprint.Eval[] {
  const matching = golden.nodes.filter((node) => template.applies.includes(node.kind));
  if (template.scope === "pair") {
    const pairs: Blueprint.Eval[] = [];
    for (let i = 0; i < matching.length; i++)
      for (let j = i + 1; j < matching.length; j++)
        pairs.push({
          file,
          target: [matching[i].name, matching[j].name],
          expect: false,
          graph: golden,
        });
    return pairs;
  }
  return matching.map((node) => ({
    file,
    target: [node.name],
    expect: template.kind === "choice" ? node.kind : false,
    graph: golden,
  }));
}
