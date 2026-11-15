import ts from "typescript-api";

import type { Check } from "./check";

/** The banned hooks, by the name of the hook React exports. */
const hooks = new Set(["useEffect", "useLayoutEffect", "useState", "useReducer"]);

/** The network constructors, by the global name a page can reach. */
const constructors = new Set(["XMLHttpRequest", "EventSource", "WebSocket"]);

/** The names a page reaches a browser global through. */
const globals = new Set(["window", "globalThis", "self", "global"]);

/** What one file's imports bound: React itself, and each banned hook by its local name. */
type Bound = { namespaces: Set<string>; hooks: Map<string, string> };

type Hit = { node: ts.Node; rule: Check.Rule; what: string };

function walk(node: ts.Node, visit: (node: ts.Node) => void) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

/** Only an `x` file holds JSX; in any other file `<T>value` is a cast. */
function kindOf(path: string) {
  return path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

const wire = (node: ts.Node, name: string): Hit => ({
  node,
  rule: "tinker/one-wire",
  what: `\`${name}\`: a page's own network call`,
});

const state = (node: ts.Node, name: string): Hit => ({
  node,
  rule: "tinker/react-state",
  what: `\`${name}\`: React's own state or effect`,
});

/** The clause of an import from `"react"`: what it binds. */
function reactClause(statement: ts.Statement) {
  if (!ts.isImportDeclaration(statement)) return;
  const from = statement.moduleSpecifier;

  return ts.isStringLiteral(from) && from.text === "react" ? statement.importClause : undefined;
}

/** `import React from "react"`, `import * as React`, and `import { useEffect as watch }`. */
function readImport(bound: Bound, statement: ts.Statement) {
  const clause = reactClause(statement);
  if (!clause) return;
  const { name, namedBindings } = clause;

  if (name) bound.namespaces.add(name.text);
  if (!namedBindings) return;
  if (ts.isNamespaceImport(namedBindings)) {
    bound.namespaces.add(namedBindings.name.text);
    return;
  }

  for (const element of namedBindings.elements) {
    const hook = (element.propertyName ?? element.name).text;
    if (hooks.has(hook)) bound.hooks.set(element.name.text, hook);
  }
}

/** `fetch(...)`, `WebSocket(...)` with no `new`, a bound hook, or a name that reuses a hook's. */
function plainCall(bound: Bound, node: ts.Node): Hit | undefined {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return;
  const name = node.expression.text;

  if (constructors.has(name) || name === "fetch") return wire(node, name);
  const hook = bound.hooks.get(name) ?? (hooks.has(name) ? name : undefined);
  return hook ? state(node, hook) : undefined;
}

/** `new WebSocket(...)`, `new XMLHttpRequest(...)`, `new EventSource(...)`. */
function construction(node: ts.Node): Hit | undefined {
  if (!ts.isNewExpression(node) || !ts.isIdentifier(node.expression)) return;
  const name = node.expression.text;

  return constructors.has(name) ? wire(node, name) : undefined;
}

/** The member a call runs, and the name it is read from: a read of it is not a call. */
function calledMember(node: ts.Node) {
  if (!ts.isPropertyAccessExpression(node)) return;
  if (!ts.isCallExpression(node.parent) || node.parent.expression !== node) return;

  const on = ts.isIdentifier(node.expression) ? node.expression.text : "";
  return { name: node.name.text, on };
}

/**
 * A member call: `navigator.sendBeacon(...)`, `page.fetch(...)` on any object (both are the
 * network whatever the receiving object is called), `window.WebSocket(...)`, `React.useState`.
 * A `.useEffect` on any other object passes: only React's hooks are banned.
 */
function memberCall(bound: Bound, node: ts.Node): Hit | undefined {
  const member = calledMember(node);
  if (!member) return;
  const { name, on } = member;

  if (name === "sendBeacon" || name === "fetch") return wire(node, name);
  if (constructors.has(name) && globals.has(on)) return wire(node, name);
  return hooks.has(name) && bound.namespaces.has(on) ? state(node, name) : undefined;
}

/** The names `const { ... } = React` binds, when the right side is React itself. */
function reactPattern(bound: Bound, node: ts.Node) {
  if (!ts.isVariableDeclaration(node) || !ts.isObjectBindingPattern(node.name)) return [];
  const from = node.initializer;

  return from && ts.isIdentifier(from) && bound.namespaces.has(from.text) ? node.name.elements : [];
}

/** `const { useState } = React` binds the hook under a name the import scan cannot see. */
function readDestructure(bound: Bound, node: ts.Node) {
  for (const element of reactPattern(bound, node)) {
    const key = element.propertyName ?? element.name;
    if (!ts.isIdentifier(key) || !ts.isIdentifier(element.name)) continue;
    if (hooks.has(key.text)) bound.hooks.set(element.name.text, key.text);
  }
}

const keyed = (node: ts.Node, name: string, list: boolean): Hit => ({
  node,
  rule: "tinker/keyed-prop",
  what: `\`${name}\`: ${list ? "a keyed part's list" : "a member of a keyed part"}, passed as a prop`,
});

/** The calls on a list that hand each member to a function: `list.map((issue) => ...)`. */
const visits = new Set(["map", "flatMap", "forEach", "filter", "find", "some", "every"]);

/** The calls on a list that give a list of the same members: `list.filter(...).toSorted()`. */
const keeps = new Set(["filter", "toSorted", "sort", "slice", "toReversed", "reverse", "concat"]);

/** Strip `(x)`, `x as T`, `x!` and `x satisfies T` off an expression. */
function bare(node: ts.Expression): ts.Expression {
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) return bare(node.expression);
  if (ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node)) return bare(node.expression);
  return node;
}

