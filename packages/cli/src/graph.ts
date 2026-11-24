import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript-api";

import { coreImports, importsOf, labelOf, readOperations } from "./exits";
import type { Exits } from "./exits";
import type { Tools } from "./tools";

export declare namespace Graph {
  /**
   * One line of the graph file, where it is in the code: its name, then its parts. A view's
   * name is two words: `view src/home.tsx#SignIn`.
   */
  type Row = { path: string; line: number; label: string; parts: string[] };
  /**
   * One line of the graph: an operation, where it is, and its facts. `parts` are `exits{…}`,
   * `reads{…}`, `writes{…}`, `calls{…}` and `uses{…}`, in that order. A fact is never a
   * judgement: the reader of the line judges it (ADR 0161, amended). `writes`, `calls` and
   * `uses` are those facts, sorted, for the graph rules (ADR 0167, amended).
   */
  type Line = Row & {
    exits: string[];
    writes: string[];
    calls: string[];
    uses: string[];
  };
  /**
   * The app's graph: a line per operation, then a line per view. A view line's `parts` are
   * `reads{…}` and `runs{…}`. No graph rule reads a view line.
   */
  type Of = { ops: Line[]; views: Row[] };
}

/** The app's committed graph, at its root (ADR 0161). */
export const graphFile = "tinker.graph";

/**
 * A unit a dep names: the Core function that made it, its label, and the part it reads. `bare`
 * is a dep named by itself, with no edge: a bare cell gives `run` its value, not a controller.
 */
type Unit = { made: string; label: string; call: ts.CallExpression; read?: string; bare?: true };

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

/** The call a name holds, when it is a `const` made by a call. */
function callAt(checker: ts.TypeChecker, symbol: ts.Symbol | undefined) {
  const call = declarationOf(checker, symbol)?.initializer;
  return call && ts.isCallExpression(call) ? call : undefined;
}

/** The label an options argument writes, when it is an object literal. */
function labelIn(options: ts.Expression | undefined) {
  return options && ts.isObjectLiteralExpression(options) ? labelOf(options) : undefined;
}

/** The unit a name holds, when it is a `const` made by a Core call with a literal label. */
function unitAt(checker: ts.TypeChecker, symbol: ts.Symbol | undefined): Unit | undefined {
  const call = callAt(checker, symbol);
  if (!call) return undefined;

  const [options] = call.arguments;
  const label = labelIn(options);
  const made = coreName(call);
  return label && made ? { made, label, call } : undefined;
}

/** What a tag holds: the `T` of the `Tag.Handle<T>` its call makes, which `def` carries. */
function heldOf(checker: ts.TypeChecker, call: ts.CallExpression) {
  const def = checker.getTypeAtLocation(call).getProperty("def");
  return def && checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(def, call));
}

/** The unit a dep reads a part of: `issues.where({ teamId })`. */
function partOf(checker: ts.TypeChecker, value: ts.CallExpression) {
  if (!ts.isPropertyAccessExpression(value.expression)) return undefined;
  const read = value.expression.name.text;
  const unit = unitAt(checker, checker.getSymbolAtLocation(value.expression.expression));
  return unit && partKinds.includes(read) ? { ...unit, read } : undefined;
}

const bareOf = (unit: Unit | undefined): Unit | undefined => unit && { ...unit, bare: true };

/** A member read by a key written in the code: `user.list` or `user["users.me"]`. */
function memberOf(value: ts.Expression) {
  if (ts.isPropertyAccessExpression(value)) return { on: value.expression, key: value.name.text };
  if (!ts.isElementAccessExpression(value)) return undefined;
  const key = value.argumentExpression;
  return ts.isStringLiteralLike(key) ? { on: value.expression, key: key.text } : undefined;
}

/** The property of an object literal under this key: a name or a string. */
function propertyAt(object: ts.Expression | undefined, key: string) {
  if (!object || !ts.isObjectLiteralExpression(object)) return undefined;
  return object.properties.find(({ name }) => name && keyText(name) === key);
}

