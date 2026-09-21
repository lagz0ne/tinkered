import * as yaml from "yaml";
import { z } from "zod";
import { isError, raise } from "./errors.ts";

export { isError };
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
  /** One loaded template. */
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
  /** One plain-check result. `blocking` is always true in t01. */
  export type Finding = {
    readonly check: "unknownDepends" | "duplicateName" | "dataNoWriter";
    readonly node: string;
    readonly detail: string;
    readonly blocking: true;
  };
  /** What `check` answers: how many nodes it read and every finding. */
  export type Report = {
    readonly nodes: number;
    readonly findings: readonly Finding[];
  };
}

type Parsed = z.infer<typeof file>;

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

const file = z.array(z.union([dataEntry, tagEntry, operationEntry, resourceEntry]));

/** Read one parsed entry into a node: the kind is the key, the rest is the value. */
function readNode(entry: Parsed[number]): Blueprint.Node {
  if ("data" in entry) return { kind: "data", ...entry.data };
  if ("tag" in entry) return { kind: "tag", ...entry.tag };
  if ("operation" in entry) return { kind: "operation", ...entry.operation };
  return { kind: "resource", ...entry.resource };
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
  const result = file.safeParse(parsed);
  if (!result.success) raise("InvalidBlueprint", { text, issues: result.error.issues });
  const nodes = result.data.map(readNode);
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

/** One finding line: what `check` prints, one per line. */
export function findingLine(finding: Blueprint.Finding): string {
  return `${finding.check}  ${finding.node}  ${finding.detail}`;
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

/** Every field a template may read: the node's own fields plus the edge readers. */
const stateFields: readonly string[] = [
  "kind",
  "name",
  "promise",
  "why",
  "depends",
  "work",
  "target",
  "uses",
  "usedBy",
];

/** Every kind a template may apply to. */
const nodeKinds: readonly string[] = ["data", "resource", "operation", "tag"];

const booleanTemplate = z.strictObject({
  id: z.string().min(1),
  scope: z.enum(["node", "pair"]).default("node"),
  applies: z.array(z.string()).min(1),
  needs: z.array(z.string()).default([]),
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
  applies: z.array(z.string()).min(1),
  needs: z.array(z.string()).default([]),
  status: z.enum(["provisional", "proven"]),
  ask: z.string().min(1),
  kind: z.literal("choice"),
  choices: z.record(z.string(), z.string().min(1)),
  minConfidence: z.number().default(0.6),
});

const templateFile = z.union([booleanTemplate, choiceTemplate]);

type TemplateFile = z.infer<typeof templateFile>;

/** Name every unknown `applies` entry and every `needs` entry outside the list. */
function templateIssues(parsed: TemplateFile): readonly unknown[] {
  const badApplies = parsed.applies.filter((kind) => !nodeKinds.includes(kind));
  const badNeeds = parsed.needs.filter((field) => !stateFields.includes(field));
  const issues: unknown[] = [];
  for (const kind of badApplies) issues.push(`applies: unknown kind "${kind}"`);
  for (const field of badNeeds) issues.push(`needs: unknown field "${field}"`);
  return issues;
}

/** Read one parsed template file into a template: `scope` defaults to `node`,
 * `threshold` to 0.5, `minConfidence` to 0.6. An unknown `applies` or `needs`
 * entry throws `InvalidTemplate` and names the entry. */
function readParsed(parsed: TemplateFile): Blueprint.Template {
  const issues = templateIssues(parsed);
  if (issues.length > 0) raise("InvalidTemplate", { file: parsed.id, issues });
  if (parsed.kind === "boolean")
    return {
      id: parsed.id,
      scope: parsed.scope,
      applies: parsed.applies as readonly Blueprint.Node["kind"][],
      needs: parsed.needs as readonly Blueprint.StateField[],
      status: parsed.status,
      ask: parsed.ask,
      kind: "boolean",
      true: parsed.true,
      false: parsed.false,
      threshold: parsed.threshold,
    };
  return {
    id: parsed.id,
    scope: parsed.scope,
    applies: parsed.applies as readonly Blueprint.Node["kind"][],
    needs: parsed.needs as readonly Blueprint.StateField[],
    status: parsed.status,
    ask: parsed.ask,
    kind: "choice",
    choices: parsed.choices,
    minConfidence: parsed.minConfidence,
  };
}

/** Read one template file (yaml text) into a template. A yaml or schema failure
 * throws `InvalidTemplate` with the file name and the issues. */
export function readTemplate(text: string, file: string): Blueprint.Template {
  let parsed: unknown;
  try {
    parsed = yaml.parse(text);
  } catch (error: unknown) {
    raise("InvalidTemplate", { file, issues: [error] });
  }
  const result = templateFile.safeParse(parsed);
  if (!result.success) raise("InvalidTemplate", { file, issues: result.error.issues });
  try {
    return readParsed(result.data);
  } catch (error: unknown) {
    if (isError(error, "InvalidTemplate"))
      raise("InvalidTemplate", { file, issues: error.payload.issues });
    throw error;
  }
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
