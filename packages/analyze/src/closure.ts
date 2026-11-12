import ts from "typescript-api";

import { enclosingFn, isFn, walk } from "./tree";
import type { Fn } from "./tree";

/** The names a binding declares: `a`, `{ a, b: c }`, `[a, ...b]`. */
export function bindingNames(binding: ts.BindingName, into: Set<string>) {
  if (ts.isIdentifier(binding)) {
    into.add(binding.text);
    return;
  }
  for (const item of binding.elements) {
    if (!ts.isOmittedExpression(item)) bindingNames(item.name, into);
  }
}

function declares(node: ts.Node, into: Set<string>) {
  if (ts.isParameter(node) || ts.isVariableDeclaration(node)) bindingNames(node.name, into);
  if (ts.isFunctionDeclaration(node) && node.name) into.add(node.name.text);
}

/** The names a function declares for itself: its parameters, its locals, its inner functions. */
function ownNames(fn: Fn) {
  const names = new Set<string>();
  const visit = (node: ts.Node) => {
    declares(node, names);
    if (!isFn(node)) ts.forEachChild(node, visit);
  };
  for (const parameter of fn.parameters) bindingNames(parameter.name, names);
  if (fn.body) visit(fn.body);

  return names;
}

/** Every name declared inside a function, at any depth. A read of one is not a capture. */
function innerNames(fn: Fn) {
  const names = new Set<string>();
  walk(fn, (node) => declares(node, names));
  return names;
}

/** The names the functions around this one declare. */
function outerNames(fn: Fn) {
  const names = new Set<string>();
  for (let owner = enclosingFn(fn); owner; owner = enclosingFn(owner)) {
    for (const name of ownNames(owner)) names.add(name);
  }
  return names;
}

/** A name in a place that reads no value: a property's name, a member's key, a JSX attribute. */
function keyOnly(node: ts.Identifier) {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent)) return parent.name === node;
  if (ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent)) {
    return parent.name === node;
  }
  return ts.isJsxAttribute(parent) || (ts.isBindingElement(parent) && parent.propertyName === node);
}

/** A name read as a value. */
function reads(node: ts.Node): node is ts.Identifier {
  return ts.isIdentifier(node) && !keyOnly(node);
}

/**
 * A closure: its body reads a name that a function around it declares, or reads `this`. So it
 * holds state of the unit it lives in. A function that closes over nothing could live at the top
 * level, as `unicorn/consistent-function-scoping` reads it (ADR 0149). Syntax only: a name that
 * is declared both inside and around counts as inside.
 */
export function closes(fn: Fn) {
  const around = outerNames(fn);
  if (around.size === 0 || !fn.body) return false;

  const inner = innerNames(fn);
  let found = false;
  const visit = (node: ts.Node) => {
    if (found || ts.isTypeNode(node)) return;
    found = node.kind === ts.SyntaxKind.ThisKeyword;
    found ||= reads(node) && around.has(node.text) && !inner.has(node.text);
    ts.forEachChild(node, visit);
  };
  visit(fn.body);

  return found;
}
