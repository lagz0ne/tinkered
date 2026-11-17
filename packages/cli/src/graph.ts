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

/**
 * A unit a dep names: the Core function that made it, its label, and the part it reads. `bare`
 * is a dep named by itself, with no edge: a bare cell gives `run` its value, not a controller.
 */
type Unit = { made: string; label: string; read?: string; bare?: true };

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

const bareOf = (unit: Unit | undefined): Unit | undefined => unit && { ...unit, bare: true };

/**
 * The unit a dep's value names: an operation, an edge of a unit (a cell's `controller`, a tag's
 * `required`), or a part of a cell. `record` keeps only the calls each kind of unit has.
 */
function unitOf(checker: ts.TypeChecker, value: ts.Expression): Unit | undefined {
  if (ts.isIdentifier(value)) return bareOf(unitAt(checker, checker.getSymbolAtLocation(value)));
  if (ts.isCallExpression(value)) return partOf(checker, value);
  if (!ts.isPropertyAccessExpression(value)) return undefined;
  return unitAt(checker, checker.getSymbolAtLocation(value.expression));
}

/** The unit a dep's declaration names: `list: issues.controller`, or `{ inTeam }`. */
function depUnit(checker: ts.TypeChecker, declaration: ts.Declaration | undefined) {
  if (declaration && ts.isShorthandPropertyAssignment(declaration)) {
    return bareOf(unitAt(checker, checker.getShorthandAssignmentValueSymbol(declaration)));
  }
  return declaration && ts.isPropertyAssignment(declaration)
    ? unitOf(checker, declaration.initializer)
    : undefined;
}

/** A set of facts: where a call adds its fact, or where a use the graph cannot follow hides. */
type Hide = keyof Facts;

/** What one call on a dep adds: `list.set(…)` adds `issues.list.set` to `writes`. */
type Touch = { set: Hide; fact: string };

/**
 * A dep as `run` sees it: what each call the graph knows on it adds, and the sets a use the
 * graph cannot follow may hide facts in. `value` is the read a bare cell makes on each run.
 */
type Dep = { touches: Map<string, Touch>; hides: Hide[]; value?: string };

const allSets: Hide[] = ["reads", "writes", "calls"];

/** The mark of a fact the graph could not see: never a guess at the fact. */
const unseen = "?";

/** What each call the graph knows on a unit adds. A tag holds a value, not a fact. */
function touchesOf({ made, label, read }: Unit) {
  const touches = new Map<string, Touch>();
  const add = (kinds: string[], set: Hide, fact: (kind: string) => string) => {
    for (const kind of kinds) touches.set(kind, { set, fact: fact(kind) });
  };
  if (made === "operation") add(runKinds, "calls", () => label);
  if (made !== "data") return touches;

  if (read) add(["get"], "reads", () => `${label}.${read}`);
  else {
    add(readKinds, "reads", (kind) => `${label}.${kind}`);
    add(writeKinds, "writes", (kind) => `${label}.${kind}`);
  }
  return touches;
}

/**
 * The sets a dep the graph cannot name may hide facts in, by its type in `run`: `settle` runs an
 * operation, `set` writes a cell, `get` reads one.
 */
function hidesOf(type: ts.Type | undefined): Hide[] {
  if (type?.getProperty("settle")) return ["calls"];
  if (type?.getProperty("set")) return ["reads", "writes"];
  return type?.getProperty("get") ? ["reads"] : [];
}

/** The type a dep has in `run`: a controller, a reader, or a value. */
function slotOf(checker: ts.TypeChecker, param: ts.ParameterDeclaration | undefined, key: string) {
  const slot = param && checker.getTypeAtLocation(param).getProperty(key);
  return slot && checker.getTypeOfSymbolAtLocation(slot, slot.valueDeclaration ?? param);
}

/** A dep, from the declaration that names its unit, or else from its type in `run`. */
function depOf(checker: ts.TypeChecker, key: ts.Symbol, param?: ts.ParameterDeclaration): Dep {
  const unit = depUnit(checker, key.valueDeclaration);
  if (!unit) return { touches: new Map(), hides: hidesOf(slotOf(checker, param, key.name)) };
  if (unit.made === "data" && unit.bare) {
    return { touches: new Map(), hides: [], value: `${unit.label}.get` };
  }

  const touches = touchesOf(unit);
  const sets = [...touches.values()].map(({ set }) => set);
  return { touches, hides: allSets.filter((set) => sets.includes(set)) };
}

/**
 * Each dep of an operation by its key, from the type of its `depends`. A dep written in place,
 * in a `const`, or spread from one is a property of that type, and its declaration names its
 * unit. `param` is `run`'s first parameter: its type says what each dep is.
 */
