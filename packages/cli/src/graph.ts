import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript-api";

import { coreImports, labelOf, readOperations } from "./exits";
import type { Exits } from "./exits";
import type { Tools } from "./tools";

export declare namespace Graph {
  /**
   * One line of the graph: an operation, where it is, and its facts. `parts` are `exits{…}`,
   * `reads{…}`, `writes{…}` and `calls{…}`, in that order. A fact is never a judgement: the
   * reader of the line judges it (ADR 0161, amended).
   */
  type Line = { path: string; line: number; label: string; exits: string[]; parts: string[] };
}

/** The app's committed graph, at its root (ADR 0161). */
export const graphFile = "tinker.graph";

/** A unit a dep names: the Core function that made it, its label, and the part it reads. */
type Unit = { made: string; label: string; read?: string };

/** What a `run` touches: each fact is a label, then a kind (`issues.list.set`). */
type Facts = { reads: Set<string>; writes: Set<string>; calls: Set<string> };

const writeKinds = ["set", "update", "delete"];

const readKinds = ["get", "of", "where"];

/** A dep that reads one part of a keyed cell: `issues.where({ teamId })`. */
const partKinds = ["of", "where"];

/** The call kinds that run an operation a dep names. */
const runKinds = ["run", "settle"];

/** The `const` a name stands for, through an import. */
function declarationOf(checker: ts.TypeChecker, symbol: ts.Symbol | undefined) {
  if (!symbol) return undefined;
  const own = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  const declaration = own.valueDeclaration;
  return declaration && ts.isVariableDeclaration(declaration) ? declaration : undefined;
}

/** The Core function a call names, by Core's own name for it: `data`, `operation`. */
function coreName({ expression }: ts.CallExpression) {
  const local = expression.getText();
  const item = coreImports(expression.getSourceFile()).find(({ name }) => name.text === local);
  return item && (item.propertyName ?? item.name).text;
}

/** The unit a name holds, when it is a `const` made by a Core call with a literal label. */
function unitAt(checker: ts.TypeChecker, symbol: ts.Symbol | undefined): Unit | undefined {
  const call = declarationOf(checker, symbol)?.initializer;
  if (!call || !ts.isCallExpression(call)) return undefined;

  const [options] = call.arguments;
  const label = options && ts.isObjectLiteralExpression(options) ? labelOf(options) : undefined;
  const made = coreName(call);
  return label && made ? { made, label } : undefined;
}

/** The unit a dep reads a part of: `issues.where({ teamId })`. */
function partOf(checker: ts.TypeChecker, value: ts.CallExpression) {
  if (!ts.isPropertyAccessExpression(value.expression)) return undefined;
  const read = value.expression.name.text;
  const unit = unitAt(checker, checker.getSymbolAtLocation(value.expression.expression));
  return unit && partKinds.includes(read) ? { ...unit, read } : undefined;
}

/**
 * The unit a dep's value names: an operation, an edge of a unit (a cell's `controller`, a tag's
 * `required`), or a part of a cell. `record` keeps only the calls each kind of unit has.
 */
function unitOf(checker: ts.TypeChecker, value: ts.Expression): Unit | undefined {
  if (ts.isIdentifier(value)) return unitAt(checker, checker.getSymbolAtLocation(value));
  if (ts.isCallExpression(value)) return partOf(checker, value);
  if (!ts.isPropertyAccessExpression(value)) return undefined;
  return unitAt(checker, checker.getSymbolAtLocation(value.expression));
}

/** The unit a dep's declaration names: `list: issues.controller`, or `{ inTeam }`. */
function depUnit(checker: ts.TypeChecker, declaration: ts.Declaration | undefined) {
  if (declaration && ts.isShorthandPropertyAssignment(declaration)) {
    return unitAt(checker, checker.getShorthandAssignmentValueSymbol(declaration));
  }
  return declaration && ts.isPropertyAssignment(declaration)
    ? unitOf(checker, declaration.initializer)
    : undefined;
}

/**
 * Each dep of an operation by its key, from the type of its `depends`. A dep written in place,
 * in a `const`, or spread from one is a property of that type, and its declaration names its
 * unit.
 */
function depsOf(checker: ts.TypeChecker, options: ts.ObjectLiteralExpression) {
  const depends = checker.getTypeAtLocation(options).getProperty("depends");
  const keys = depends ? checker.getTypeOfSymbolAtLocation(depends, options).getProperties() : [];
  const units = new Map<string, Unit>();
  for (const key of keys) {
    const unit = depUnit(checker, key.valueDeclaration);
    if (unit) units.set(key.name, unit);
  }
  return units;
}

/** Add what one call on a unit does: it runs an operation, or reads or writes a cell. */
function record({ made, label, read }: Unit, kind: string, facts: Facts) {
  if (made === "operation" && runKinds.includes(kind)) facts.calls.add(label);
  if (made !== "data") return;
  if (read) {
    if (kind === "get") facts.reads.add(`${label}.${read}`);
    return;
  }
  if (writeKinds.includes(kind)) facts.writes.add(`${label}.${kind}`);
  if (readKinds.includes(kind)) facts.reads.add(`${label}.${kind}`);
}

/**
 * Reads the code of one `run`. A receiver is a dep when the checker says the first parameter
 * binds it: `({ list }) => list.set(…)` or `deps.list.set(…)`.
 */
