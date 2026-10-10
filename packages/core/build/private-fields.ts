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
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

/** The name a parameter binds, or `""` for a pattern or a rest element. */
function paramName(param: ESTree.Node): string {
  const bound = param.type === "AssignmentPattern" ? param.left : param;
  return bound.type === "Identifier" ? bound.name : "";
}

/** The name of a function a call invokes: `f` in `f()`, `m` in `o.m()`; `undefined` otherwise. */
function calleeName(call: ESTree.CallExpression): string | undefined {
  if (call.callee.type === "Identifier") return call.callee.name;
  if (call.callee.type !== "MemberExpression") return undefined;
  return keyName(call.callee.property, call.callee.computed);
}

/**
 * Add to `keys` the keys of every object a chunk passes as `attributes`: span, event, and log
 * attributes are untyped records users read by name. It follows a literal, a variable (by name,
 * wider than scopes), `v.key =` writes, spreads, both sides of `?:`, `??`, and `||`, and the
 * argument a call passes to a parameter that flows on: `f(x)` feeds `x` to the parameter `f` names
 * in that position (by the callee's name, wider than scopes).
 */
function attributeKeys(program: ESTree.Program, keys: Set<string>): void {
  const flow: Flow = { values: new Map(), writes: new Map(), roots: [], seen: new Set(), keys };
  const signatures = new Map<string, string[][]>();
  const calls: ESTree.CallExpression[] = [];
  const signature = (name: string | undefined, params: ESTree.Node[]) => {
    if (name !== undefined) push(signatures, name, params.map(paramName));
  };
  new Visitor({
    FunctionDeclaration: (node) => signature(node.id?.name, node.params),
    VariableDeclarator: (node) => {
      if (node.init !== null) noteAssignment(node.id, node.init, flow);
      if (node.init?.type === "ArrowFunctionExpression" || node.init?.type === "FunctionExpression")
        signature(node.id.type === "Identifier" ? node.id.name : undefined, node.init.params);
    },
    AssignmentExpression: (node) => noteAssignment(node.left, node.right, flow),
    Property: (node) => {
      const key = keyName(node.key, node.computed);
      if (key === "attributes") flow.roots.push(node.value);
      if (node.value.type === "FunctionExpression" || node.value.type === "ArrowFunctionExpression")
        signature(key, node.value.params);
    },
    MethodDefinition: (node) => signature(keyName(node.key, node.computed), node.value.params),
    CallExpression: (node) => calls.push(node),
  }).visit(program);
  for (const call of calls) {
    const name = calleeName(call);
    if (name === undefined) continue;
    for (const params of signatures.get(name) ?? []) {
      params.forEach((param, at) => {
        const arg = call.arguments[at];
        if (param !== "" && arg !== undefined) push(flow.values, param, arg);
      });
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
    case "TSNonNullExpression":
    case "ChainExpression":
    case "TSSatisfiesExpression":
      return node.expression;
    default:
      return undefined;
  }
}

/**
 * True when `node`'s value came from a cast or an `any`: `(x as T).a.b()`, a variable in `casts`,
 * or a call to a name in `casts` (a function that returns `any`).
 */
function isFromCast(node: ESTree.Node, casts: Set<string>): boolean {
  let at: ESTree.Node | undefined = node;
  while (at !== undefined) {
    if (at.type === "TSAsExpression" || at.type === "TSTypeAssertion") return true;
    if (at.type === "Identifier") return casts.has(at.name);
    if (at.type === "CallExpression") {
      const name = calleeName(at);
      if (name !== undefined && casts.has(name)) return true;
    }
    at = inner(at);
  }
  return false;
}

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

/** True for a name or destructuring pattern typed `any`. */
function isAnyBinding(binding: ESTree.Node): boolean {
  const bound = binding.type === "AssignmentPattern" ? binding.left : binding;
  if (
    bound.type !== "Identifier" &&
    bound.type !== "ObjectPattern" &&
    bound.type !== "ArrayPattern"
  )
    return false;
  return bound.typeAnnotation?.typeAnnotation.type === "TSAnyKeyword";
}

/**
 * The variables in a typed file whose value came from a cast: `const raw = x as T`, then
 * anything taken from `raw` (`const y = raw.list`, `const { z } = raw`), however long the chain.
 * A binding typed `any` (a parameter or a variable) and a call to a function or method typed to
 * return `any` count as casts too. One name stands for every variable so named in the file: wider
 * than scopes, never narrower.
 */
function castVariables(program: ESTree.Program): Set<string> {
  const flows: { value: ESTree.Node; names: string[] }[] = [];
  const casts = new Set<string>();
  const addAny = (binding: ESTree.Node) => {
    if (isAnyBinding(binding)) for (const name of patternNames(binding)) casts.add(name);
  };
  const addReturnsAny = (name: string | undefined, fn: ESTree.Node) => {
    if (
      name !== undefined &&
      "returnType" in fn &&
      fn.returnType?.typeAnnotation.type === "TSAnyKeyword"
    )
      casts.add(name);
  };
  const addParams = (node: { params: ESTree.ParamPattern[] }) => node.params.forEach(addAny);
  new Visitor({
    VariableDeclarator: (node) => {
      if (node.init !== null) flows.push({ value: node.init, names: patternNames(node.id) });
      addAny(node.id);
      if (node.id.type === "Identifier" && node.init !== null)
        addReturnsAny(node.id.name, node.init);
    },
    AssignmentExpression: (node) =>
      flows.push({ value: node.right, names: patternNames(node.left) }),
    FunctionDeclaration: (node) => {
      addParams(node);
      addReturnsAny(node.id?.name, node);
    },
    TSDeclareFunction: (node) => {
      addParams(node);
      addReturnsAny(node.id?.name, node);
    },
    FunctionExpression: addParams,
    ArrowFunctionExpression: addParams,
    MethodDefinition: (node) => addReturnsAny(keyName(node.key, node.computed), node.value),
    TSMethodSignature: (node) => addReturnsAny(keyName(node.key, node.computed), node),
  }).visit(program);
  for (let size = -1; size !== casts.size;) {
    size = casts.size;
    for (const flow of flows) {
      if (isFromCast(flow.value, casts)) for (const name of flow.names) casts.add(name);
    }
  }
  return casts;
}

/**
 * The names one Core-importing file may read in ways types do not check:
 *
 * - any string or plain template literal, including computed keys and reflection calls;
 * - in a script, every member read and destructured key;
 * - in a typed file, a member read or destructured key on a value that came from a cast or an
 *   `any`, directly or through variables ({@link castVariables});
 * - a read below `@ts-expect-error` or `@ts-ignore`, or in a `@ts-nocheck` file.
 */
function untypedReads(
  file: string,
  program: ESTree.Program,
  suppressed: (offset: number) => boolean,
  add: (name: string) => void,
): void {
  const script = isScript(file);
  const casts = script ? new Set<string>() : castVariables(program);
  const untyped = (value: ESTree.Node) => script || isFromCast(value, casts);
  const destructure = (pattern: ESTree.Node, value: ESTree.Node | null) => {
    const unchecked = script || isAnyBinding(pattern) || (value !== null && untyped(value));
    for (const key of patternKeys(pattern)) {
      if (unchecked || suppressed(key.start)) add(key.name);
    }
  };
  const params = (node: { params: ESTree.ParamPattern[] }) => {
    for (const param of node.params) destructure(param, null);
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

/**
 * Each of `names` that a file under `root`, outside Core's source, may read from Core without
 * type checks ({@link untypedReads}), with the file. A quick text test parses only the files
 * that may load Core and use one of `names` as a word.
 */
function outsideReads(names: string[], root: string): Map<string, string> {
  const loads = /@tinker\/core|\/(src|dist)\/|import\s*\(/;
  const uses = new RegExp(`(?<![\\w$])(?:${names.map(escapeName).join("|")})(?![\\w$])`);
  const reads = new Map<string, string>();
  for (const file of OUTSIDE.flatMap((dir) => sourceFiles(join(root, dir)))) {
    const code = readFileSync(file, "utf8");
    if (!loads.test(code) || !uses.test(code)) continue;
    const { program, comments } = parseSync(file, code);
    if (!importsCore(file, program)) continue;
    untypedReads(file, program, suppressedLines(code, comments), (read) => {
      if (!reads.has(read)) reads.set(read, relative(root, file));
    });
  }
  return reads;
}

/**
 * Why each of `names` is unsafe to rename; a name absent from the result is safe.
 *
 * - In the public types: users read and write it.
 * - A string in the runtime: a computed key or an `in` check the rename would miss.
 * - A user-visible attribute key ({@link attributeKeys}).
 * - A built-in or host name: the object may not be Core's.
 * - Read outside Core's source without type checks ({@link untypedReads}).
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
