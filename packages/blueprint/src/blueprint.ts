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