class Reader {
  private checker: ts.TypeChecker;
  private units: Map<string, Unit>;
  private deps: ts.ParameterDeclaration | undefined;

  constructor(
    checker: ts.TypeChecker,
    units: Map<string, Unit>,
    deps: ts.ParameterDeclaration | undefined,
  ) {
    this.checker = checker;
    this.units = units;
    this.deps = deps;
  }

  private boundKey(receiver: ts.Expression) {
    const bound = this.checker.getSymbolAtLocation(receiver)?.valueDeclaration;
    if (!bound || !ts.isBindingElement(bound) || bound.parent !== this.deps?.name) return undefined;
    const name = bound.propertyName ?? bound.name;
    return ts.isIdentifier(name) ? name.text : undefined;
  }

  private memberKey({ expression, name }: ts.PropertyAccessExpression) {
    const owner = this.checker.getSymbolAtLocation(expression)?.valueDeclaration;
    return owner === this.deps ? name.text : undefined;
  }

  private touch({ expression }: ts.CallExpression, facts: Facts) {
    if (!ts.isPropertyAccessExpression(expression)) return;
    const receiver = expression.expression;
    const key = ts.isPropertyAccessExpression(receiver)
      ? this.memberKey(receiver)
      : this.boundKey(receiver);
    const unit = key === undefined ? undefined : this.units.get(key);
    if (unit) record(unit, expression.name.text, facts);
  }

  /** Every touch in the node's code, a callback's body too. */
  scan(node: ts.Node) {
    const facts: Facts = { reads: new Set(), writes: new Set(), calls: new Set() };
    const visit = (child: ts.Node) => {
      if (ts.isCallExpression(child)) this.touch(child, facts);
      ts.forEachChild(child, visit);
    };
    visit(node);
    return facts;
  }
}

/** The function an operation's `run` is, when it is written in place. */
function functionOf(run: ts.ObjectLiteralElementLike) {
  if (ts.isMethodDeclaration(run)) return run;
  if (!ts.isPropertyAssignment(run)) return undefined;
  const value = run.initializer;
  return ts.isArrowFunction(value) || ts.isFunctionExpression(value) ? value : undefined;
}

/** What one operation's `run` touches. A `run` written elsewhere touches nothing the graph sees. */
function factsOf(checker: ts.TypeChecker, { options, run }: Exits.Operation): Facts {
  const fn = functionOf(run);
  const [deps] = fn?.parameters ?? [];
  return new Reader(checker, depsOf(checker, options), deps).scan(fn?.body ?? run);
}

const listed = (name: string, items: Iterable<string>) => `${name}{${[...items].sort().join(",")}}`;

/**
 * The app's graph, from its code: one line per operation, sorted by label in code-unit order,
 * the same on every machine. `exits` are the words of ADR 0159.
 */
export function graphOf(root: string): Graph.Line[] {
  const app = readOperations(root);
  if (!app) return [];

  const lines = app.operations.map((operation): Graph.Line => {
    const { reads, writes, calls } = factsOf(app.checker, operation);
    const { path, line, label, exits } = operation;
    const parts = [
      listed("exits", exits),
      listed("reads", reads),
      listed("writes", writes),
      listed("calls", calls),
    ];
    return { path, line, label, exits, parts };
  });
  return lines.sort((a, b) => (a.label < b.label ? -1 : 1));
}

/** The graph as `tinker.graph` holds it: one line per operation, and an end of line after each. */
export function graphText(lines: Graph.Line[]) {
  return lines.map(({ label, parts }) => `${[label, ...parts].join(" ")}\n`).join("");
}

/**
 * Each line of the committed file by its label, and its line number. A line may end in `\r`: a
 * checkout on Windows can give the file those ends.
 */
function linesIn(text: string) {
  const lines = new Map<string, { line: number; parts: string[] }>();
  text.split("\n").forEach((row, index) => {
    const [label, ...parts] = row.trim().split(" ");
    if (label) lines.set(label, { line: index + 1, parts });
  });
  return lines;
}

/** What a code line says that the file's line does not: each part that differs. */
function changed(code: string[], file: string[]) {
  return code.flatMap((part, index) => {
    const said = file[index] ?? "nothing";
    return part === said ? [] : [`${part}, ${graphFile} says ${said}`];
  });
}

/**
 * A `tinker/graph` finding for each line where `code`, the graph `graphOf` read, and
 * `tinker.graph` differ (ADR 0161). A code line points at its operation; a line only the file
 * has points at the file. An app with no operation needs no file.
 */
export function graphFindings(root: string, code: Graph.Line[]): Tools.Found[] {
  const path = join(root, graphFile);
  const rule = "tinker/graph";
  if (!existsSync(path)) {
    const what = `there is no ${graphFile}: run \`tinker graph --write\` and commit it`;
    return code.length ? [{ path: graphFile, line: 1, rule, what }] : [];
  }

  const file = linesIn(readFileSync(path, "utf8"));
  const found = code.flatMap(({ path, line, label, parts }): Tools.Found[] => {
    const said = file.get(label);
    file.delete(label);
    const diff = said ? changed(parts, said.parts) : [`not in ${graphFile}`];
    return diff.length ? [{ path, line, rule, what: `${label}: ${diff.join("; ")}` }] : [];
  });
  const gone = [...file].map(([label, { line }]) => ({
    path: graphFile,
    line,
    rule,
    what: `${label}: in ${graphFile}, not in the code`,
  }));
  return [...found, ...gone];
}
