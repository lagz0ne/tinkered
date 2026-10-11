/**
 * Rename the private fields only Core reads and writes to short names, at build time
 * (core/size-build).
 *
 * oxc, the build's minifier, never renames a property, so `layer` and `pending` ship in full at
 * every use. This plugin renames the names in `private-fields.json` in every runtime chunk. The
 * build fails when a listed name is one a user can see ({@link findUnsafeNames}).
 *
 * The list is generated: `vp run core#fields` writes every runtime property name that passes the
 * same rules. A field added later keeps its long name until the list is written again. A listed
 * name that leaves the runtime fails the build, so a person reads the list again before an old
 * name can come back as a key users see.
 *
 * The reprint drops `@__PURE__` comments; `pack.outputOptions` drops the few left. Consumers
 * tree-shake the same without them (proof: `docs/roadmap/core-v1/PROGRESS.md#coresize-build`).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SyntaxKind, type Node as TsNode } from "typescript/unstable/ast";
import {
  API,
  type Checker,
  SignatureKind,
  type Type,
  type TypeReference,
  TypeFlags,
} from "typescript/unstable/sync";
import { minifySync, parseSync, Visitor } from "vite-plus";
import type { ESTree, Rolldown } from "vite-plus";

const LIST_FILE = fileURLToPath(new URL("./private-fields.json", import.meta.url));
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CORE = join(ROOT, "packages/core");
/** The folders whose code may import Core: every read there of a listed name is a user read. */
const OUTSIDE = ["apps", "packages", "tools", "scripts", "bench", "examples"];
/** Generated or third-party code, and Core's own source, which the rename covers. */
const SKIPPED = new Set(["node_modules", "dist", "vendor", join(CORE, "src"), join(CORE, "build")]);

/**
 * The checker's options: the repo's strict, bundler-resolved settings. `@tinker/core` resolves to
 * Core's source, so the check never waits on Core's own built output.
 */
const CHECK_OPTIONS = {
  target: "esnext",
  module: "esnext",
  moduleResolution: "bundler",
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  jsx: "preserve",
  types: ["node"],
  typeRoots: [join(CORE, "node_modules/@types")],
  paths: {
    "@tinker/core": [join(CORE, "src/index.ts")],
    "@tinker/core/testing": [join(CORE, "src/testing.ts")],
  },
};

/**
 * Keys the language or the host gives a plain object, so no built-in prototype owns them:
 * iterator results, settled promises, error instances, property descriptors, listener objects
 * and options, regex matches, template objects.
 */
const PROTOCOL_KEYS = [
  "done",
  "value",
  "status",
  "reason",
  "errors",
  "error",
  "suppressed",
  "cause",
  "stack",
  "get",
  "set",
  "writable",
  "enumerable",
  "configurable",
  "handleEvent",
  "once",
  "passive",
  "capture",
  "signal",
  "index",
  "input",
  "groups",
  "indices",
  "raw",
  "lastIndex",
];

/** What the rules read from one build, taken before the rename. */
type Census = {
  /** Property names in the runtime chunks: reads, writes, object keys, class members. */
  props: Set<string>;
  /** String literals and template text in the runtime chunks: a computed key the rename misses. */
  strings: Set<string>;
  /** Keys of the objects passed as `attributes` ({@link attributeKeys}). */
  attributes: Set<string>;
  /** Names in the emitted type files, except parameter names, which never become keys. */
  typed: Set<string>;
};

/** The non-computed name of a key or member, or `undefined` for a computed or private one. */
function keyName(key: ESTree.Node, computed: boolean): string | undefined {
  return !computed && key.type === "Identifier" ? key.name : undefined;
}

/** Add every property name in `program` to `counts`, once per use. */
function countProps(program: ESTree.Program, counts: Map<string, number>): void {
  const add = (name: string | undefined) => {
    if (name !== undefined) counts.set(name, (counts.get(name) ?? 0) + 1);
  };
  const member = (
    node: ESTree.MethodDefinition | ESTree.PropertyDefinition | ESTree.AccessorProperty,
  ) => add(keyName(node.key, node.computed));
  new Visitor({
    MemberExpression: (node) => add(keyName(node.property, node.computed)),
    Property: (node) => add(keyName(node.key, node.computed)),
    PropertyDefinition: member,
    MethodDefinition: member,
    AccessorProperty: member,
  }).visit(program);
}

/** Read one runtime chunk into the census. */
function readRuntime(fileName: string, code: string, census: Census): void {
  const { program } = parseSync(fileName, code);
  const counts = new Map<string, number>();
  countProps(program, counts);
  for (const name of counts.keys()) census.props.add(name);
  new Visitor({
    Literal: (node) => {
      if (typeof node.value === "string") census.strings.add(node.value);
    },
    TemplateLiteral: (node) => {
      for (const quasi of node.quasis) census.strings.add(quasi.value.cooked ?? quasi.value.raw);
    },
  }).visit(program);
  attributeKeys(program, census.attributes);
}

/** What one chunk assigns, for {@link attributeKeys}: values and `v.key =` writes per name. */
type Flow = {
  values: Map<string, ESTree.Node[]>;
  writes: Map<string, string[]>;
  /** The values passed as `attributes`. */
  roots: ESTree.Node[];
  /** Variables already followed. */
  seen: Set<string>;
  keys: Set<string>;
};

/** Add `item` to the list under `name`. */
function push<T>(map: Map<string, T[]>, name: string, item: T): void {
  map.set(name, [...(map.get(name) ?? []), item]);
}

/** Note one assignment: a variable's new value, a `v.key =` write, or `x.attributes =`. */
function noteAssignment(left: ESTree.Node, right: ESTree.Node, flow: Flow): void {
  if (left.type === "Identifier") push(flow.values, left.name, right);
  if (left.type !== "MemberExpression") return;
  const key = keyName(left.property, left.computed);
  if (key === "attributes") flow.roots.push(right);
  if (key !== undefined && left.object.type === "Identifier")
    push(flow.writes, left.object.name, key);
}

/** Add the keys of every object `node` can be to `flow.keys`. */
function follow(node: ESTree.Node, flow: Flow): void {
  if (node.type === "ObjectExpression") followObject(node, flow);
  else if (node.type === "Identifier") followVariable(node.name, flow);
  else if (node.type === "ConditionalExpression") {
    follow(node.consequent, flow);
    follow(node.alternate, flow);
  } else if (node.type === "LogicalExpression") {
    follow(node.left, flow);
    follow(node.right, flow);
  }
}

/** {@link follow} for `{ ... }`: its keys, and the objects it spreads. */
function followObject(node: ESTree.ObjectExpression, flow: Flow): void {
  for (const entry of node.properties) {
    if (entry.type === "SpreadElement") follow(entry.argument, flow);
    else {
      const key = keyName(entry.key, entry.computed);
      if (key !== undefined) flow.keys.add(key);
    }
  }
}

/** {@link follow} for a variable: every value it is given, and every key written on it. */
function followVariable(name: string, flow: Flow): void {
  if (flow.seen.has(name)) return;
  flow.seen.add(name);
  for (const value of flow.values.get(name) ?? []) follow(value, flow);
  for (const key of flow.writes.get(name) ?? []) flow.keys.add(key);
}