function depsOf(
  checker: ts.TypeChecker,
  options: ts.ObjectLiteralExpression,
  param: ts.ParameterDeclaration | undefined,
) {
  const depends = checker.getTypeAtLocation(options).getProperty("depends");
  const keys = depends ? checker.getTypeOfSymbolAtLocation(depends, options).getProperties() : [];
  const deps = new Map<string, Dep>();
  for (const key of keys) deps.set(key.name, depOf(checker, key, param));
  return deps;
}

/** The method a call names on `node`: `list.set(…)` gives `set`. */
function calledOn(node: ts.Expression) {
  const { parent } = node;
  if (!ts.isPropertyAccessExpression(parent) || parent.expression !== node) return undefined;
  return ts.isCallExpression(parent.parent) && parent.parent.expression === parent
    ? parent.name.text
    : undefined;
}

/**
 * Reads the code of one `run`: every use of its deps, through the checker's symbols. A dep is
 * bound by the first parameter, or by `const { a, b: c } = deps` in the body. A use the graph
 * cannot follow (passed on, assigned, spread, a method it does not know) adds `?` to each set
 * the dep may hide facts in.
 */
class Reader {
  facts: Facts = { reads: new Set(), writes: new Set(), calls: new Set() };

  private checker: ts.TypeChecker;
  private deps: Map<string, Dep>;
  private bound = new Map<ts.Symbol, Dep>();
  private whole: ts.Symbol | undefined;

  constructor(checker: ts.TypeChecker, deps: Map<string, Dep>, param?: ts.ParameterDeclaration) {
    this.checker = checker;
    this.deps = deps;
    for (const { value } of deps.values()) if (value) this.facts.reads.add(value);
    if (param && ts.isIdentifier(param.name)) this.whole = checker.getSymbolAtLocation(param.name);
    else if (param) this.bind(param.name);
  }

  /** Every dep could hide facts: `run` handed them all on, or is not written in place. */
  hideAll() {
    for (const dep of this.deps.values()) this.hide(dep);
  }

  private hide({ hides }: Dep) {
    for (const set of hides) this.facts[set].add(unseen);
  }

  /** Bind each name a destructure of the deps gives. */
  private bind(name: ts.BindingName) {
    if (!ts.isObjectBindingPattern(name)) return this.hideAll();
    for (const element of name.elements) this.bindElement(element);
  }

  /** A rest takes every dep the graph cannot follow; a nested pattern takes its dep apart. */
  private bindElement({ dotDotDotToken, propertyName, name }: ts.BindingElement) {
    if (dotDotDotToken) return this.hideAll();
    const key = propertyName ?? name;
    const dep = ts.isIdentifier(key) ? this.deps.get(key.text) : undefined;
    if (!dep) return;

    const symbol = ts.isIdentifier(name) ? this.checker.getSymbolAtLocation(name) : undefined;
    if (symbol) this.bound.set(symbol, dep);
    else this.hide(dep);
  }

  private useDep(node: ts.Expression, dep: Dep | undefined) {
    if (!dep) return;
    const kind = calledOn(node);
    const touch = kind === undefined ? undefined : dep.touches.get(kind);
    if (touch) this.facts[touch.set].add(touch.fact);
    else this.hide(dep);
  }

  /** A use of the deps param: a member, a destructure, or a hand-off the graph cannot follow. */
  private useWhole(name: ts.Identifier) {
    const { parent } = name;
    if (ts.isPropertyAccessExpression(parent) && parent.expression === name) {
      return this.useDep(parent, this.deps.get(parent.name.text));
    }
    const destructure = ts.isVariableDeclaration(parent) && parent.initializer === name;
    if (destructure) return this.bind(parent.name);
    this.hideAll();
  }

  private use(name: ts.Identifier) {
    const { parent } = name;
    if (ts.isBindingElement(parent)) return;
    const symbol = ts.isShorthandPropertyAssignment(parent)
      ? this.checker.getShorthandAssignmentValueSymbol(parent)
      : this.checker.getSymbolAtLocation(name);

    if (!symbol) return;
    if (symbol === this.whole) return this.useWhole(name);
    this.useDep(name, this.bound.get(symbol));
  }

  /** Every use in the node's code, a callback's body too. */
  read(node: ts.Node) {
    const visit = (child: ts.Node) => {
      if (ts.isIdentifier(child)) this.use(child);
      ts.forEachChild(child, visit);
    };
    visit(node);
    return this.facts;
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
 * What one operation's `run` touches. A `run` written elsewhere may touch any of its deps: each
 * set a dep may hide facts in gets `?`.
 */
function factsOf(checker: ts.TypeChecker, { options, run }: Exits.Operation): Facts {
  const fn = functionOf(run);
  const [param] = fn?.parameters ?? [];
  const reader = new Reader(checker, depsOf(checker, options, param), param);
  if (fn?.body) return reader.read(fn.body);

  reader.hideAll();
  return reader.facts;
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
