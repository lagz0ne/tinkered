import { dirname, join } from "node:path";

import ts from "typescript-api";

import type { Check } from "./check";
import { bindingNames, closes } from "./closure";
import { enclosingFn, isFn, ownWalk, walk } from "./tree";
import type { Fn } from "./tree";

/** The hooks Core 0.10.0's `capsule()` accepts (`Capsule.Hooks`). */
const hookNames = new Set(["start", "resolve", "run", "write", "close", "session"]);

/** Core calls whose direct options are graph bodies. */
const unitNames = new Set(["operation", "resource", "tag", "data"]);

/** Calls that register a listener: the event source calls it, never app code by name. */
const listenNames = new Set([
  "addEventListener",
  "removeEventListener",
  "on",
  "once",
  "off",
  "defer",
  "dispose",
]);

/**
 * What one file knows: its path, its Core imports, its library imports, its app imports (by the
 * file they come from), the `defineMain` it imports, its hooks objects, its top-level consts, and
 * its top-level function declarations.
 */
type File = {
  pass: Pass;
  path: string;
  source: ts.SourceFile;
  core: Map<string, string>;
  library: Set<string>;
  app: Map<string, { from: string; name: string }>;
  mains: Set<string>;
  hooks: Set<string>;
  consts: Map<string, ts.Expression>;
  fns: Map<string, ts.FunctionDeclaration>;
};

/** What one run shares: every file by its path without the extension, and each verdict once. */
type Pass = {
  files: Map<string, File>;
  verdicts: Map<ts.Node, boolean>;
  entries: Check.Entries;
};

/** Wrappers that keep the value: parens, casts, and the branches of `a || b` or `c ? a : b`. */
function wraps(parent: ts.Node, node: ts.Node) {
  if (
    ts.isParenthesizedExpression(parent) ||
    ts.isAsExpression(parent) ||
    ts.isSatisfiesExpression(parent) ||
    ts.isNonNullExpression(parent) ||
    ts.isTypeAssertionExpression(parent)
  ) {
    return true;
  }
  if (ts.isConditionalExpression(parent)) return parent.condition !== node;
  return ts.isBinaryExpression(parent) && logical.has(parent.operatorToken.kind);
}

const logical = new Set([
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.AmpersandAmpersandToken,
]);

/** The outermost node that still holds this value. */
function outer(node: ts.Node) {
  while (node.parent && wraps(node.parent, node)) node = node.parent;
  return node;
}

function textOf(name: ts.Node | undefined) {
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isPrivateIdentifier(name)) {
    return name.text;
  }
  return name.getText();
}

/** The name a function is bound to: its declaration, variable, property, or assignment. */
function nameOf(fn: Fn) {
  if (!ts.isFunctionExpression(fn) && !ts.isArrowFunction(fn)) return textOf(fn.name);
  return holderName(outer(fn).parent);
}

function holderName(holder: ts.Node) {
  if (ts.isVariableDeclaration(holder) || ts.isPropertyAssignment(holder)) {
    return textOf(holder.name);
  }
  if (ts.isPropertyDeclaration(holder)) return textOf(holder.name);

  if (ts.isBinaryExpression(holder) && holder.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    return holder.left.getText();
  }
  return ts.isExportAssignment(holder) ? "default" : undefined;
}

/** The object literal a named function is a member of, if any. */
function memberOf(fn: Fn) {
  const member = ts.isFunctionExpression(fn) || ts.isArrowFunction(fn) ? outer(fn).parent : fn;
  const isMember =
    ts.isPropertyAssignment(member) || ts.isMethodDeclaration(member) || ts.isAccessor(member);
  return isMember && ts.isObjectLiteralExpression(member.parent) ? member.parent : undefined;
}

/**
 * The identifier a value is built from: `Bun` in `Bun.serve` or `new Bun.Glob("*").scanSync()`,
 * `f` in `f<T>()(...)`, the shared root of an array's spreads in `[...xs].map`.
 */
function calleeRoot(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isArrayLiteralExpression(expression)) return spreadRoot(expression);
  const next = builtOn(expression);
  return next && calleeRoot(next);
}

/** What an expression builds on: a receiver, a called or constructed value, a cast's value. */
function builtOn(expression: ts.Expression) {
  const steps =
    ts.isPropertyAccessExpression(expression) ||
    ts.isCallExpression(expression) ||
    ts.isNewExpression(expression) ||
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression);
  return steps ? expression.expression : undefined;
}