/** A name one parameter gives an argument: the whole argument, or its `key` property. */
type Binding = { name: string; at: number; rest: boolean; key?: string };

/**
 * The names a parameter at position `at` gives: a plain name, a rest name, or the names a `{ ... }`
 * pattern takes from the keys of its argument. A nested pattern is left out.
 */
function bindingsOf(param: ESTree.Node, at: number): Binding[] {
  if (param.type === "AssignmentPattern") return bindingsOf(param.left, at);
  if (param.type === "Identifier") return [{ name: param.name, at, rest: false }];
  if (param.type === "RestElement" && param.argument.type === "Identifier")
    return [{ name: param.argument.name, at, rest: true }];
  if (param.type !== "ObjectPattern") return [];
  return param.properties.flatMap((entry) => {
    if (entry.type !== "Property") return [];
    const key = keyName(entry.key, entry.computed);
    const value = entry.value.type === "AssignmentPattern" ? entry.value.left : entry.value;
    return key !== undefined && value.type === "Identifier"
      ? [{ name: value.name, at, rest: false, key }]
      : [];
  });
}

/** The name of a function or an object: `f` in `f` or `o.f`, `m` in `o.m`; `undefined` otherwise. */
function nameOf(node: ESTree.Node): string | undefined {
  if (node.type === "Identifier") return node.name;
  if (node.type !== "MemberExpression") return undefined;
  return keyName(node.property, node.computed);
}

/** The name a call reaches: `f` in `f()`, `m` in `o.m()`, `F` in `new F()`; `undefined` otherwise. */
function calleeName(call: ESTree.CallExpression | ESTree.NewExpression): string | undefined {
  return nameOf(call.callee);
}

/** A call's target: the name of the function it reaches, and the arguments it passes that function. */
type Target = { name: string; args: ESTree.Node[] };

/**
 * The function a call reaches, and the arguments it passes it: `f(x)`, `o.m(x)`, and `new F(x)`.
 * `super(x)` reaches the superclass `superName` names. `f.call(t, x)` and `f.bind(t, x)` reach `f`
 * with `x`; `f.apply(t, [x])` reaches `f` with the items of the list.
 */
function invoked(
  call: ESTree.CallExpression | ESTree.NewExpression,
  superName: string | undefined,
): Target | undefined {
  const args = call.arguments.map((arg) => (arg.type === "SpreadElement" ? arg.argument : arg));
  if (call.type === "CallExpression" && call.callee.type === "Super") {
    return superName === undefined ? undefined : { name: superName, args };
  }
  const name = calleeName(call);
  if (name === undefined) return undefined;
  const { callee } = call;
  const target = callee.type === "MemberExpression" ? nameOf(callee.object) : undefined;
  return target === undefined ? { name, args } : forwarded(name, target, args);
}

/**
 * The target of `name` called on `target`: `apply`, `call`, and `bind` reach `target` itself, with
 * the arguments they pass on; any other call reaches `name`.
 */
function forwarded(name: string, target: string, args: ESTree.Node[]): Target {
  if (name === "apply") return { name: target, args: listItems(args) };
  if (name === "call" || name === "bind") return { name: target, args: args.slice(1) };
  return { name, args };
}

/** The items of the list literal a call passes second, as `f.apply(t, [x])` does. */
function listItems(args: ESTree.Node[]): ESTree.Node[] {
  const [, list] = args;
  if (list?.type !== "ArrayExpression") return [];
  return list.elements.flatMap((item) =>
    item === null || item.type === "SpreadElement" ? [] : [item],
  );
}

/**
 * The functions a program declares by name, with the parameters each takes, and every call in it
 * resolved to its target. A class takes its constructor's parameters, and `super(...)` reaches the
 * class's superclass by its name.
 */
