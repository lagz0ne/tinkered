import ts from "typescript-api";

/** A function with a body of its own: a declaration, an expression, an arrow, a method, an accessor. */
export type Fn =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration
  | ts.AccessorDeclaration;

export function isFn(node: ts.Node): node is Fn {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

export function walk(node: ts.Node, visit: (node: ts.Node) => void) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

/** Walk a body without entering the functions inside it. */
export function ownWalk(node: ts.Node, visit: (node: ts.Node) => void) {
  visit(node);
  ts.forEachChild(node, (child) => {
    if (!isFn(child)) ownWalk(child, visit);
  });
}

/** The nearest function around a node. */
export function enclosingFn(node: ts.Node): Fn | undefined {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (isFn(parent)) return parent;
  }
}

/** The outermost function around a node. */
export function outermostFn(node: ts.Node) {
  let root: Fn | undefined;
  for (let owner = enclosingFn(node); owner; owner = enclosingFn(owner)) root = owner;
  return root;
}