/** `[...xs, ...ys]`: the root every spread shares, when each item is a spread. */
function spreadRoot(array: ts.ArrayLiteralExpression) {
  const roots = array.elements.map((item) =>
    ts.isSpreadElement(item) ? calleeRoot(item.expression) : undefined,
  );
  const [first] = roots;
  return first && roots.every((root) => root === first) ? first : undefined;
}

/** The file an app import names, by its path without the extension. */
function appFile(file: File, specifier: string) {
  const path = specifier.startsWith("~/")
    ? `tinker/${specifier.slice(2)}`
    : specifier.startsWith("@/")
      ? `src/${specifier.slice(2)}`
      : join(dirname(file.path), specifier);
  return stem(path);
}

function stem(path: string) {
  return path.replace(/\.[mc]?tsx?$/, "");
}

/**
 * Platform classes whose options the platform calls. Only the direct callee counts:
 * `new ReadableStream({...})` is a library call, but a const built on one is not a library
 * value (a Proxy returns its app target). Only the ones the app uses; add one with its reason.
 */
const platformNames = new Set([
  /** A stream source: the stream calls `start`, `pull` and `cancel`. */
  "ReadableStream",
  /** A proxy handler: the proxy calls its traps (`get`, `set`, ...). */
  "Proxy",
  /** A stream step: the stream calls `transform` and `flush`. */
  "TransformStream",
]);

/** `new X({...})` with X on the platform list, as the direct callee. */
function platformCall(call: ts.CallExpression | ts.NewExpression) {
  return (
    ts.isNewExpression(call) &&
    ts.isIdentifier(call.expression) &&
    platformNames.has(call.expression.text)
  );
}

/**
 * A name whose value comes from a library: imported from a package, the `Bun` global, or a
 * top-level const built on one, here or in the app file it is imported from (no barrels).
 */
function libraryValue(file: File, name: string, depth = 0): boolean {
  if (name === "Bun" || file.library.has(name)) return true;
  if (depth > 8) return false;

  const value = file.consts.get(name);
  const root = value && calleeRoot(value);
  return root ? libraryValue(file, root, depth + 1) : importedValue(file, name, depth);
}

function importedValue(file: File, name: string, depth: number) {
  const from = file.app.get(name);
  const target =
    from && (file.pass.files.get(from.from) ?? file.pass.files.get(`${from.from}/index`));
  return !!target && libraryValue(target, from.name, depth + 1);
}

/**
 * A library value where `at` stands: a library value of the file, or a local of a function
 * around it that comes from a module resource, as `x` in `depends: { x: betterAuthModule }`,
 * `betterAuth` in `const { betterAuth } = x`, or `db` in `const db = new x.Kysely({...})`.
 */
function libraryAt(file: File, name: string, at: ts.Node, depth = 0): boolean {
  if (libraryValue(file, name)) return true;
  if (depth > 8) return false;

  for (let fn = enclosingFn(at); fn; fn = enclosingFn(fn)) {
    const bound = bindingIn(file, fn, name);
    if (bound === undefined) continue;
    if (typeof bound === "boolean") return bound;
    const root = calleeRoot(bound.value);
    return !!root && libraryAt(file, root, bound.at, depth + 1);
  }
  return false;
}

/**
 * How a function binds a name: a module-resource dependency (true), another parameter (false),
 * a local built on a value (that value), or not at all (undefined).
 */
function bindingIn(file: File, fn: Fn, name: string) {
  for (const [index, parameter] of fn.parameters.entries()) {
    const item = bindsName(parameter.name, name);
    if (!item) continue;
    return index === 0 && ts.isBindingElement(item) && moduleDependency(file, fn, item);
  }

  const found: ts.VariableDeclaration[] = [];
  if (fn.body) {
    ownWalk(fn.body, (node) => {
      if (ts.isVariableDeclaration(node) && bindsName(node.name, name)) found.push(node);
    });
  }
  const [local] = found;
  return local && (local.initializer ? { value: local.initializer, at: local } : false);
}

