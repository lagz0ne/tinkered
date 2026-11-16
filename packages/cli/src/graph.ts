import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript-api";

import { coreImports, exitsOf, labelOf, member, readOperations } from "./exits";
import type { Exits } from "./exits";
import type { Tools } from "./tools";

export declare namespace Graph {
  /**
   * One line of the graph: an operation's exit and what the path to it touches. `parts` are
   * `reads{…}`, `writes{…}` and `calls{…}`, in that order.
   */
  type Line = Exits.Exit & { parts: string[] };
}

/** The app's committed graph, at its root (ADR 0161). */
export const graphFile = "tinker.graph";

/** A unit a dep names: the Core function that made it, its label, and the part it reads. */
type Unit = { made: string; label: string; read?: string };

/** What the path to one exit touches: each fact is a label, then a kind (`issues.list.set`). */
type Facts = { reads: Set<string>; writes: Set<string>; calls: Set<string> };

const writeKinds = ["set", "update", "delete"];

const readKinds = ["get", "of", "where"];

/** A dep that reads one part of a keyed cell: `issues.where({ teamId })`. */
const partKinds = ["of", "where"];

/** The call kinds that run an operation a dep names. */
const runKinds = ["run", "settle"];

const noFacts = (): Facts => ({ reads: new Set(), writes: new Set(), calls: new Set() });

function copyOf({ reads, writes, calls }: Facts): Facts {
  return { reads: new Set(reads), writes: new Set(writes), calls: new Set(calls) };
}

/** The `const` a name stands for, through an import. */
function declarationOf(checker: ts.TypeChecker, symbol: ts.Symbol | undefined) {
  if (!symbol) return undefined;
  const own = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  const declaration = own.valueDeclaration;
  return declaration && ts.isVariableDeclaration(declaration) ? declaration : undefined;
}