/** The parameter of this name on a function, or the `const` of this name in a block. */
function declaredIn(scope: ts.Node, name: string): ts.Node | undefined {
  const named = (node: ts.ParameterDeclaration | ts.VariableDeclaration) =>
    ts.isIdentifier(node.name) && node.name.text === name;
  if (ts.isFunctionLike(scope)) return scope.parameters.find(named);
  if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) return;

  return scope.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => statement.declarationList.declarations)
    .find(named);
}

/**
 * Where a name is declared, seen from where it is used: the nearest function parameter or
 * `const` of that name, scope by scope outward. Two callbacks that both say `issue` are apart.
 */
function declarationOf(name: ts.Identifier): ts.Node | undefined {
  for (let scope: ts.Node | undefined = name.parent; scope; scope = scope.parent) {
    const found = declaredIn(scope, name.text);
    if (found) return found;
  }
}

/** The method a call runs, when it is `x.method(...)`: `{ name, on: x }`. */
function methodCall(node: ts.Node) {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;

  return { name: node.expression.name.text, on: node.expression.expression, call: node };
}

/** `[...list]`: the list it spreads. */
function spreadOf(node: ts.Expression) {
  if (!ts.isArrayLiteralExpression(node) || node.elements.length !== 1) return;
  const [only] = node.elements;

  return only && ts.isSpreadElement(only) ? only.expression : undefined;
}

/** The name a list comes from: `list`, `list.filter(...)`, `[...list].sort()`, `list ?? []`. */
function listRoot(node: ts.Expression): ts.Identifier | undefined {
  const at = bare(node);
  if (ts.isIdentifier(at)) return at;
  if (ts.isBinaryExpression(at)) return listRoot(at.left);
  const spread = spreadOf(at);
  if (spread) return listRoot(spread);
  const method = methodCall(at);

  return method && keeps.has(method.name) ? listRoot(method.on) : undefined;
}

/** What the page holds from keyed parts, by declaration: parts, lists, and members. */
type Held = { parts: Set<ts.Node>; lists: Set<ts.Node>; members: Set<ts.Node> };

/** Whether this name was declared as one of `set`. */
function isHeld(set: Set<ts.Node>, name: ts.Identifier) {
  const declared = declarationOf(name);
  return !!declared && set.has(declared);
}