/** The binding of a name in `name` or in `{ name }`, if it binds it. */
function bindsName(binding: ts.BindingName, name: string) {
  if (ts.isIdentifier(binding)) return binding.text === name ? binding : undefined;
  if (!ts.isObjectBindingPattern(binding)) return undefined;
  return binding.elements.find((item) => ts.isIdentifier(item.name) && item.name.text === name);
}

/** A dependency of a Core unit's option, taken from its first parameter: a module resource. */
function moduleDependency(file: File, fn: Fn, item: ts.BindingElement) {
  const object = memberOf(fn);
  if (!object || !unitNames.has(coreCall(file, object) ?? "")) return false;

  const key = textOf(item.propertyName ?? item.name);
  const value = property(property(object, "depends"), key);
  return !!value && ts.isIdentifier(value) && moduleResource(file, value.text);
}

/** The value of a property of an object literal: `{ name: value }` or `{ name }`. */
function property(object: ts.Node | undefined, name: string | undefined) {
  if (!object || !ts.isObjectLiteralExpression(object)) return undefined;
  for (const item of object.properties) {
    if (textOf(item.name) !== name) continue;
    if (ts.isPropertyAssignment(item)) return item.initializer;
    if (ts.isShorthandPropertyAssignment(item)) return item.name;
    if (ts.isMethodDeclaration(item)) return item;
  }
}

/**
 * A Core `resource` whose factory returns `import("<package>")`, here or in the app file it is
 * imported from. An app path (`~/x`, `./x`) is app code, not a library.
 */
function moduleResource(file: File, name: string, depth = 0): boolean {
  if (depth > 8) return false;
  const value = file.consts.get(name);
  if (value) return libraryResource(file, value);

  const from = file.app.get(name);
  const target =
    from && (file.pass.files.get(from.from) ?? file.pass.files.get(`${from.from}/index`));
  return !!target && moduleResource(target, from.name, depth + 1);
}

/**
 * A `resource({ factory })` call whose factory returns `import("<package>")` on every return:
 * one branch of app code makes the whole value app code.
 */
function libraryResource(file: File, value: ts.Node) {
  if (!ts.isCallExpression(value) || !ts.isIdentifier(value.expression)) return false;
  if (file.core.get(value.expression.text) !== "resource") return false;

  const factory = property(value.arguments.at(0), "factory");
  const returns = factory && isFn(factory) ? returnsOf(factory) : [];
  return returns.length > 0 && returns.every(importsLibrary);
}

/** `import("<package>")` of a bare package specifier. */
function importsLibrary(node: ts.Node) {
  if (!ts.isCallExpression(node) || node.expression.kind !== ts.SyntaxKind.ImportKeyword) {
    return false;
  }
  const [specifier] = node.arguments;
  return !!specifier && ts.isStringLiteral(specifier) && library(specifier.text);
}

/** The call this node is a direct argument of. */
function argumentOf(node: ts.Node) {
  const call = outer(node).parent;
  if (!ts.isCallExpression(call) && !ts.isNewExpression(call)) return undefined;
  return call.arguments?.includes(outer(node) as ts.Expression) ? call : undefined;
}

/** The Core name a call's callee is imported as: `operation`, `capsule`, ... */
function coreCall(file: File, node: ts.Node) {
  const call = argumentOf(node);
  return call && ts.isIdentifier(call.expression) ? file.core.get(call.expression.text) : undefined;
}

/** A capsule's hooks: `capsule({ hooks: {...} })`, or an object typed or passed as hooks. */
function isHooks(file: File, object: ts.ObjectLiteralExpression) {
  const holder = outer(object).parent;
  if (ts.isPropertyAssignment(holder) && textOf(holder.name) === "hooks") {
    return coreCall(file, holder.parent) === "capsule";
  }
  if (!ts.isVariableDeclaration(holder) || !ts.isIdentifier(holder.name)) return false;
  return file.hooks.has(holder.name.text) || hooksType(file, holder.type);
}

function hooksType(file: File, type: ts.TypeNode | undefined) {
  if (!type || !ts.isTypeReferenceNode(type) || !ts.isQualifiedName(type.typeName)) return false;
  const { left, right } = type.typeName;
  return ts.isIdentifier(left) && file.core.get(left.text) === "Capsule" && right.text === "Hooks";
}

/** A direct option of a Core unit, or a hook of a capsule. */
function graphOption(file: File, fn: Fn) {
  const object = memberOf(fn);
  if (!object) return false;
  if (unitNames.has(coreCall(file, object) ?? "")) return true;
  return hookNames.has(nameOf(fn) ?? "") && isHooks(file, object);
}