/** The call a capsule's export is: a `const` it names, or a call written in place. */
function exportCall(checker: ts.TypeChecker, exported: ts.ObjectLiteralElementLike | undefined) {
  if (exported && ts.isShorthandPropertyAssignment(exported)) {
    return callAt(checker, checker.getShorthandAssignmentValueSymbol(exported));
  }
  if (!exported || !ts.isPropertyAssignment(exported)) return undefined;
  const value = exported.initializer;
  if (ts.isCallExpression(value)) return value;
  return ts.isIdentifier(value) ? callAt(checker, checker.getSymbolAtLocation(value)) : undefined;
}

/** A capsule's export under `key`: the call it is, and the capsule's label when it is written. */
function exportOf(checker: ts.TypeChecker, on: ts.Identifier, key: string) {
  const capsule = callAt(checker, checker.getSymbolAtLocation(on));
  if (!capsule || coreName(capsule) !== "capsule") return undefined;

  const [options] = capsule.arguments;
  const exports = propertyAt(options, "exports");
  const value = exports && ts.isPropertyAssignment(exports) ? exports.initializer : undefined;
  const call = exportCall(checker, propertyAt(value, key));
  return call && { call, capsule: labelIn(options) };
}

/**
 * A capsule's export: its members take the capsule's label and the export's key. Both are
 * read from the capsule's call: its `label` written as a string, its `exports` as an object.
 */
function exportedContract(checker: ts.TypeChecker, on: ts.Identifier, key: string) {
  const found = exportOf(checker, on, key);
  return found?.capsule ? { call: found.call, name: `${found.capsule}.${key}` } : undefined;
}

/**
 * An rpc contract a capsule exports, and the name its members take: `access.user`. A bare
 * `rpc` const has no name to read: one handle could have two.
 */
function contractOf(checker: ts.TypeChecker, value: ts.Expression) {
  const member = memberOf(value);
  return member && ts.isIdentifier(member.on)
    ? exportedContract(checker, member.on, member.key)
    : undefined;
}

/**
 * The operation an rpc contract's member is: `access.user["users.me"]` is `access.user/users.me`,
 * the capsule path, `/`, then the contract key. A key the contract does not write is not one.
 */
function contractMember(checker: ts.TypeChecker, value: ts.Expression): Unit | undefined {
  const member = memberOf(value);
  const contract = member && contractOf(checker, member.on);
  if (!contract || coreName(contract.call) !== "rpc") return undefined;

  const [contracts] = contract.call.arguments;
  if (!propertyAt(contracts, member.key)) return undefined;
  return { made: "operation", label: `${contract.name}/${member.key}`, call: contract.call };
}

/** Where an edge puts its reads and writes: `logins.atScope.controller` is the cell's own. */
const placements = ["atScope", "atNamespace"];

/** The unit an edge is on: a `const`, a cell through its placement, or an rpc contract's member. */
function edgeOf(checker: ts.TypeChecker, on: ts.Expression) {
  const placed = ts.isPropertyAccessExpression(on) && placements.includes(on.name.text);
  const unit = placed ? on.expression : on;
  if (ts.isIdentifier(unit)) return unitAt(checker, checker.getSymbolAtLocation(unit));
  return contractMember(checker, on);
}

/**
 * The unit a dep's value names: an operation, an rpc contract's member, an edge of a unit (a
 * cell's `controller`, a tag's `required`), or a part of a cell. `record` keeps only the calls
 * each kind of unit has.
 */