/** `x.where(...)`, or a name declared as one: a keyed part. */
function isWhere(node: ts.Expression, held: Held): boolean {
  const at = bare(node);
  if (ts.isIdentifier(at)) return isHeld(held.parts, at);

  return methodCall(at)?.name === "where";
}

/** `useData(part)` where the part is a `.where(...)`. */
function isListRead(node: ts.Expression, held: Held) {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return false;
  const [read] = node.arguments;

  return node.expression.text === "useData" && !!read && isWhere(read, held);
}

/** `const part = x.where(...)` and `const list = useData(part)`. */
function readLists(held: Held, node: ts.Node) {
  if (!ts.isVariableDeclaration(node) || !node.initializer) return;
  const value = bare(node.initializer);
  if (!ts.isIdentifier(value) && isWhere(value, held)) held.parts.add(node);
  if (isListRead(value, held)) held.lists.add(node);
}

/** The callback of `list.map(...)` and its kin, when `list` is a keyed part's list. */
function visitOf(held: Held, node: ts.Node) {
  const method = methodCall(node);
  if (!method || !visits.has(method.name)) return;
  const root = listRoot(method.on);
  if (!root || !isHeld(held.lists, root)) return;
  const [visit] = method.call.arguments;

  return visit && (ts.isArrowFunction(visit) || ts.isFunctionExpression(visit)) ? visit : undefined;
}

/** The parameter a `list.map((issue) => ...)` callback binds to each member. */
function readMembers(held: Held, node: ts.Node) {
  const [member] = visitOf(held, node)?.parameters ?? [];
  if (member && ts.isIdentifier(member.name)) held.members.add(member);
}

/** `<Card issue={issue} />`, `<Card {...issue} />`, or `<Board list={list} />`. */
function keyedProp(held: Held, node: ts.Node): Hit | undefined {
  const hit = (at: ts.Expression) => {
    if (!ts.isIdentifier(at)) return;
    if (isHeld(held.lists, at)) return keyed(node, at.text, true);
    return isHeld(held.members, at) ? keyed(node, at.text, false) : undefined;
  };
  if (ts.isJsxSpreadAttribute(node)) return hit(bare(node.expression));
  if (!ts.isJsxAttribute(node) || !node.initializer) return;
  if (!ts.isJsxExpression(node.initializer) || !node.initializer.expression) return;
  if (node.name.getText() === "key") return;

  return hit(bare(node.initializer.expression));
}

/**
 * The page rules (Duke 2026-11-04). The syntax tree is walked, so text in a comment or a string
 * is not a finding.
 *
 * `tinker/one-wire`: only the rpc client talks to the server. A finding is a call of `fetch` or
 * `.fetch`, `.sendBeacon`, or `XMLHttpRequest`, `EventSource` or `WebSocket` however it is built.
 *
 * `tinker/react-state`: state lives in Core cells, read through `@tinkered/react`. A finding is a
 * call of `useEffect`, `useLayoutEffect`, `useState` or `useReducer`, whatever name an import
 * gave it. The finding is the use, not the import.
 *
 * `tinker/keyed-prop`: a child reads its own member of a keyed part (Duke 2026-11-15, CUJ eval).
 * A finding is a JSX prop that hands down a list read with `useData(x.where(...))`, or one member
 * of it from a `.map` and its kin. Pass the key: the child reads `useData(x.of(key))`, so a write
 * to one member draws that child alone.
 */
export function findPage({ path, text }: Check.Source): Check.Finding[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kindOf(path));
  const bound: Bound = { namespaces: new Set(), hooks: new Map() };
  for (const statement of source.statements) readImport(bound, statement);

  const hits: Hit[] = [];
  const held: Held = { parts: new Set(), lists: new Set(), members: new Set() };
  walk(source, (node) => {
    readLists(held, node);
    readMembers(held, node);
    const hit =
      plainCall(bound, node) ??
      construction(node) ??
      memberCall(bound, node) ??
      keyedProp(held, node);
    if (hit) hits.push(hit);
    readDestructure(bound, node);
  });

  return hits.map(({ node, rule, what }) => ({
    path,
    line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
    rule,
    what,
  }));
}