/** Inside the options of a library call, at any depth. Core calls are graph options instead. */
function nativeOption(file: File, fn: Fn) {
  let node: ts.Node | undefined = memberOf(fn);
  while (node && ts.isObjectLiteralExpression(node)) {
    const holder = outer(node).parent;
    if (!ts.isPropertyAssignment(holder)) break;
    node = holder.parent;
  }

  const call = node && argumentOf(node);
  if (!call) return false;
  const name = calleeRoot(call.expression);
  return platformCall(call) || (!!name && libraryAt(file, name, call));
}

/** A use of a name as a value: not a callee, not a property's receiver or key. */
function valueUse(node: ts.Node, name: string) {
  if (!ts.isIdentifier(node) || node.text !== name) return false;
  const parent = node.parent;
  if (ts.isCallExpression(parent) && parent.expression === node) return false;
  if (ts.isPropertyAccessExpression(parent)) return false;
  return !(ts.isPropertyAssignment(parent) && parent.name === node);
}

/** The values a function returns: each `return` of its own, or its expression body. */
function returnsOf(owner: Fn) {
  const found: ts.Node[] = [];
  if (owner.body && !ts.isBlock(owner.body)) found.push(owner.body);
  if (owner.body) {
    ownWalk(owner.body, (node) => {
      if (ts.isReturnStatement(node) && node.expression) found.push(node.expression);
    });
  }
  return found;
}

function returnsName(owner: Fn, name: string) {
  let found = false;
  for (const value of returnsOf(owner)) {
    walk(value, (node) => {
      found ||= valueUse(node, name);
    });
  }
  return found;
}

/** The owner returns this object: directly, inside a returned object, or through a local name. */
function returned(owner: Fn, object: ts.Node) {
  let node = outer(object);
  while (ts.isPropertyAssignment(node.parent) && ts.isObjectLiteralExpression(node.parent.parent)) {
    node = outer(node.parent.parent);
  }
  if (returnsOf(owner).includes(node)) return true;

  const holder = node.parent;
  return ts.isVariableDeclaration(holder) && ts.isIdentifier(holder.name)
    ? returnsName(owner, holder.name.text)
    : false;
}

/** Handed to a call: an argument, a property of an argument, or a JSX attribute. */
function handed(node: ts.Node) {
  const parent = outer(node).parent;
  if (argumentOf(node) || ts.isJsxExpression(parent)) return true;
  if (!ts.isShorthandPropertyAssignment(parent) && !ts.isPropertyAssignment(parent)) return false;
  return ts.isObjectLiteralExpression(parent.parent) && !!argumentOf(parent.parent);
}

function handsName(owner: Fn, name: string) {
  let found = false;
  walk(owner.body!, (node) => {
    found ||= valueUse(node, name) && handed(node);
  });
  return found;
}

/** Named inside a passing function, which returns it or hands it to a call. */
function owned(file: File, fn: Fn, name: string) {
  const object = memberOf(fn);
  const owner = enclosingFn(object ?? fn);
  if (!owner || !passes(file, owner)) return false;
  if (object) return returned(owner, object);
  return returnsName(owner, name) || handsName(owner, name);
}

function hasJsx(node: ts.Node) {
  let found = false;
  ownWalk(node, (child) => {
    found ||=
      ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child);
  });
  return found;
}

/** A React component: capitalized, at most one parameter (its props), and it returns JSX. */
function component(file: File, fn: Fn, name: string) {
  const own = ts.isFunctionExpression(fn) ? (textOf(fn.name) ?? name) : name;
  if (!file.path.endsWith(".tsx") || !/^[A-Z]/.test(own)) return false;
  return fn.parameters.length <= 1 && !!fn.body && hasJsx(fn.body);
}

/**
 * Written where it is used: a JSX attribute, a returned value, or an argument of a call that
 * takes callbacks. An array item stands where its array stands, so `const [f] = [() => 1]` is
 * named, as is `const f = Object.freeze(() => 1)`.
 */