function unitOf(checker: ts.TypeChecker, value: ts.Expression): Unit | undefined {
  if (ts.isIdentifier(value)) return bareOf(unitAt(checker, checker.getSymbolAtLocation(value)));
  if (ts.isCallExpression(value)) return partOf(checker, value);
  const member = contractMember(checker, value);
  if (member || !ts.isPropertyAccessExpression(value)) return member;
  return edgeOf(checker, value.expression);
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

/**
 * The call a resource dep's value is made by: a `const` it names, the keyed resource a call reads
 * (`row({ id })`), or a capsule's export (`db.pool`).
 */
function resourceCall(checker: ts.TypeChecker, value: ts.Expression) {
  const unit = ts.isCallExpression(value) ? value.expression : value;
  if (ts.isIdentifier(unit)) return callAt(checker, checker.getSymbolAtLocation(unit));
  const member = memberOf(unit);
  return member && ts.isIdentifier(member.on)
    ? exportOf(checker, member.on, member.key)?.call
    : undefined;
}

/** The label of the resource a dep's declaration names, when the label is written. */
function resourceLabel(checker: ts.TypeChecker, declaration: ts.Declaration | undefined) {
  let call: ts.CallExpression | undefined;
  if (declaration && ts.isShorthandPropertyAssignment(declaration)) {
    call = callAt(checker, checker.getShorthandAssignmentValueSymbol(declaration));
  } else if (declaration && ts.isPropertyAssignment(declaration)) {
    call = resourceCall(checker, declaration.initializer);
  }
  if (!call || coreName(call) !== "resource") return undefined;
  const [options] = call.arguments;
  return labelIn(options);
}

/** A keyed resource read: what a keyed resource's call makes (ADR 0150). */
function isBuilt(checker: ts.TypeChecker, type: ts.Type) {
  const kind = type.getProperty("kind");
  const value = kind && checker.getTypeOfSymbol(kind);
  return value?.isStringLiteral() === true && value.value === "built";
}

/** The keys a resource handle has, beside its label (`Resource.Handle`). */
const handleKeys = ["factory", "target", "depends"];

/** A resource, by its type: a handle has all its keys; a keyed one is a read, or makes one. */
function isResource(checker: ts.TypeChecker, type: ts.Type | undefined) {
  if (!type) return false;
  if (handleKeys.every((key) => type.getProperty(key)) || isBuilt(checker, type)) return true;
  return type.getCallSignatures().some((call) => isBuilt(checker, call.getReturnType()));
}

/** A dep on a cell, an operation, or a whole capsule: no resource, whatever keys its type has. */
function isOtherUnit(unit: Unit | undefined) {
  if (unit?.made === "capsule") return unit.bare === true;
  return unit?.made === "data" || unit?.made === "operation";
}

/** Each dep an operation's `depends` names, by key: written in place, in a `const`, or spread. */
function dependsOf(checker: ts.TypeChecker, options: ts.ObjectLiteralExpression) {
  const depends = checker.getTypeAtLocation(options).getProperty("depends");
  return depends ? checker.getTypeOfSymbolAtLocation(depends, options).getProperties() : [];
}

/**
 * What one dep adds to `uses{}`: the label of the resource it names, or `?` for a resource the
 * graph cannot name (by its type, or by what its tag holds). A cell, an operation, a whole
 * capsule, or any other dep adds nothing.
 */
function useOf(checker: ts.TypeChecker, key: ts.Symbol, options: ts.ObjectLiteralExpression) {
  const label = resourceLabel(checker, key.valueDeclaration);
  if (label) return [label];

  const unit = depUnit(checker, key.valueDeclaration);
  if (isOtherUnit(unit)) return [];
  const type =
    unit?.made === "tag"
      ? heldOf(checker, unit.call)
      : checker.getTypeOfSymbolAtLocation(key, options);
  return isResource(checker, type) ? [unseen] : [];
}

/** The resources an operation's `depends` names: a fact from `depends` alone, not from `run`. */
function usesOf(checker: ts.TypeChecker, { options }: Exits.Operation) {
  return new Set(dependsOf(checker, options).flatMap((key) => useOf(checker, key, options)));
}

/** A set of facts: where a call adds its fact, or where a use the graph cannot follow hides. */
type Hide = keyof Facts;

/** What one call on a dep adds: `list.set(…)` adds `issues.list.set` to `writes`. */
type Touch = { set: Hide; fact: string };

/**
 * A dep as `run` sees it: what each call the graph knows on it adds, and the sets a use the
 * graph cannot follow may hide facts in. `named` is false for a dep whose unit the graph cannot
 * name: it may hold anything. `value` is the read a bare cell makes on each run.
 */
type Dep = { touches: Map<string, Touch>; hides: Hide[]; named: boolean; value?: string };

const allSets: Hide[] = ["reads", "writes", "calls"];

/** The mark of a fact the graph could not see: never a guess at the fact. */
export const unseen = "?";

/** What each call the graph knows on an operation or a cell adds. */
function touchesOf({ made, label, read }: Unit) {
  const touches = new Map<string, Touch>();
  const add = (kinds: string[], set: Hide, fact: (kind: string) => string) => {
    for (const kind of kinds) touches.set(kind, { set, fact: fact(kind) });
  };
  if (made === "operation") add(runKinds, "calls", () => label);
  else if (read) add(["get"], "reads", () => `${label}.${read}`);
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

/**
 * The sets a tag may hide facts in, by what it holds (ADR 0151), through any edge: a cell may be
 * read and written, an operation run, a view or a read read. A plain value or a resource holds
 * no fact the graph reads: a resource's own code is not read.
 */
function heldHides(held: ts.Type | undefined): Hide[] {
  if (held?.getProperty("mode")) return ["reads", "writes"];
  if (held?.getProperty("run")) return ["calls"];
  return held?.getProperty("kind") ? ["reads"] : [];
}

/** A dep whose unit the graph cannot name: it hides in `hides`. */
const unnamed = (hides: Hide[]): Dep => ({ touches: new Map(), hides, named: false });

/** A dep on an operation or a cell: a bare cell gives `run` its value, read on each run. */
function namedDep(unit: Unit): Dep {
  if (unit.bare && unit.made === "data") {
    return { touches: new Map(), hides: [], named: true, value: `${unit.label}.get` };
  }

  const touches = touchesOf(unit);
  const sets = [...touches.values()].map(({ set }) => set);
  return { touches, hides: allSets.filter((set) => sets.includes(set)), named: true };
}

/**
 * A dep, from the declaration that names its unit. A tag hides by what it holds, through any
 * edge. Any other dep but an operation or a cell is read by its type in `run`: a dep the graph
 * cannot name may be anything.
 */
function depOf(checker: ts.TypeChecker, key: ts.Symbol, param?: ts.ParameterDeclaration): Dep {
  const unit = depUnit(checker, key.valueDeclaration);
  if (unit?.made === "tag") return unnamed(heldHides(heldOf(checker, unit.call)));
  const named = unit?.made === "operation" || unit?.made === "data";
  return named ? namedDep(unit) : unnamed(hidesOf(slotOf(checker, param, key.name)));
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
  const deps = new Map<string, Dep>();
  for (const key of dependsOf(checker, options)) deps.set(key.name, depOf(checker, key, param));
  return deps;
}

/** A binding's key as text: a name or a string. Any other key the graph cannot read. */
function keyText(key: ts.PropertyName | ts.BindingName) {
  return ts.isIdentifier(key) || ts.isStringLiteral(key) ? key.text : undefined;
}

/** `name` is the value a `const { … } = name` takes apart. */
function destructured(
  name: ts.Identifier,
): name is ts.Identifier & { parent: ts.VariableDeclaration } {
  const { parent } = name;
  return ts.isVariableDeclaration(parent) && parent.initializer === name;
}

/** Call `see` on every name in the node's code, a callback's body too. */
function eachName(node: ts.Node, see: (name: ts.Identifier) => void) {
  const visit = (child: ts.Node) => {
    if (ts.isIdentifier(child)) see(child);
    ts.forEachChild(child, visit);
  };
  visit(node);
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

  /** Every dep could hide facts: `run` handed them all on. */
  private hideAll() {
    for (const dep of this.deps.values()) this.hide(dep);
  }

  /**
   * A `run` passed by name: no code to read. A dep the graph names hides by its unit; one it
   * cannot name may hide anything, so every set gets `?`.
   */
  hideRun() {
    this.hideAll();
    if (![...this.deps.values()].every(({ named }) => named)) {
      for (const set of allSets) this.facts[set].add(unseen);
    }
    return this.facts;
  }

  private hide({ hides }: Dep) {
    for (const set of hides) this.facts[set].add(unseen);
  }

  /** Bind each name a destructure of the deps gives. */
  private bind(name: ts.BindingName) {
    if (!ts.isObjectBindingPattern(name)) return this.hideAll();
    for (const element of name.elements) this.bindElement(element);
  }

  /**
   * A rest takes every dep, and the graph cannot read a computed key: both hide every dep. A
   * nested pattern takes its dep apart.
   */
  private bindElement({ dotDotDotToken, propertyName, name }: ts.BindingElement) {
    const key = keyText(propertyName ?? name);
    if (dotDotDotToken || key === undefined) return this.hideAll();
    const dep = this.deps.get(key);
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

  /** A use of the deps param: a member, a destructure (bound first), or a hand-off. */
  private useWhole(name: ts.Identifier) {
    const { parent } = name;
    if (ts.isPropertyAccessExpression(parent) && parent.expression === name) {
      return this.useDep(parent, this.deps.get(parent.name.text));
    }
    if (!destructured(name)) this.hideAll();
  }

  private isWhole(name: ts.Identifier) {
    const symbol = this.checker.getSymbolAtLocation(name);
    return symbol !== undefined && symbol === this.whole;
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

  /**
   * Every use in the node's code, a callback's body too. Each destructure of the deps binds
   * first, so a use the code reads before it (in a callback) still counts.
   */
  read(node: ts.Node) {
    eachName(node, (name) => {
      if (destructured(name) && this.isWhole(name)) this.bind(name.parent.name);
    });
    eachName(node, (name) => this.use(name));
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

/** What one operation's `run` touches. A `run` written elsewhere may touch any of its deps. */
function factsOf(checker: ts.TypeChecker, { options, run }: Exits.Operation): Facts {
  const fn = functionOf(run);
  const [param] = fn?.parameters ?? [];
  const reader = new Reader(checker, depsOf(checker, options, param), param);
  return fn?.body ? reader.read(fn.body) : reader.hideRun();
}

const sorted = (items: Iterable<string>) => [...items].sort();

/** A part of a line: its name, then its items, already sorted. */
const listed = (name: string, items: readonly string[]) => `${name}{${items.join(",")}}`;

/**
 * A React hook a view line reads: the part it adds to, the Core function that makes the unit its
 * first argument names, and the call on that unit whose fact it gives.
 */
type Hook = { part: "reads" | "runs"; made: string; kind: string };

/** The hooks of `@tinkered/react` a view line reads, by their own names. */
const viewHooks = new Map<string, Hook>([
  ["useData", { part: "reads", made: "data", kind: "get" }],
  ["useRun", { part: "runs", made: "operation", kind: "run" }],
]);

/** Each hook a file imports from `@tinkered/react`, by the symbol of its name in the file. */
function hooksIn(checker: ts.TypeChecker, source: ts.SourceFile) {
  const hooks = new Map<ts.Symbol, Hook>();
  for (const { propertyName, name } of importsOf(source, "@tinkered/react")) {
    const hook = viewHooks.get((propertyName ?? name).text);
    const symbol = checker.getSymbolAtLocation(name);
    if (hook && symbol) hooks.set(symbol, hook);
  }
  return hooks;
}

/**
 * Each top-level declaration of a file, by its name: a function, a class, each `const`, or a
 * default export. A default export with no name is `default`.
 */
function declarationsIn(source: ts.SourceFile) {
  return source.statements.flatMap((statement): { name: string; node: ts.Node }[] => {
    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      return [{ name: statement.name?.text ?? "default", node: statement }];
    }
    if (ts.isExportAssignment(statement)) return [{ name: "default", node: statement }];
    if (!ts.isVariableStatement(statement)) return [];
    return statement.declarationList.declarations.flatMap((node) =>
      ts.isIdentifier(node.name) ? [{ name: node.name.text, node }] : [],
    );
  });
}

/**
 * The fact one hook call gives: the read a `get` makes on the cell or part its first argument
 * names, or the op it runs. An argument the graph cannot name gives `?`.
 */
function hookFact(checker: ts.TypeChecker, { made, kind }: Hook, call: ts.CallExpression) {
  const [first] = call.arguments;
  const unit = first && unitOf(checker, first);
  const fact = unit?.made === made ? touchesOf(unit).get(kind)?.fact : undefined;
  return fact ?? unseen;
}

/** The React hook a call names, by its symbol: `read(…)` is `useData` when it is an alias. */
function hookAt(checker: ts.TypeChecker, hooks: Map<ts.Symbol, Hook>, call: ts.CallExpression) {
  if (!ts.isIdentifier(call.expression)) return undefined;
  const symbol = checker.getSymbolAtLocation(call.expression);
  return symbol && hooks.get(symbol);
}

/** The facts of one view: what each call of a React hook in its code adds, a callback's too. */
function viewFacts(checker: ts.TypeChecker, hooks: Map<ts.Symbol, Hook>, node: ts.Node) {
  const facts = { reads: new Set<string>(), runs: new Set<string>() };
  const see = (call: ts.CallExpression) => {
    const hook = hookAt(checker, hooks, call);
    if (hook) facts[hook.part].add(hookFact(checker, hook, call));
  };
  const visit = (child: ts.Node) => {
    if (ts.isCallExpression(child)) see(child);
    ts.forEachChild(child, visit);
  };
  visit(node);
  return facts;
}

/**
 * The view lines of one file: a line for each top-level declaration whose code calls `useData`
 * or `useRun` from `@tinkered/react`. The hooks are found by their import, so an alias counts
 * and a local function of the same name does not.
 */
function viewsIn(checker: ts.TypeChecker, { path, source }: Exits.File): Graph.Row[] {
  const hooks = hooksIn(checker, source);
  if (!hooks.size) return [];

  return declarationsIn(source).flatMap(({ name, node }) => {
    const { reads, runs } = viewFacts(checker, hooks, node);
    if (!reads.size && !runs.size) return [];
    const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    const parts = [listed("reads", sorted(reads)), listed("runs", sorted(runs))];
    return [{ path, line, label: `view ${path}#${name}`, parts }];
  });
}

const byLabel = (a: Graph.Row, b: Graph.Row) => (a.label < b.label ? -1 : 1);

/**
 * The app's graph, from its code: one line per operation, sorted by label in code-unit order,
 * the same on every machine, then one line per view, sorted by name. `exits` are the words of
 * ADR 0159.
 */
export function graphOf(root: string): Graph.Of {
  const app = readOperations(root);
  if (!app) return { ops: [], views: [] };

  const ops = app.operations.map((operation): Graph.Line => {
    const facts = factsOf(app.checker, operation);
    const { path, line, label, exits } = operation;
    const writes = sorted(facts.writes);
    const calls = sorted(facts.calls);
    const uses = sorted(usesOf(app.checker, operation));

    const parts = [
      listed("exits", sorted(exits)),
      listed("reads", sorted(facts.reads)),
      listed("writes", writes),
      listed("calls", calls),
      listed("uses", uses),
    ];
    return { path, line, label, exits, parts, writes, calls, uses };
  });
  const views = app.files.flatMap((file) => viewsIn(app.checker, file));
  return { ops: ops.sort(byLabel), views: views.sort(byLabel) };
}

/** The graph as `tinker.graph` holds it: one line per row, and an end of line after each. */
export function graphText(rows: Graph.Row[]) {
  return rows.map(({ label, parts }) => `${[label, ...parts].join(" ")}\n`).join("");
}

/** A view's name: `view`, then a `<file>#<name>` word. An op may be labelled `view`. */
const viewLabel = /^view [^ ]*#/;

/**
 * Each line of the committed file by its label, and its line number: a view's label is its
 * first two words. A line may end in `\r`: a checkout on Windows can give the file those ends.
 */
function linesIn(text: string) {
  const lines = new Map<string, { line: number; parts: string[] }>();
  text.split("\n").forEach((row, index) => {
    const clean = row.trim();
    const words = clean.split(" ");
    const label = words.splice(0, viewLabel.test(clean) ? 2 : 1).join(" ");
    if (label) lines.set(label, { line: index + 1, parts: words });
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
 * `tinker.graph` differ (ADR 0161). A code line points at its operation or its view; a line
 * only the file has points at the file. An app with no line needs no file.
 */
export function graphFindings(root: string, code: Graph.Row[]): Tools.Found[] {
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
