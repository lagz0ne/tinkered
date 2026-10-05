/**
 * Rename the private fields only Core reads and writes to short names, at build time
 * (core/size-build).
 *
 * oxc, the build's minifier, never renames a property, so `layer` and `pending` ship in full at
 * every use. This plugin renames the names in `private-fields.json` in every runtime chunk. The
 * build fails when a listed name is one a user can see ({@link findUnsafeNames}).
 *
 * The list is generated: `vp run core#fields` writes every runtime property name that passes the
 * same rules. A field added later keeps its long name until the list is written again, so a
 * stale list is still safe.
 *
 * The reprint drops `@__PURE__` comments; `pack.outputOptions` drops the few left. Consumers
 * tree-shake the same without them (proof: `docs/roadmap/core-v1/PROGRESS.md#coresize-build`).
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
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
  /** Keys of `attributes: {...}` literals: span, event, and log attributes users read by name. */
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
    Property: (node) => {
      if (keyName(node.key, node.computed) !== "attributes") return;
      if (node.value.type !== "ObjectExpression") return;
      for (const entry of node.value.properties) {
        const name = entry.type === "Property" ? keyName(entry.key, entry.computed) : undefined;
        if (name !== undefined) census.attributes.add(name);
      }
    },
  }).visit(program);
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

/** Every own name of a Node global, of its prototype chain, and of its class prototype. */
function builtinNames(): Set<string> {
  const names = new Set(PROTOCOL_KEYS);
  const addChain = (start: object | null) => {
    for (let at = start; at !== null; at = Object.getPrototypeOf(at) as object | null) {
      for (const name of Object.getOwnPropertyNames(at)) names.add(name);
    }
  };
  for (const name of Object.getOwnPropertyNames(globalThis)) {
    names.add(name);
    const value: unknown = Object.getOwnPropertyDescriptor(globalThis, name)?.value;
    if (typeof value === "object" && value !== null) addChain(value);
    if (typeof value !== "function") continue;
    addChain(value);
    const prototype: unknown = Object.getOwnPropertyDescriptor(value, "prototype")?.value;
    if (typeof prototype === "object") addChain(prototype);
  }
  return names;
}

/** True for a hidden or {@link SKIPPED} entry. */
function isSkipped(name: string, path: string): boolean {
  return name.startsWith(".") || SKIPPED.has(name) || SKIPPED.has(path);
}

/** Every script and TypeScript file under `dir`. */
function sourceFiles(dir: string, out: string[] = []): string[] {
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

/** The object of a member read, without the parentheses and `!` that wrap it. */
function unwrap(node: ESTree.Node): ESTree.Node {
  let at = node;
  while (at.type === "ParenthesizedExpression" || at.type === "TSNonNullExpression") {
    at = at.expression;
  }
  return at;
}

/**
 * The names one Core-importing file reads in ways types do not check: `x["name"]`,
 * `"name" in x`, a read through a cast (`(x as T).name`), or any read in untyped script.
 */
function untypedReads(file: string, program: ESTree.Program, add: (name: string) => void): void {
  const script = isScript(file);
  new Visitor({
    MemberExpression: (node) => {
      if (node.computed) {
        if (node.property.type === "Literal" && typeof node.property.value === "string") {
          add(node.property.value);
        }
        return;
      }
      const object = unwrap(node.object).type;
      if (script || object === "TSAsExpression" || object === "TSTypeAssertion") {
        add(node.property.name);
      }
    },
    BinaryExpression: (node) => {
      if (node.operator === "in" && node.left.type === "Literal") add(String(node.left.value));
    },
  }).visit(program);
}

/** True when `program` imports, re-exports, or dynamically loads Core. */
function importsCore(file: string, program: ESTree.Program): boolean {
  let found = false;
  const check = (source: ESTree.Node | null | undefined) => {
    if (source?.type === "Literal" && typeof source.value === "string") {
      found ||= isCore(source.value, file);
    }
  };
  new Visitor({
    ImportDeclaration: (node) => check(node.source),
    ExportAllDeclaration: (node) => check(node.source),
    ExportNamedDeclaration: (node) => check(node.source),
    ImportExpression: (node) => check(node.source),
  }).visit(program);
  return found;
}

/**
 * Each of `names` that a file outside Core's source reads from Core without type checks, with
 * the file. A quick text test skips the files that cannot: a typed file needs a string key, an
 * `in` check, or a read after `)`, the shape of a cast.
 */
function outsideReads(names: string[]): Map<string, string> {
  const name = `(?:${names.join("|")})`;
  const quote = "[\"'`]";
  const key = `\\[\\s*${quote}${name}${quote}\\s*\\]|${quote}${name}${quote}\\s+in\\s`;
  const typedRead = new RegExp(`${key}|\\)!?\\s*\\??\\.\\s*${name}\\b`);
  const scriptRead = new RegExp(`${key}|\\.\\s*${name}\\b`);
  const reads = new Map<string, string>();
  for (const file of OUTSIDE.flatMap((dir) => sourceFiles(join(ROOT, dir)))) {
    const code = readFileSync(file, "utf8");
    if (!(isScript(file) ? scriptRead : typedRead).test(code)) continue;
    const { program } = parseSync(file, code);
    if (!importsCore(file, program)) continue;
    untypedReads(file, program, (read) => {
      if (!reads.has(read)) reads.set(read, relative(ROOT, file));
    });
  }
  return reads;
}

/**
 * Why each of `names` is unsafe to rename; a name absent from the result is safe.
 *
 * - In the public types: users read and write it.
 * - A string in the runtime: a computed key or an `in` check the rename would miss.
 * - A user-visible attribute key: span, event, and log attributes are untyped records.
 * - A built-in or host name: the object may not be Core's.
 * - Read outside Core's source without type checks (a cast, a string key, untyped script).
 */
function findUnsafeNames(names: string[], census: Census): Map<string, string> {
  const builtins = builtinNames();
  const outside = outsideReads(names);
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
  return new RegExp(`^(?:${listed.join("|")})$`);
}

/**
 * The plugin. `CORE_PRIVATE_FIELDS=write` skips the rename and writes the list instead.
 */
export function privateFields(): Rolldown.Plugin {
  const write = process.env.CORE_PRIVATE_FIELDS === "write";
  const listed = write ? [] : (JSON.parse(readFileSync(LIST_FILE, "utf8")) as string[]);
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
        const unsafe = findUnsafeNames([...census.props], census);
        const safe = [...census.props].filter((name) => !unsafe.has(name)).toSorted();
        writeFileSync(LIST_FILE, `${JSON.stringify(safe, null, 2)}\n`);
        return;
      }
      const problems = [...findUnsafeNames(listed, census)].map(([name, why]) => `${name}: ${why}`);
      for (const [name, short] of Object.entries(names)) {
        if (census.props.has(short) && !(short in names)) {
          problems.push(`${name}: its short name ${short} is also a kept name`);
        }
      }
      if (problems.length > 0) {
        this.error(
          `private-fields.json lists names that must not be renamed:\n  ${problems.join("\n  ")}\n` +
            "Run `vp run core#fields` to write the list again.",
        );
      }
    },
  };
}