function inline(file: File, node: ts.Node): boolean {
  node = outer(node);
  const parent = node.parent;
  if (ts.isArrayLiteralExpression(parent)) return inline(file, parent);
  if (ts.isJsxExpression(parent) || ts.isReturnStatement(parent)) return true;
  if (ts.isArrowFunction(parent) && parent.body === node) return true;

  const call = argumentOf(node);
  return !!call && callbackCall(file, call);
}

/**
 * A call that may take an unnamed function: one inside a function (that function is judged
 * itself), a Core call, `defineMain`, a library call, or an event registration.
 */
function callbackCall(file: File, call: ts.CallExpression | ts.NewExpression) {
  if (enclosingFn(call) || platformCall(call)) return true;
  const name = calleeRoot(call.expression);
  if (name && (file.core.has(name) || file.mains.has(name) || libraryValue(file, name))) {
    return true;
  }
  return (
    ts.isPropertyAccessExpression(call.expression) && listenNames.has(call.expression.name.text)
  );
}

function exempt(file: File, name: string) {
  return Object.hasOwn(file.pass.entries[file.path] ?? {}, name);
}

function judge(file: File, fn: Fn) {
  const name = nameOf(fn);
  if (name === undefined) return inline(file, fn);
  if (exempt(file, name)) return true;

  return (
    component(file, fn, name) ||
    graphOption(file, fn) ||
    nativeOption(file, fn) ||
    owned(file, fn, name)
  );
}

function passes(file: File, fn: Fn): boolean {
  const verdicts = file.pass.verdicts;
  if (!verdicts.has(fn)) verdicts.set(fn, judge(file, fn));
  return verdicts.get(fn)!;
}

/** Library calls that hand back the function they take: the name they bind is still that function. */
const keepNames = new Set(["useCallback"]);

/** A function the syntax can name, in the file that holds it. */
type Found = { file: File; fn: Fn };

/** What a name is bound to: an initializer or a function declaration, in the file that holds it. */
type Bound = { file: File; node: ts.Node };

/** The value under the wrappers that keep it: parens, casts, `!`. */
function unwrap(node: ts.Node) {
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    node = node.expression;
  }
  return node;
}

/** Whether a variable or a parameter declares this name, alone or inside a pattern. */
function names(node: ts.VariableDeclaration | ts.ParameterDeclaration, name: string) {
  const found = new Set<string>();
  bindingNames(node.name, found);
  return found.has(name);
}

/** What a variable gives a name: its value, or "hidden" when it comes out of a pattern. */
function variable(node: ts.VariableDeclaration, name: string) {
  if (!names(node, name)) return undefined;
  return (ts.isIdentifier(node.name) && node.initializer) || "hidden";
}

/** What a declaration gives a name: its value, "hidden" when the syntax cannot say, or nothing. */
function declared(node: ts.Node, name: string): ts.Node | "hidden" | undefined {
  if (ts.isFunctionDeclaration(node)) return node.name?.text === name ? node : undefined;
  if (ts.isParameter(node)) return names(node, name) ? "hidden" : undefined;
  return ts.isVariableDeclaration(node) ? variable(node, name) : undefined;
}

/** How a function binds a name for the code inside it: a parameter, a local, an inner function. */
function localBinding(owner: Fn, name: string) {
  let found: ts.Node | "hidden" | undefined;
  const visit = (node: ts.Node) => {
    found ??= declared(node, name);
    if (!isFn(node)) ts.forEachChild(node, visit);
  };
  for (const parameter of owner.parameters) visit(parameter);
  if (owner.body) visit(owner.body);

  return found;
}

/** The file an app import comes from, and the name it has there. */
function importedFrom(file: File, name: string) {
  const from = file.app.get(name);
  if (!from) return undefined;
  const target = file.pass.files.get(from.from) ?? file.pass.files.get(`${from.from}/index`);
  return target && { file: target, name: from.name };
}

/** A top-level name of a file: a function, a const, or an app import followed to its file. */
function topBinding(file: File, name: string, depth = 0): Bound | undefined {
  const node = file.fns.get(name) ?? file.consts.get(name);
  if (node) return { file, node };

  const from = importedFrom(file, name);
  return from && depth < 8 ? topBinding(from.file, from.name, depth + 1) : undefined;
}

/** What a name is bound to where `at` stands: the nearest local, else a top-level name. */
function boundTo(file: File, name: string, at: ts.Node): Bound | undefined {
  for (let owner = enclosingFn(at); owner; owner = enclosingFn(owner)) {
    const node = localBinding(owner, name);
    if (node === "hidden") return undefined;
    if (node) return { file, node };
  }
  return topBinding(file, name);
}