/** The Core function a call names, by Core's own name for it: `data`, `operation`. */
function coreName({ expression }: ts.CallExpression) {
  if (!ts.isIdentifier(expression)) return undefined;
  const local = expression.text;
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

/** The unit a dep's value names: an operation, a cell's `controller`, or a part of a cell. */
function unitOf(checker: ts.TypeChecker, value: ts.Expression): Unit | undefined {
  if (ts.isIdentifier(value)) return unitAt(checker, checker.getSymbolAtLocation(value));
  if (ts.isCallExpression(value)) return partOf(checker, value);
  if (!ts.isPropertyAccessExpression(value) || value.name.text !== "controller") return undefined;
  return unitAt(checker, checker.getSymbolAtLocation(value.expression));
}

/** One dep's key and the unit it names, when it names one. */
function depOf(checker: ts.TypeChecker, property: ts.ObjectLiteralElementLike) {
  const unit = ts.isShorthandPropertyAssignment(property)
    ? unitAt(checker, checker.getShorthandAssignmentValueSymbol(property))
    : ts.isPropertyAssignment(property) && unitOf(checker, property.initializer);
  const key = property.name && ts.isIdentifier(property.name) ? property.name.text : undefined;
  return unit && key ? [{ key, unit }] : [];
}

/** Each dep of an operation by its key, when the dep is a unit the graph names. */
function depsOf(checker: ts.TypeChecker, options: ts.ObjectLiteralExpression) {
  const depends = member(options, "depends");
  const value = depends && ts.isPropertyAssignment(depends) ? depends.initializer : undefined;
  const properties = value && ts.isObjectLiteralExpression(value) ? value.properties : [];
  return new Map(
    properties.flatMap((property) => depOf(checker, property)).map(({ key, unit }) => [key, unit]),
  );
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

/** Each `return` of a function's own body: one in a nested function returns from that one. */
function returnsIn(body: ts.Block) {
  const found: ts.ReturnStatement[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isReturnStatement(node)) found.push(node);
    if (!ts.isFunctionLike(node)) ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
  return found;
}

/**
 * The code that runs on the way to `child` inside `parent`: an `if` runs its condition, a
 * `case` runs no other clause, and every other node runs what comes before the child.
 */
function before(parent: ts.Node, child: ts.Node): ts.Node[] {
  if (ts.isIfStatement(parent)) return [parent.expression];
  if (ts.isCaseBlock(parent)) return [];
  const nodes: ts.Node[] = [];
  ts.forEachChild(parent, (node) => {
    if (node.end <= child.pos) nodes.push(node);
  });
  return nodes;
}

/** A body whose end runs: its last statement neither returns nor throws. */
function endRuns({ statements }: ts.Block) {
  const last = statements.at(-1);
  return !last || !(ts.isReturnStatement(last) || ts.isThrowStatement(last));
}

/**
 * Reads the code of one `run`, and gathers the facts of each exit. A receiver is a dep when the
 * checker says the first parameter binds it: `({ list }) => list.set(…)` or `deps.list.set(…)`.
 */
class Reader {
  /** The facts of each exit, by its name. */
  found = new Map<string, Facts>();

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
    return this.deps && owner === this.deps ? name.text : undefined;
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

  /** Every touch in the node's code, a callback's body too: it may run before the return. */
  scan(node: ts.Node, facts: Facts) {
    const visit = (child: ts.Node) => {
      if (ts.isCallExpression(child)) this.touch(child, facts);
      ts.forEachChild(child, visit);
    };
    visit(node);
    return facts;
  }

  add(exit: string, { reads, writes, calls }: Facts) {
    const facts = this.found.get(exit) ?? noFacts();
    for (const read of reads) facts.reads.add(read);
    for (const write of writes) facts.writes.add(write);
    for (const call of calls) facts.calls.add(call);
    this.found.set(exit, facts);
  }

  /**
   * Add a returned value to the exits its type gives. `a ? b : c` is two paths: the condition
   * runs on both, each branch on its own.
   */
  returned(value: ts.Expression, path: Facts) {
    let bare = value;
    while (ts.isParenthesizedExpression(bare)) bare = bare.expression;
    if (ts.isConditionalExpression(bare)) {
      this.scan(bare.condition, path);
      this.returned(bare.whenTrue, copyOf(path));
      this.returned(bare.whenFalse, copyOf(path));
      return;
    }

    this.scan(bare, path);
    for (const exit of exitsOf(this.checker, this.checker.getTypeAtLocation(bare))) {
      this.add(exit, path);
    }
  }

  /** The facts of the path from the top of `body` to `node`. */
  private pathTo(body: ts.Block, node: ts.Node) {
    const facts = noFacts();
    for (let child = node; child !== body; child = child.parent) {
      for (const ran of before(child.parent, child)) this.scan(ran, facts);
    }
    return facts;
  }

  /** Each return of a block body; a body whose end runs gives a plain return of all its code. */
  block(body: ts.Block, exits: string[]) {
    for (const statement of returnsIn(body)) {
      const path = this.pathTo(body, statement);
      if (statement.expression) this.returned(statement.expression, path);
      else this.add("value", path);
    }

    if (endRuns(body) && exits.includes("value")) this.add("value", this.scan(body, noFacts()));
  }
}

/** The function an operation's `run` is, when it is written in place. */
function functionOf(run: ts.ObjectLiteralElementLike) {
  if (ts.isMethodDeclaration(run)) return run;
  if (!ts.isPropertyAssignment(run)) return undefined;
  const value = run.initializer;
  return ts.isArrowFunction(value) || ts.isFunctionExpression(value) ? value : undefined;
}

/**
 * The facts of each exit of one operation. A return adds its path to the exits its type gives.
 * A `run` written elsewhere gives none.
 */
function factsOf(checker: ts.TypeChecker, { options, run, exits }: Exits.Operation) {
  const fn = functionOf(run);
  const body = fn?.body;
  if (!fn || !body) return new Map<string, Facts>();

  const [deps] = fn.parameters;
  const reader = new Reader(checker, depsOf(checker, options), deps);
  if (ts.isBlock(body)) reader.block(body, exits);
  else reader.returned(body, noFacts());
  return reader.found;
}

const keyOf = ({ label, exit }: Pick<Exits.Exit, "label" | "exit">) => `${label} ${exit}`;

/** Code-unit order: the file's order is the same on every machine. */
const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const listed = (name: string, items: Set<string>) => `${name}{${[...items].sort().join(",")}}`;

/**
 * The app's graph, from its code: one line per operation and exit its type declares (ADR 0159),
 * sorted by label, then exit.
 */
export function graphOf(root: string): Graph.Line[] {
  const app = readOperations(root);
  if (!app) return [];

  const lines = app.operations.flatMap((operation) => {
    const found = factsOf(app.checker, operation);
    return operation.exits.map((exit): Graph.Line => {
      const { reads, writes, calls } = found.get(exit) ?? noFacts();
      const { path, line, label } = operation;
      const parts = [listed("reads", reads), listed("writes", writes), listed("calls", calls)];
      return { path, line, label, exit, parts };
    });
  });
  return lines.sort((a, b) => order(keyOf(a), keyOf(b)));
}

/** The graph as `tinker.graph` holds it: one line per exit, and an end of line after each. */
export function graphText(lines: Graph.Line[]) {
  return lines.map((line) => `${[keyOf(line), ...line.parts].join(" ")}\n`).join("");
}

/** Each line of the committed file by its key, and its line number. */
function linesIn(text: string) {
  const lines = new Map<string, { line: number; parts: string[] }>();
  text.split("\n").forEach((row, index) => {
    const [label, exit, ...parts] = row.trim().split(/\s+/);
    if (label && exit) lines.set(`${label} ${exit}`, { line: index + 1, parts });
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
 * has points at the file. An app with no exit needs no file.
 */
export function graphFindings(root: string, code: Graph.Line[]): Tools.Found[] {
  const path = join(root, graphFile);
  const rule = "tinker/graph";
  if (!existsSync(path)) {
    const what = `there is no ${graphFile}: run \`tinker graph --write\` and commit it`;
    return code.length ? [{ path: graphFile, line: 1, rule, what }] : [];
  }

  const file = linesIn(readFileSync(path, "utf8"));
  const found = code.flatMap(({ path, line, parts, ...exit }): Tools.Found[] => {
    const key = keyOf(exit);
    const said = file.get(key);
    file.delete(key);
    const diff = said ? changed(parts, said.parts) : [`not in ${graphFile}`];
    return diff.length ? [{ path, line, rule, what: `${key}: ${diff.join("; ")}` }] : [];
  });
  const gone = [...file].map(([key, { line }]) => ({
    path: graphFile,
    line,
    rule,
    what: `${key}: in ${graphFile}, not in the code`,
  }));
  return [...found, ...gone];
}
