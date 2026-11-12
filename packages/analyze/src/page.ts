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
 */
export function findPage({ path, text }: Check.Source): Check.Finding[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kindOf(path));
  const bound: Bound = { namespaces: new Set(), hooks: new Map() };
  for (const statement of source.statements) readImport(bound, statement);

  const hits: Hit[] = [];
  walk(source, (node) => {
    const hit = plainCall(bound, node) ?? construction(node) ?? memberCall(bound, node);
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