/** Follow `const b = a` to the value behind the names. */
function settle(bound: Bound | undefined, depth = 0): Bound | undefined {
  if (!bound) return undefined;
  const node = unwrap(bound.node);
  if (!ts.isIdentifier(node)) return { file: bound.file, node };
  return depth < 8 ? settle(boundTo(bound.file, node.text, node), depth + 1) : undefined;
}

/** The function a keeping call takes: the `fn` of `useCallback(fn)`, imported from a library. */
function keptFn(file: File, node: ts.Node) {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return undefined;
  const name = node.expression.text;
  if (!keepNames.has(name) || !file.library.has(name)) return undefined;
  return node.arguments[0] && unwrap(node.arguments[0]);
}

/** The function a value is: itself, or the one a keeping call takes. */
function fnOf(bound: Bound | undefined): Found | undefined {
  const value = settle(bound);
  if (!value) return undefined;
  const fn = isFn(value.node) ? value.node : keptFn(value.file, value.node);
  return fn && isFn(fn) ? { file: value.file, fn } : undefined;
}

/** The member `name` of a value that is an object literal. */
function memberFn(bound: Bound | undefined, name: string): Found | undefined {
  const value = settle(bound);
  const item = value && property(value.node, name);
  const member = item && unwrap(item);
  return member && isFn(member) ? { file: value.file, fn: member } : undefined;
}

/** The app function a call names, when the syntax shows it: `f()` or `object.f()`. */
function calleeFn(file: File, call: ts.CallExpression): Found | undefined {
  const callee = unwrap(call.expression);
  if (ts.isIdentifier(callee)) return fnOf(boundTo(file, callee.text, call));
  if (!ts.isPropertyAccessExpression(callee) || !ts.isIdentifier(callee.expression)) {
    return undefined;
  }
  return memberFn(boundTo(file, callee.expression.text, call), callee.name.text);
}

/**
 * A helper behind a pass: a passing function that a call names, that holds no state of a
 * function around it, and that is no entry. Something else is meant to call a passing function
 * (Core, a library, React); a call by name makes it a plain function again (ADR 0149).
 */
function helperOf(file: File, call: ts.CallExpression) {
  const found = calleeFn(file, call);
  if (!found?.fn.body || !passes(found.file, found.fn)) return undefined;

  const name = nameOf(found.fn);
  if (name !== undefined && exempt(found.file, name)) return undefined;
  return closes(found.fn) ? undefined : found;
}

/** The line a node starts on, from 1. */
function lineOf(file: File, node: ts.Node) {
  return file.source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
}

/** Each helper the calls of a file name, as a finding at the helper, with the call that names it. */
function called(file: File): Check.Finding[] {
  const hits: Check.Finding[] = [];
  walk(file.source, (node) => {
    const found = ts.isCallExpression(node) ? helperOf(file, node) : undefined;
    if (!found) return;

    const what = `a helper, called by name at ${file.path}:${lineOf(file, node)}`;
    const line = lineOf(found.file, found.fn);
    hits.push({ path: found.file.path, line, rule: "tinker/plain", what });
  });
  return hits;
}

/** One finding for each helper: its first call in file order. */
function calledOnce(files: Iterable<File>) {
  const first = new Map<string, Check.Finding>();
  for (const file of files) {
    for (const hit of called(file)) {
      const key = `${hit.path}:${hit.line}`;
      if (!first.has(key)) first.set(key, hit);
    }
  }
  return [...first.values()];
}

/** A bare package import is a library; `~/`, `@/` and relative paths are app code. */
function library(specifier: string) {
  return !/^(\.|~\/|@\/)/.test(specifier) && specifier !== "@tinkered/core";
}

/** Each local name an import binds, with the name it has in its module. */
function importNames(clause: ts.ImportClause): [string, string][] {
  const names: [string, string][] = clause.name ? [[clause.name.text, "default"]] : [];
  const bindings = clause.namedBindings;
  if (!bindings) return names;
  if (ts.isNamespaceImport(bindings)) return [...names, [bindings.name.text, "*"]];

  for (const item of bindings.elements) {
    names.push([item.name.text, (item.propertyName ?? item.name).text]);
  }
  return names;
}