function callTargets(program: ESTree.Program): {
  signatures: Map<string, Binding[][]>;
  targets: Target[];
} {
  const signatures = new Map<string, Binding[][]>();
  const calls: { call: ESTree.CallExpression | ESTree.NewExpression; superName?: string }[] = [];
  /** The superclass name of each class around the visit, innermost last. */
  const supers: (string | undefined)[] = [];
  const signature = (name: string | undefined, params: ESTree.Node[]) => {
    if (name !== undefined) push(signatures, name, params.flatMap(bindingsOf));
  };
  /** A class takes the arguments of its constructor: `new F(x)` reaches it (`class` or `var F = class`). */
  const classSignature = (name: string | undefined, node: ESTree.Class) => {
    const ctor = node.body.body.find(
      (member) => member.type === "MethodDefinition" && member.kind === "constructor",
    );
    if (ctor?.type === "MethodDefinition") signature(name, ctor.value.params);
  };
  /** A variable given a function or a class: calls to its name reach that function or constructor. */
  const initSignature = (name: string | undefined, init: ESTree.Expression) => {
    if (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression")
      signature(name, init.params);
    if (init.type === "ClassExpression") classSignature(name, init);
  };
  const superOf = (node: ESTree.Class) => (node.superClass ? nameOf(node.superClass) : undefined);
  new Visitor({
    FunctionDeclaration: (node) => signature(node.id?.name, node.params),
    ClassDeclaration: (node) => {
      classSignature(node.id?.name, node);
      supers.push(superOf(node));
    },
    "ClassDeclaration:exit": () => supers.pop(),
    ClassExpression: (node) => supers.push(superOf(node)),
    "ClassExpression:exit": () => supers.pop(),
    VariableDeclarator: (node) => {
      if (node.init !== null)
        initSignature(node.id.type === "Identifier" ? node.id.name : undefined, node.init);
    },
    Property: (node) => {
      const key = keyName(node.key, node.computed);
      if (node.value.type === "FunctionExpression" || node.value.type === "ArrowFunctionExpression")
        signature(key, node.value.params);
    },
    MethodDefinition: (node) => signature(keyName(node.key, node.computed), node.value.params),
    CallExpression: (node) => calls.push({ call: node, superName: supers.at(-1) }),
    NewExpression: (node) => calls.push({ call: node }),
  }).visit(program);
  const targets: Target[] = [];
  for (const { call, superName } of calls) {
    const target = invoked(call, superName);
    if (target !== undefined) targets.push(target);
  }
  return { signatures, targets };
}

/** Feed the arguments one parameter gets into {@link attributeKeys}: the whole value, or one key. */
function bindArgs(binding: Binding, args: ESTree.Node[], flow: Flow): void {
  const got = binding.rest ? args.slice(binding.at) : args.slice(binding.at, binding.at + 1);
  for (const arg of got) {
    const value = binding.key === undefined ? arg : propertyValue(arg, binding.key);
    if (value !== undefined) push(flow.values, binding.name, value);
  }
}

/** The value a `{ ... }` literal gives `key`, or `undefined` when it does not give one. */
function propertyValue(node: ESTree.Node, key: string): ESTree.Node | undefined {
  if (node.type !== "ObjectExpression") return undefined;
  for (const entry of node.properties) {
    if (entry.type === "Property" && keyName(entry.key, entry.computed) === key) return entry.value;
  }
  return undefined;
}

/**
 * Add to `keys` the keys of every object a chunk passes as `attributes`: span, event, and log
 * attributes are untyped records users read by name. It follows a literal, a variable (by name,
 * wider than scopes), `v.key =` writes, spreads, both sides of `?:`, `??`, and `||`, and the
 * argument a call passes to a parameter that flows on: `f(x)` feeds `x` to the parameter `f` names
 * in that position (by the callee's name, wider than scopes). A call is `f(x)`, `o.m(x)`,
 * `new F(x)`, `super(x)`, `f.call`, `f.apply`, or `f.bind` ({@link invoked}). A parameter is a name,
 * a rest name, or one key of a `{ ... }` pattern ({@link bindingsOf}).
 */
function attributeKeys(program: ESTree.Program, keys: Set<string>): void {
  const flow: Flow = { values: new Map(), writes: new Map(), roots: [], seen: new Set(), keys };
  new Visitor({
    VariableDeclarator: (node) => {
      if (node.init !== null) noteAssignment(node.id, node.init, flow);
    },
    AssignmentExpression: (node) => noteAssignment(node.left, node.right, flow),
    Property: (node) => {
      if (keyName(node.key, node.computed) === "attributes") flow.roots.push(node.value);
    },
  }).visit(program);
  const { signatures, targets } = callTargets(program);
  for (const target of targets) {
    for (const bindings of signatures.get(target.name) ?? []) {
      for (const binding of bindings) bindArgs(binding, target.args, flow);
    }
  }
  for (const root of flow.roots) follow(root, flow);
}

/** Read one emitted type file into the census: every name, minus parameter names. */
function readTypes(fileName: string, code: string, census: Census): void {
  const params = new Set<ESTree.Node>();
  const addParams = (node: { params: ESTree.Node[] | ESTree.ParamPattern[] }) => {
    for (const param of node.params) {
      params.add(param.type === "RestElement" ? param.argument : param);
    }
  };
  new Visitor({
    TSDeclareFunction: addParams,
    TSEmptyBodyFunctionExpression: addParams,
    FunctionDeclaration: addParams,
    TSMethodSignature: addParams,
    TSFunctionType: addParams,
    TSCallSignatureDeclaration: addParams,
    TSConstructSignatureDeclaration: addParams,
    TSConstructorType: addParams,
    TSTypeParameter: (node) => params.add(node.name),
    Identifier: (node) => {
      if (!params.has(node)) census.typed.add(node.name);
    },
    Literal: (node) => {
      if (typeof node.value === "string") census.typed.add(node.value);
    },
  }).visit(parseSync(fileName, code, { lang: "dts" }).program);
}

/**
 * Prints every own name of a global, of its prototype chain, and of its class prototype.
 * {@link builtinNames} runs it in a plain Node process.
 */
const WALK_GLOBALS = `
const names = new Set();
const addChain = (start) => {
  for (let at = start; at !== null; at = Object.getPrototypeOf(at)) {
    for (const name of Object.getOwnPropertyNames(at)) names.add(name);
  }
};
for (const name of Object.getOwnPropertyNames(globalThis)) {
  names.add(name);
  const value = Object.getOwnPropertyDescriptor(globalThis, name)?.value;
  if ((typeof value === "object" && value !== null) || typeof value === "function") addChain(value);
  if (typeof value !== "function") continue;
  const prototype = Object.getOwnPropertyDescriptor(value, "prototype")?.value;
  if (typeof prototype === "object" && prototype !== null) addChain(prototype);
}
process.stdout.write(JSON.stringify([...names]));
`;

/**
 * The names of Node's built-ins and host objects, plus {@link PROTOCOL_KEYS}. A child process
 * with no environment reads them, so globals a tool adds to this process (a test runner's) do
 * not change the result.
 */
function builtinNames(): Set<string> {
  const args = ["--input-type=module", "--eval", WALK_GLOBALS];
  const printed = execFileSync(process.execPath, args, { encoding: "utf8", env: {} });
  return new Set([...PROTOCOL_KEYS, ...(JSON.parse(printed) as string[])]);
}

/** True for a hidden or {@link SKIPPED} entry. */
function isSkipped(name: string, path: string): boolean {
  return name.startsWith(".") || SKIPPED.has(name) || SKIPPED.has(path);
}

/** Every script and TypeScript file under `dir`; none when `dir` does not exist. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (isSkipped(entry.name, path)) continue;
    if (entry.isDirectory()) sourceFiles(path, out);
    else if (/\.[cm]?[jt]sx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) out.push(path);
  }
  return out;
}

/** True when `specifier`, imported from `file`, loads Core's runtime: the package or its files. */
function isCore(specifier: string, file: string): boolean {
  if (specifier === "@tinker/core" || specifier.startsWith("@tinker/core/")) return true;
  if (!specifier.startsWith(".")) return false;
  const target = relative(CORE, resolve(dirname(file), specifier));
  return target.startsWith("src/") || target.startsWith("dist/");
}

/** True for a JavaScript file: no types check its reads. */
function isScript(file: string): boolean {
  return !/\.[cm]?tsx?$/.test(file);
}

/** One step inside `node`: the object of a member, the callee of a call, or a wrapper's body. */
function inner(node: ESTree.Node): ESTree.Node | undefined {
  switch (node.type) {
    case "MemberExpression":
      return node.object;
    case "CallExpression":
      return node.callee;
    case "ParenthesizedExpression":
    case "TSAsExpression":
    case "TSNonNullExpression":
    case "ChainExpression":
    case "TSSatisfiesExpression":
      return node.expression;
    default:
      return undefined;
  }
}

/** What a typed file's casts reach: the names whose value came from a cast, and what they keep. */
type Casts = {
  /** Names of variables and functions whose value came from a cast or from a directive. */
  names: Set<string>;
  /** `as const` assertions with another kind of cast anywhere in their subtree. */
  constCasts: Set<ESTree.TSAsExpression>;
  /** Names of getters: `x.name` is a cast when the getter's name is in `names`. */
  getters: Set<string>;
  /** The values each function returns, so a call to an inline function reaches them. */
  returns: Map<ESTree.Node, ESTree.Node[]>;
};

/** The keys a destructuring pattern reads (`{ a, b: [c] }` reads `a` and `b`), and its bindings. */
function readPattern(
  pattern: ESTree.Node,
  keys: { name: string; start: number }[],
  names: string[],
): void {
  if (pattern.type === "Identifier") names.push(pattern.name);
  else if (pattern.type === "AssignmentPattern") readPattern(pattern.left, keys, names);
  else if (pattern.type === "RestElement") readPattern(pattern.argument, keys, names);
  else if (pattern.type === "ArrayPattern") {
    for (const element of pattern.elements) if (element !== null) readPattern(element, keys, names);
  } else if (pattern.type === "ObjectPattern") readObjectPattern(pattern, keys, names);
}

/** {@link readPattern} for `{ ... }`. */
function readObjectPattern(
  pattern: Extract<ESTree.Node, { type: "ObjectPattern" }>,
  keys: { name: string; start: number }[],
  names: string[],
): void {
  for (const entry of pattern.properties) {
    if (entry.type === "RestElement") {
      readPattern(entry.argument, keys, names);
      continue;
    }
    const key = keyName(entry.key, entry.computed);
    if (key !== undefined) keys.push({ name: key, start: entry.key.start });
    readPattern(entry.value, keys, names);
  }
}

/** The keys a destructuring pattern reads. */
function patternKeys(pattern: ESTree.Node): { name: string; start: number }[] {
  const keys: { name: string; start: number }[] = [];
  readPattern(pattern, keys, []);
  return keys;
}

/** The names a destructuring pattern binds. */
function patternNames(pattern: ESTree.Node): string[] {
  const names: string[] = [];
  readPattern(pattern, [], names);
  return names;
}

/** `node` without its parentheses, `!`, and `satisfies` wrappers: `((f))` is `f`. */
function unwrapped(node: ESTree.Node): ESTree.Node {
  let at = node;
  while (
    at.type === "ParenthesizedExpression" ||
    at.type === "TSNonNullExpression" ||
    at.type === "TSSatisfiesExpression"
  )
    at = at.expression;
  return at;
}

/** True for `x as const`. */
function isConstAssertion(node: ESTree.TSAsExpression): boolean {
  const type = node.typeAnnotation;
  return (
    type.type === "TSTypeReference" &&
    type.typeName.type === "Identifier" &&
    type.typeName.name === "const"
  );
}

/**
 * Every enclosing `as const` counts when the visitor meets a different cast, including inside
 * branches and function bodies. Checked literals and nested `as const` alone stay accepted.
 */
function constAssertionsHoldingCasts(program: ESTree.Program): Set<ESTree.TSAsExpression> {
  const found = new Set<ESTree.TSAsExpression>();
  const enclosing: ESTree.TSAsExpression[] = [];
  const mark = () => enclosing.forEach((node) => found.add(node));
  new Visitor({
    TSAsExpression: (node) => {
      if (isConstAssertion(node)) enclosing.push(node);
      else mark();
    },
    "TSAsExpression:exit": (node) => {
      if (isConstAssertion(node)) enclosing.pop();
    },
    TSTypeAssertion: mark,
  }).visit(program);
  return found;
}

/** A cast assertion, including `as const` only when another cast sits anywhere inside it. */
function isAssertionCast(node: ESTree.Node, constCasts: Set<ESTree.TSAsExpression>): boolean {
  return (
    node.type === "TSTypeAssertion" ||
    (node.type === "TSAsExpression" && (!isConstAssertion(node) || constCasts.has(node)))
  );
}

/**
 * True when `node`'s value came from a cast: `(x as T).a.b()`, a variable in `casts.names`, a
 * getter whose return is a cast, a call to a name in `casts.names`, or a call to an inline function
 * whose return gives a cast. Object and array literals retain casts in their contents, including
 * under `as const`.
 */
function isFromCast(node: ESTree.Node, casts: Casts): boolean {
  let at: ESTree.Node | undefined = node;
  while (at !== undefined) {
    if (at.type === "Identifier") return casts.names.has(at.name);
    if (at.type === "ObjectExpression" || at.type === "ArrayExpression")
      return literalHoldsCast(at, casts);
    if (isCastStep(at, casts)) return true;
    at = inner(at);
  }
  return false;
}

/** A literal keeps casts in its values and spreads, even when nested inside another literal. */
function literalHoldsCast(
  node: ESTree.ObjectExpression | ESTree.ArrayExpression,
  casts: Casts,
): boolean {
  if (node.type === "ArrayExpression")
    return node.elements.some(
      (item) =>
        item !== null && isFromCast(item.type === "SpreadElement" ? item.argument : item, casts),
    );
  return node.properties.some((entry) =>
    isFromCast(entry.type === "SpreadElement" ? entry.argument : entry.value, casts),
  );
}

/** One step of {@link isFromCast}: `at` is a cast, a getter that returns one, or a call to one of those. */
function isCastStep(at: ESTree.Node, casts: Casts): boolean {
  if (isAssertionCast(at, casts.constCasts)) return true;
  if (at.type === "MemberExpression") return isCastGetter(at, casts);
  return at.type === "CallExpression" && isCastCall(at, casts);
}

/** True for `o.name` when `name` is a getter whose return is a cast. */
function isCastGetter(at: ESTree.MemberExpression, casts: Casts): boolean {
  const name = keyName(at.property, at.computed);
  return name !== undefined && casts.getters.has(name) && casts.names.has(name);
}

/** True for a call to a cast name, or to an inline function whose return is a cast. */
function isCastCall(call: ESTree.CallExpression, casts: Casts): boolean {
  const name = calleeName(call);
  if (name !== undefined && casts.names.has(name)) return true;
  const callee = unwrapped(call.callee);
  if (!isFunctionNode(callee)) return false;
  return (casts.returns.get(callee) ?? []).some((value) => isFromCast(value, casts));
}

/** True for a function expression or an arrow: the nodes that can hold a function's returns. */
function isFunctionNode(node: ESTree.Node): boolean {
  return node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression";
}

/** The innermost of `fns` that holds offset `at`: a `return` belongs to the function around it. */
function innermost(fns: ESTree.Node[], at: number): ESTree.Node | undefined {
  let found: ESTree.Node | undefined;
  for (const fn of fns) {
    if (fn.start <= at && at < fn.end && (found === undefined || fn.start > found.start)) {
      found = fn;
    }
  }
  return found;
}

/**
 * The variables and functions in a typed file whose value came from a cast:
 *
 * - `const raw = x as T`, then anything taken from `raw` (`const y = raw.list`, `const { z } = raw`),
 *   however long the chain, and a default value that is a cast;
 * - a function or method whose `return` gives a cast, and a call to it (`make()`, `api.get()`);
 * - an inline function whose return gives a cast, when it is called (`(() => x as T)()`);
 * - a getter whose return gives a cast, when it is read (`o.name`);
 * - a variable whose name or value sits on a line below `@ts-expect-error` or `@ts-ignore`: its
 *   type is the one the directive hides;
 * - a return or an expression body on such a line: the function's value is the one it hides;
 * - a parameter that receives an argument on such a line: the parameter's type is the one it hides.
 *
 * Each directive is matched at the value's own position: the returned or passed expression, not
 * the statement or the call around it. `any` is not here: the checker answers it ({@link typedReads}).
 * One name stands for every variable so named in the file: wider than scopes, never narrower.
 */
function typedCasts(program: ESTree.Program, suppressed: (offset: number) => boolean): Casts {
  const gathered = gatherCasts(program, suppressed);
  const returnsOf = returnsByFunction(gathered);
  returnFlows(gathered, returnsOf, suppressed);
  argumentCasts(program, suppressed, gathered.names);
  const casts: Casts = {
    names: gathered.names,
    constCasts: constAssertionsHoldingCasts(program),
    getters: gathered.getters,
    returns: returnsOf,
  };
  settle(casts, gathered.flows);
  return casts;
}

/** What one walk of a typed file gathers for {@link typedCasts}. */
type Gathered = {
  /** Names a directive hides at once: a declaration, an assignment, or a parameter's argument. */
  names: Set<string>;
  /** Each value and the names it is bound to, so a cast in the value makes the names casts. */
  flows: { value: ESTree.Node; names: string[] }[];
  /** Every function, so a `return` finds the one around it. */
  functions: ESTree.Node[];
  /** The name each named function or method has. */
  fnNames: Map<ESTree.Node, string>;
  /** Each `return` and the offset it starts at. */
  returned: { value: ESTree.Node; start: number }[];
  /** Names of getters: a read of one is a cast when the getter returns one. */
  getters: Set<string>;
};

/** Walk a typed file once: its bindings, functions, returns, getters, and directive lines. */
function gatherCasts(program: ESTree.Program, suppressed: (offset: number) => boolean): Gathered {
  const gathered: Gathered = {
    names: new Set(),
    flows: [],
    functions: [],
    fnNames: new Map(),
    returned: [],
    getters: new Set(),
  };
  new Visitor({
    VariableDeclarator: (node) => declared(node, gathered, suppressed),
    ReturnStatement: (node) => {
      if (node.argument) gathered.returned.push({ value: node.argument, start: node.start });
    },
    AssignmentExpression: (node) => assigned(node, gathered, suppressed),
    AssignmentPattern: (node) =>
      gathered.flows.push({ value: node.right, names: patternNames(node.left) }),
    FunctionDeclaration: (node) => {
      gathered.functions.push(node);
      nameFn(gathered, node.id?.name, node);
    },
    FunctionExpression: (node) => gathered.functions.push(node),
    ArrowFunctionExpression: (node) => gathered.functions.push(node),
    MethodDefinition: (node) => {
      const name = keyName(node.key, node.computed);
      if (node.kind === "get" && name !== undefined) gathered.getters.add(name);
      nameFn(gathered, name, node.value);
    },
    Property: (node) => {
      if (isFunctionNode(node.value))
        nameFn(gathered, keyName(node.key, node.computed), node.value);
    },
  }).visit(program);
  return gathered;
}

/** Record `fn` under `name`, so a call to the name reaches the function's returns. */
function nameFn(gathered: Gathered, name: string | undefined, fn: ESTree.Node): void {
  if (name !== undefined) gathered.fnNames.set(fn, name);
}

/**
 * A declaration's value flows to its names. A directive above the name or the value hides the
 * type of those names, so they count as casts.
 */
function declared(
  node: ESTree.VariableDeclarator,
  gathered: Gathered,
  suppressed: (offset: number) => boolean,
): void {
  const bound = patternNames(node.id);
  const value = node.init;
  if (value !== null) {
    gathered.flows.push({ value, names: bound });
    if (isFunctionNode(value))
      nameFn(gathered, node.id.type === "Identifier" ? node.id.name : undefined, value);
  }
  if (suppressed(node.id.start) || (value !== null && suppressed(value.start))) {
    for (const name of bound) gathered.names.add(name);
  }
}

/** {@link declared} for `x = y`: the value flows to the names, and a directive hides them. */
function assigned(
  node: ESTree.AssignmentExpression,
  gathered: Gathered,
  suppressed: (offset: number) => boolean,
): void {
  const bound = patternNames(node.left);
  gathered.flows.push({ value: node.right, names: bound });
  if (suppressed(node.left.start) || suppressed(node.right.start)) {
    for (const name of bound) gathered.names.add(name);
  }
}

/** The values each function returns: an arrow's expression body, and each `return` in a block. */
function returnsByFunction(gathered: Gathered): Map<ESTree.Node, ESTree.Node[]> {
  const returnsOf = new Map<ESTree.Node, ESTree.Node[]>();
  for (const fn of gathered.functions) {
    if (fn.type === "ArrowFunctionExpression" && fn.expression) returnsOf.set(fn, [fn.body]);
  }
  for (const ret of gathered.returned) {
    const owner = innermost(gathered.functions, ret.start);
    if (owner !== undefined) returnsOf.set(owner, [...(returnsOf.get(owner) ?? []), ret.value]);
  }
  return returnsOf;
}

/**
 * A function's returned values flow to its name. A `return` on a directive's line hides the type of
 * the function's value, so the name is a cast.
 */
function returnFlows(
  gathered: Gathered,
  returnsOf: Map<ESTree.Node, ESTree.Node[]>,
  suppressed: (offset: number) => boolean,
): void {
  for (const [fn, values] of returnsOf) {
    const name = gathered.fnNames.get(fn);
    if (name === undefined) continue;
    for (const value of values) {
      gathered.flows.push({ value, names: [name] });
      if (suppressed(value.start)) gathered.names.add(name);
    }
  }
}

/**
 * A parameter that receives an argument on a directive's line takes the type the directive hides.
 * The argument's own position counts, and a rest parameter takes every argument from its place on.
 */
function argumentCasts(
  program: ESTree.Program,
  suppressed: (offset: number) => boolean,
  names: Set<string>,
): void {
  const { signatures, targets } = callTargets(program);
  for (const target of targets) {
    const bindings = (signatures.get(target.name) ?? []).flat();
    target.args.forEach((arg, at) => {
      if (!suppressed(arg.start)) return;
      for (const binding of bindings) {
        if (binding.rest ? at >= binding.at : at === binding.at) names.add(binding.name);
      }
    });
  }
}

/** Add to `casts.names` every name a flow gives a cast, until a pass adds none. */
function settle(casts: Casts, flows: { value: ESTree.Node; names: string[] }[]): void {
  for (let size = -1; size !== casts.names.size;) {
    size = casts.names.size;
    for (const flow of flows) {
      if (isFromCast(flow.value, casts)) for (const name of flow.names) casts.names.add(name);
    }
  }
}

/**
 * The names one Core-importing file may read in ways types do not check:
 *
 * - any string or plain template literal, including computed keys and reflection calls;
 * - in a script, every member read and destructured key;
 * - in a typed file, a member read or destructured key on a value that came from a cast
 *   ({@link typedCasts}); the reads the checker answers `any` are {@link typedReads};
 * - a read below `@ts-expect-error` or `@ts-ignore`, or in a `@ts-nocheck` file.
 */
function untypedReads(
  file: string,
  program: ESTree.Program,
  suppressed: (offset: number) => boolean,
  add: (name: string) => void,
): void {
  const script = isScript(file);
  const casts: Casts = script
    ? { names: new Set(), constCasts: new Set(), getters: new Set(), returns: new Map() }
    : typedCasts(program, suppressed);
  const untyped = (value: ESTree.Node) => script || isFromCast(value, casts);
  const destructure = (pattern: ESTree.Node, value: ESTree.Node | null) => {
    const unchecked = script || (value !== null && untyped(value));
    for (const key of patternKeys(pattern)) {
      if (unchecked || suppressed(key.start)) add(key.name);
    }
  };
  const params = (node: { params: ESTree.ParamPattern[] }) => {
    for (const param of node.params) {
      if (param.type === "AssignmentPattern") destructure(param.left, param.right);
      else destructure(param, null);
    }
  };
  new Visitor({
    Literal: (node) => {
      if (typeof node.value === "string") add(node.value);
    },
    TemplateLiteral: (node) => {
      const [only] = node.quasis;
      if (node.expressions.length === 0 && only !== undefined)
        add(only.value.cooked ?? only.value.raw);
    },
    MemberExpression: (node) => {
      if (!node.computed && (untyped(node.object) || suppressed(node.property.start)))
        add(node.property.name);
    },
    VariableDeclarator: (node) => destructure(node.id, node.init),
    AssignmentExpression: (node) => destructure(node.left, node.right),
    CatchClause: (node) => {
      if (node.param !== null) destructure(node.param, null);
    },
    FunctionDeclaration: params,
    TSDeclareFunction: params,
    FunctionExpression: params,
    ArrowFunctionExpression: params,
  }).visit(program);
}

/** The text of an import's source, or `undefined` when code computes it. */
function specifierOf(source: ESTree.Node): string | undefined {
  if (source.type === "Literal") return typeof source.value === "string" ? source.value : undefined;
  if (source.type !== "TemplateLiteral" || source.expressions.length > 0) return undefined;
  return source.quasis[0]?.value.cooked ?? undefined;
}

/**
 * True when `program` imports, re-exports, or dynamically loads Core. An `import()` whose path
 * code computes counts: it may load Core.
 */
function importsCore(file: string, program: ESTree.Program): boolean {
  let found = false;
  const check = (source: ESTree.Node | null) => {
    if (source === null) return;
    const specifier = specifierOf(source);
    found ||= specifier === undefined || isCore(specifier, file);
  };
  new Visitor({
    ImportDeclaration: (node) => check(node.source),
    ExportAllDeclaration: (node) => check(node.source),
    ExportNamedDeclaration: (node) => check(node.source),
    ImportExpression: (node) => check(node.source),
  }).visit(program);
  return found;
}

/** `name` as regex text that matches only itself (`$` is legal in a name). */
function escapeName(name: string): string {
  return name.replace(/[$]/g, "\\$&");
}

/**
 * The offsets below `@ts-expect-error` or `@ts-ignore`, or every offset for `@ts-nocheck`.
 * Reads at these offsets lack type checks. Offsets are UTF-16, as `code` is.
 */
function suppressedLines(
  code: string,
  comments: { value: string; end: number }[],
): (offset: number) => boolean {
  if (comments.some((comment) => /@ts-nocheck\b/.test(comment.value))) return () => true;
  const lines: [number, number][] = [];
  for (const comment of comments) {
    const end = code.indexOf("\n", comment.end);
    if (end === -1 || !/@ts-(expect-error|ignore)\b/.test(comment.value)) continue;
    const next = code.indexOf("\n", end + 1);
    lines.push([end + 1, next === -1 ? code.length : next]);
  }
  return (offset) => lines.some(([from, to]) => offset >= from && offset <= to);
}

/** True when the checker answers `any` for a read of `name` on `type`: see {@link anyRead}. */
function isAny(type: Type): boolean {
  return (type.flags & TypeFlags.Any) !== 0;
}

/**
 * True when a read of `name` on `type` is `any` on the checker: the type is `any`, or no property
 * `name` exists and an index signature typed `any` answers the key. A key that no declaration and
 * no index signature gives is an error the checker reports itself; this rule does not count it.
 */
function anyRead(checker: Checker, type: Type | undefined, name: string): boolean {
  if (type === undefined) return false;
  if (isAny(type)) return true;
  const apparent = checker.getApparentType(type);
  if (apparent === undefined || checker.getPropertyOfType(apparent, name) !== undefined) {
    return false;
  }
  return checker
    .getIndexInfosOfType(apparent)
    .some((info) => (info.keyType.flags & TypeFlags.String) !== 0 && isAny(info.valueType));
}

/**
 * Add the name a read answers `any` for to `hits`: a member read, or a key of a destructuring
 * pattern or of a destructuring assignment. Only the names in `wanted` count.
 */
function checkRead(node: TsNode, checker: Checker, wanted: Set<string>, hits: string[]): void {
  if (node.kind === SyntaxKind.PropertyAccessExpression) {
    checkMember(node as MemberNode, checker, wanted, hits);
  } else if (
    node.kind === SyntaxKind.BindingElement &&
    node.parent.kind === SyntaxKind.ObjectBindingPattern
  ) {
    checkKey(node as ElementNode, checker, wanted, hits);
  } else if (isDestructuringAssignment(node)) {
    checkAssignment(node as AssignNode, checker, wanted, hits);
  } else if (node.kind === SyntaxKind.ForOfStatement) {
    checkForOf(node as ForOfNode, checker, wanted, hits);
  }
}

/** The parts of a TypeScript 7 node that {@link checkRead} reads. */
type MemberNode = TsNode & { expression: TsNode; name: TsNode };
type ElementNode = TsNode & { propertyName?: TsNode; name: TsNode };
type AssignNode = TsNode & { left: TsNode; right: TsNode };
type ForOfNode = TsNode & { initializer: TsNode; expression: TsNode; awaitModifier?: TsNode };

/** The text of a name or a string key, or `undefined` for a computed one. */
function keyText(key: TsNode): string | undefined {
  return (key as { text?: string }).text;
}

/** A member read `o.name`, when the checker answers `any` for it on `o`'s type. */
function checkMember(
  node: MemberNode,
  checker: Checker,
  wanted: Set<string>,
  hits: string[],
): void {
  const name = keyText(node.name);
  if (name === undefined || !wanted.has(name)) return;
  if (anyRead(checker, checker.getTypeAtLocation(node.expression), name)) hits.push(name);
}

/** A key of a destructuring pattern, `{ name }` or `{ name: x }`, read from the pattern's source. */
function checkKey(node: ElementNode, checker: Checker, wanted: Set<string>, hits: string[]): void {
  const name = keyText(node.propertyName ?? node.name);
  if (name === undefined || !wanted.has(name)) return;
  if (anyRead(checker, checker.getTypeAtLocation(node.parent), name)) hits.push(name);
}

/** The source read and the names one assignment walk records. */
type AssignmentRead = { checker: Checker; source: TsNode; wanted: Set<string>; hits: string[] };

/** Walk every assignment target against the part of the source it reads. */
function checkAssignment(
  node: AssignNode,
  checker: Checker,
  wanted: Set<string>,
  hits: string[],
): void {
  assignmentTarget(node.left, checker.getTypeAtLocation(node.right), {
    checker,
    source: node.right,
    wanted,
    hits,
  });
}

/** A for-of assignment reads one element of the iterable, rather than the iterable itself. */
function checkForOf(node: ForOfNode, checker: Checker, wanted: Set<string>, hits: string[]): void {
  const read = { checker, source: node.expression, wanted, hits };
  const source = checker.getTypeAtLocation(node.expression);
  const isAwait = node.awaitModifier !== undefined;
  const element = source === undefined ? undefined : elementType(source, isAwait, read);
  assignmentTarget(node.initializer, element, read);
}

/** The keys TypeScript gives `[Symbol.iterator]` and `[Symbol.asyncIterator]`; the id varies. */
const SYNC_ITERATOR = /^__@iterator@/;
const ASYNC_ITERATOR = /^__@asyncIterator@/;

/**
 * The type one for-of step reads: an array's or tuple's element by index, else the iterable's
 * element. Under `for await` a promised element is settled, as TypeScript awaits it.
 */
function elementType(source: Type, isAwait: boolean, read: AssignmentRead): Type | undefined {
  const element = sourcePart(source, undefined, true, read) ?? iteratedType(source, isAwait, read);
  return isAwait ? settled(read.checker, element) : element;
}

/**
 * The element of an iterable with no index: the value its iterator yields. The sync API has no
 * iterated-type call, so this repeats the protocol: the iterator, then its `next()` result.
 * Under `for await` the iterator is `[Symbol.asyncIterator]()`, and its `next()` gives a promise.
 */
function iteratedType(source: Type, isAwait: boolean, read: AssignmentRead): Type | undefined {
  const { checker } = read;
  const at = read.source;
  const asyncIterator = isAwait ? memberType(checker, source, ASYNC_ITERATOR, at) : undefined;
  const method = asyncIterator ?? memberType(checker, source, SYNC_ITERATOR, at);
  const result = returnOf(checker, memberType(checker, returnOf(checker, method), "next", at));
  const yielded = asyncIterator === undefined ? result : settled(checker, result);
  return yieldedType(checker, yielded, at);
}

/** The type of member `key` of `type`, read at `at`. A RegExp matches the first member name. */
function memberType(
  checker: Checker,
  type: Type | undefined,
  key: string | RegExp,
  at: TsNode,
): Type | undefined {
  const apparent = type === undefined ? undefined : checker.getApparentType(type);
  if (apparent === undefined) return undefined;
  const member =
    typeof key === "string"
      ? checker.getPropertyOfType(apparent, key)
      : checker.getPropertiesOfType(apparent).find((symbol) => key.test(symbol.escapedName));
  return member === undefined ? undefined : checker.getTypeOfSymbolAtLocation(member, at);
}

/** The return type of a function type's first call signature, or `undefined` if none. */
function returnOf(checker: Checker, type: Type | undefined): Type | undefined {
  const signatures =
    type === undefined ? [] : checker.getSignaturesOfType(type, SignatureKind.Call);
  const [signature] = signatures;
  return signature === undefined ? undefined : checker.getReturnTypeOfSignature(signature);
}

/** The type an iterator result yields: `T` of `IteratorResult<T, R>`, else its `value`. */
function yieldedType(checker: Checker, result: Type | undefined, at: TsNode): Type | undefined {
  if (result?.getAliasSymbol()?.name === "IteratorResult") {
    return result.getAliasTypeArguments()[0];
  }
  return memberType(checker, result, "value", at);
}

/** The settled type of a promise: `T` of `Promise<T>`. Any other type stands for itself. */
function settled(checker: Checker, type: Type | undefined): Type | undefined {
  if (type?.getSymbol()?.name !== "Promise") return type;
  return checker.getTypeArguments(type as TypeReference)[0];
}

/**
 * Descend object and array targets with their own source types. An assignment's target type
 * describes the variables being written, so it cannot answer whether the source read is `any`.
 */
function assignmentTarget(target: TsNode, source: Type | undefined, read: AssignmentRead): void {
  if (target.kind === SyntaxKind.ObjectLiteralExpression) {
    assignmentObject(target as TsNode & { properties: TsNode[] }, source, read);
  } else if (target.kind === SyntaxKind.ArrayLiteralExpression) {
    const array = target as TsNode & { elements: TsNode[] };
    array.elements.forEach((element, index) => {
      assignmentTarget(element, sourcePart(source, String(index), true, read), read);
    });
  } else if (isEquals(target)) {
    assignmentTarget((target as AssignNode).left, source, read);
  } else if (target.kind === SyntaxKind.SpreadElement) {
    assignmentTarget((target as TsNode & { expression: TsNode }).expression, source, read);
  }
}

/** Object keys read from the enclosing source; nested targets read from that key's value. */
function assignmentObject(
  target: TsNode & { properties: TsNode[] },
  source: Type | undefined,
  read: AssignmentRead,
): void {
  for (const property of target.properties) {
    const name = assignedKey(property);
    if (name === undefined) continue;
    if (read.wanted.has(name) && anyRead(read.checker, source, name)) read.hits.push(name);
    if (property.kind === SyntaxKind.PropertyAssignment) {
      assignmentTarget(
        (property as TsNode & { initializer: TsNode }).initializer,
        sourcePart(source, name, false, read),
        read,
      );
    }
  }
}

/** The checked type of one source property or array element; `any` keeps flowing through it. */
function sourcePart(
  source: Type | undefined,
  name: string | undefined,
  numeric: boolean,
  read: AssignmentRead,
): Type | undefined {
  if (source === undefined || isAny(source)) return source;
  const apparent = read.checker.getApparentType(source);
  if (apparent === undefined) return undefined;
  const property = name === undefined ? undefined : read.checker.getPropertyOfType(apparent, name);
  if (property !== undefined) return read.checker.getTypeOfSymbolAtLocation(property, read.source);
  const keyFlags = numeric ? TypeFlags.Number : TypeFlags.String;
  return read.checker
    .getIndexInfosOfType(apparent)
    .find((info) => (info.keyType.flags & keyFlags) !== 0)?.valueType;
}

/** The name a property of an object literal gives, when it is `name` or `name: x`. */
function assignedKey(property: TsNode): string | undefined {
  const named =
    property.kind === SyntaxKind.PropertyAssignment ||
    property.kind === SyntaxKind.ShorthandPropertyAssignment;
  return named ? keyText((property as TsNode & { name: TsNode }).name) : undefined;
}

/** True for a plain assignment; compound assignments do not destructure their source. */
function isEquals(node: TsNode): boolean {
  return (
    node.kind === SyntaxKind.BinaryExpression &&
    (node as AssignNode & { operatorToken: TsNode }).operatorToken.kind === SyntaxKind.EqualsToken
  );
}

/** True for an object or array literal on the left of `=`, a destructuring assignment. */
function isDestructuringAssignment(node: TsNode): boolean {
  if (!isEquals(node)) return false;
  const { left } = node as AssignNode;
  return (
    left.kind === SyntaxKind.ObjectLiteralExpression ||
    left.kind === SyntaxKind.ArrayLiteralExpression
  );
}

/**
 * The names each typed file reads with the checker's `any`: a member read or destructured key
 * whose object is `any`, or that only an index signature typed `any` answers ({@link anyRead}).
 * That is the question typescript-eslint's `no-unsafe-member-access` asks its checker, through the
 * same TypeScript 7 API `tsgo` builds the declarations with. The files form one project in a folder
 * under Core's `node_modules`, made for this call and removed after it; each name counts once per file.
 */
function typedReads(files: string[], names: string[]): Map<string, string[]> {
  const found = new Map<string, string[]>();
  if (files.length === 0) return found;
  const wanted = new Set(names);
  const dir = mkdtempSync(join(CORE, "node_modules", "core-guard-"));
  const config = join(dir, "tsconfig.json");
  let api: API | undefined;
  try {
    writeFileSync(config, JSON.stringify({ compilerOptions: CHECK_OPTIONS, files }));
    api = new API({ cwd: dir });
    const project = api.updateSnapshot({ openProjects: [config] }).getProjects()[0];
    if (project === undefined) throw new Error(`the checker opened no project for ${config}`);
    for (const file of files) {
      const source = project.program.getSourceFile(file);
      if (source === undefined) throw new Error(`the checker did not load ${file}`);
      const hits: string[] = [];
      const visit = (node: TsNode): void => {
        checkRead(node, project.checker, wanted, hits);
        node.forEachChild(visit);
      };
      source.forEachChild(visit);
      found.set(file, hits);
    }
  } finally {
    try {
      api?.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  return found;
}

/**
 * Each of `names` that a file under `root`, outside Core's source, may read from Core without
 * type checks, with the file. A quick text test parses only the files that may load Core and use
 * one of `names` as a word. {@link untypedReads} reads each parsed file, and {@link typedReads}
 * then asks the checker about the typed ones. A file's syntactic reads come before its checked ones.
 */
function outsideReads(names: string[], root: string): Map<string, string> {
  const uses = new RegExp(`(?<![\\w$])(?:${names.map(escapeName).join("|")})(?![\\w$])`);
  const scanned = OUTSIDE.flatMap((dir) => sourceFiles(join(root, dir))).flatMap((file) =>
    scanFile(file, uses),
  );
  const typed = typedReads(
    scanned.map((entry) => entry.file).filter((file) => !isScript(file)),
    names,
  );
  const reads = new Map<string, string>();
  for (const { file, syntactic } of scanned) {
    for (const read of [...syntactic, ...(typed.get(file) ?? [])]) {
      if (!reads.has(read)) reads.set(read, relative(root, file));
    }
  }
  return reads;
}

/**
 * The syntactic reads of one file that may load Core and uses one of the names: one entry, or none
 * for any other file. A quick text test runs before the parse.
 */
function scanFile(file: string, uses: RegExp): { file: string; syntactic: string[] }[] {
  const code = readFileSync(file, "utf8");
  if (!/@tinker\/core|\/(src|dist)\/|import\s*\(/.test(code) || !uses.test(code)) return [];
  const { program, comments } = parseSync(file, code);
  if (!importsCore(file, program)) return [];
  const syntactic: string[] = [];
  untypedReads(file, program, suppressedLines(code, comments), (read) => syntactic.push(read));
  return [{ file, syntactic }];
}

/**
 * Why each of `names` is unsafe to rename; a name absent from the result is safe.
 *
 * - In the public types: users read and write it.
 * - A string in the runtime: a computed key or an `in` check the rename would miss.
 * - A user-visible attribute key ({@link attributeKeys}).
 * - A built-in or host name: the object may not be Core's.
 * - Read outside Core's source without type checks ({@link untypedReads}, {@link typedReads}).
 */
function findUnsafeNames(names: string[], census: Census, root: string): Map<string, string> {
  const builtins = builtinNames();
  const outside = outsideReads(names, root);
  const reasons = [
    (name: string) => (census.typed.has(name) ? "in the public types" : undefined),
    (name: string) => (census.strings.has(name) ? "a string in the runtime" : undefined),
    (name: string) => (census.attributes.has(name) ? "a user-visible attribute key" : undefined),
    (name: string) => (builtins.has(name) ? "a built-in or host name" : undefined),
    (name: string) => {
      const file = outside.get(name);
      return file === undefined ? undefined : `read without type checks in ${file}`;
    },
  ];
  const unsafe = new Map<string, string>();
  for (const name of names) {
    const reason = reasons.map((why) => why(name)).find((why) => why !== undefined);
    if (reason !== undefined) unsafe.set(name, reason);
  }
  return unsafe;
}

/**
 * One short name per listed field, fixed before any chunk renders.
 *
 * Every chunk renames from this map, so `index`, `testing`, and the shared trace chunk agree,
 * and the names do not depend on the order chunks render in. oxc picks the names from a stand-in
 * program that uses each field as often as the source does: the most used get the shortest. Every
 * other property name in the source is reserved, so no short name can equal a kept one.
 */
function seedNames(listed: string[], sources: string[]): Record<string, string> {
  const counts = new Map<string, number>();
  for (const [index, code] of sources.entries()) {
    countProps(parseSync(`source-${index}.ts`, code).program, counts);
  }
  const order = listed.toSorted(
    (a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || (a < b ? -1 : 1),
  );
  const uses = order.map((name) => `o.${name};`.repeat((counts.get(name) ?? 0) + 1));
  const reserved = [...counts.keys()].filter((name) => !listed.includes(name));
  const { mangleCache = {} } = minifySync("seed.js", `let o;${uses.join("")}`, {
    module: true,
    compress: false,
    mangle: false,
    mangleProps: { include: matcher(listed), reserved },
  });
  return Object.fromEntries(
    Object.entries(mangleCache).filter((entry): entry is [string, string] => entry[1] !== false),
  );
}

/** A regex that matches exactly the listed names. */
function matcher(listed: string[]): RegExp {
  return new RegExp(`^(?:${listed.map(escapeName).join("|")})$`);
}

/** Write every runtime property name that passes the rules as the new list. */
function writeList(census: Census, root: string): void {
  const props = [...census.props];
  const unsafe = findUnsafeNames(props, census, root);
  const safe = props.filter((name) => !unsafe.has(name)).toSorted();
  writeFileSync(LIST_FILE, `${JSON.stringify(safe, null, 2)}\n`);
}

/** One line per reason the build must not rename `listed` to `names`. */
function listProblems(
  listed: string[],
  names: Record<string, string>,
  census: Census,
  root: string,
): string[] {
  const unsafe = findUnsafeNames(listed, census, root);
  const problems = [...unsafe].map(([name, why]) => `${name}: ${why}`);
  for (const name of listed) {
    if (!census.props.has(name)) problems.push(`${name}: not in the runtime any more`);
  }
  for (const [name, short] of Object.entries(names)) {
    if (census.props.has(short) && !Object.hasOwn(names, short)) {
      problems.push(`${name}: its short name ${short} is also a kept name`);
    }
  }
  return problems;
}

/**
 * The plugin. `CORE_PRIVATE_FIELDS=write` skips the rename and writes the list instead.
 *
 * @param listed - The names to rename. The guard tests pass their own.
 * @param root - The repo the outside-read rule scans. The guard tests pass a folder of plants.
 */
export function privateFields(
  listed = JSON.parse(readFileSync(LIST_FILE, "utf8")) as string[],
  root = ROOT,
): Rolldown.Plugin {
  const write = process.env.CORE_PRIVATE_FIELDS === "write";
  const include = matcher(listed);
  let census: Census;
  let names: Record<string, string>;
  return {
    name: "core-private-fields",
    renderStart() {
      census = { props: new Set(), strings: new Set(), attributes: new Set(), typed: new Set() };
      const sources = [...this.getModuleIds()]
        .filter((id) => id.endsWith(".ts") && !id.endsWith(".d.ts"))
        .toSorted()
        .map((id) => this.getModuleInfo(id)?.code ?? "");
      names = write ? {} : seedNames(listed, sources);
    },
    renderChunk(code, chunk) {
      if (chunk.fileName.endsWith(".d.mts")) {
        readTypes(chunk.fileName, code, census);
        return null;
      }
      readRuntime(chunk.fileName, code, census);
      if (write) return null;
      const result = minifySync(chunk.fileName, code, {
        module: true,
        compress: false,
        mangle: false,
        mangleProps: { include, cache: { ...names } },
        codegen: { removeWhitespace: false },
        sourcemap: true,
      });
      const [error] = result.errors;
      if (error !== undefined) this.error(error.message);
      return { code: result.code, map: result.map };
    },
    generateBundle() {
      if (write) {
        writeList(census, root);
        return;
      }
      const problems = listProblems(listed, names, census, root);
      if (problems.length > 0) {
        this.error(
          `private-fields.json lists names that must not be renamed:\n  ${problems.join("\n  ")}\n` +
            "Run `vp run core#fields` to write the list again.",
        );
      }
    },
  };
}