function readImport(file: File, node: ts.ImportDeclaration) {
  const specifier = (node.moduleSpecifier as ts.StringLiteral).text;
  if (!node.importClause) return;

  for (const [local, name] of importNames(node.importClause)) {
    if (specifier === "@tinkered/core") file.core.set(local, name);
    else if (library(specifier)) file.library.add(local);
    else readAppImport(file, local, { from: appFile(file, specifier), name });
  }
}

/** An app import; the `defineMain` of tinker/base/main.ts may take the command's main. */
function readAppImport(file: File, local: string, from: { from: string; name: string }) {
  file.app.set(local, from);
  if (from.name === "defineMain" && from.from === "tinker/base/main") file.mains.add(local);
}

/** Top-level consts and what they hold: `const batch = z.object({...})`. */
function readConsts(file: File, node: ts.Statement) {
  if (!ts.isVariableStatement(node)) return;
  for (const item of node.declarationList.declarations) {
    if (ts.isIdentifier(item.name) && item.initializer) {
      file.consts.set(item.name.text, item.initializer);
    }
  }
}

/** Hooks objects passed by name: `capsule({ hooks: queueSink })`. */
function readHooks(file: File, node: ts.Node) {
  if (!ts.isPropertyAssignment(node) || textOf(node.name) !== "hooks") return;
  if (ts.isIdentifier(node.initializer) && coreCall(file, node.parent) === "capsule") {
    file.hooks.add(node.initializer.text);
  }
}

function readFile(pass: Pass, path: string, text: string): File {
  const kind = path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
  const file: File = {
    pass,
    path,
    source,
    core: new Map(),
    library: new Set(),
    app: new Map(),
    mains: new Set(),
    hooks: new Set(),
    consts: new Map(),
    fns: new Map(),
  };

  for (const node of source.statements) {
    if (ts.isImportDeclaration(node)) readImport(file, node);
    if (ts.isFunctionDeclaration(node) && node.name) file.fns.set(node.name.text, node);
    readConsts(file, node);
  }
  walk(source, (node) => readHooks(file, node));
  return file;
}

function check(file: File): Check.Finding[] {
  const hits: Check.Finding[] = [];
  walk(file.source, (node) => {
    if (!isFn(node) || !node.body || passes(file, node)) return;
    hits.push({
      path: file.path,
      line: lineOf(file, node),
      rule: "tinker/plain",
      what: "a plain function",
    });
  });
  return hits;
}

/**
 * The plain-function check (Duke 2026-10-31, tinker-app #44). App code has no plain helper
 * functions: every named function is an operation, so every call is a span and its dependencies
 * come through the graph. It reads the syntax tree only, no types.
 *
 * A function passes when it is one of these:
 * - inline: no name of its own, written where it is used: a JSX attribute, a returned value, or
 *   an argument of a call inside a function, a Core call, `defineMain`, a library call, or an
 *   event registration. An IIFE, `Object.freeze(() => 1)` at the top level, or a function in an
 *   array bound to a name is not inline;
 * - a graph body: a direct option of a Core `operation`, `resource`, `tag` or `data`, or a hook
 *   of a capsule (in `capsule({ hooks })`, or in an object typed `Capsule.Hooks`);
 * - a native option: inside the options of a library call (`Bun.serve`, `createRoute`, ...).
 *   A library may come through a module resource (a Core `resource` whose factory returns
 *   `import("<package>")`): `depends: { x: thatResource }`, then `x.f({...})`,
 *   `const { f } = x; f({...})` or `new x.C({...})`;
 * - owned: named inside a passing function that returns it or hands it to a call;
 * - a React component: a capitalized function in a .tsx file that returns JSX;
 * - exempt: an item of the app's `entries`.
 *
 * A pass says who calls the function: Core, a library, React. So a call by name takes the pass
 * away (ADR 0149). A passing function that a call names is a finding, unless it is a closure
 * (it reads a name of a function around it) or an entry.
 */
export function findPlain(sources: readonly Check.Source[], entries: Check.Entries) {
  const pass: Pass = { files: new Map(), verdicts: new Map(), entries };
  for (const { path, text } of sources) pass.files.set(stem(path), readFile(pass, path, text));

  const files = [...pass.files.values()];
  return [...files.flatMap(check), ...calledOnce(files)];
}
