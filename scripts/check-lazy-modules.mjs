import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { mkdtemp, mkdir, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript-api";

const script = fileURLToPath(import.meta.url);
const workspace = resolve(dirname(script), "..");

function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

function unwrap(node) {
  while (
    node &&
    (ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isSatisfiesExpression(node))
  )
    node = node.expression;
  return node;
}

function propertyName(node) {
  if (node && (ts.isIdentifier(node) || ts.isStringLiteral(node))) return node.text;
}

function member(object, name) {
  return object.properties.find((property) => propertyName(property.name) === name);
}

function isFunction(node) {
  return node && ts.isFunctionLike(node) && node.body !== undefined;
}

function isImport(node) {
  return ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword;
}

async function sourceFiles(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory() && !["node_modules", "__tests__"].includes(entry.name))
      files.push(...(await sourceFiles(path)));
    else if (/\.tsx?$/.test(entry.name) && !/\.(?:test|spec|d)\.|\.gen\./.test(entry.name))
      files.push(path);
  }
  return files.sort((a, b) => a.localeCompare(b));
}

const paths = new Map();

function realPath(path) {
  if (!paths.has(path)) paths.set(path, realpathSync(path));
  return paths.get(path);
}

function outside(declaration) {
  return realPath(declaration.getSourceFile().fileName).split(/[\\/]/).includes("node_modules");
}

const packages = new Map();

function packageName(path) {
  const folder = dirname(path);
  if (packages.has(folder)) return packages.get(folder);
  const manifest = join(folder, "package.json");
  const name = existsSync(manifest)
    ? JSON.parse(readFileSync(manifest, "utf8")).name
    : folder === dirname(folder)
      ? undefined
      : packageName(folder);
  packages.set(folder, name);
  return name;
}

function symbols(checker) {
  function symbolAt(node) {
    const symbol = ts.isShorthandPropertyAssignment(node.parent)
      ? checker.getShorthandAssignmentValueSymbol(node.parent)
      : checker.getSymbolAtLocation(node);
    return symbol?.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  }

  function target(node, seen = new Set()) {
    node = unwrap(node);
    if (!node) return undefined;
    const symbol = symbolAt(node);
    if (!symbol || seen.has(symbol)) return symbol;
    seen.add(symbol);
    return declarationTarget(node, symbol, seen);
  }

  function declarationTarget(node, symbol, seen) {
    const declaration = symbol.valueDeclaration;
    if (declaration && ts.isBindingElement(declaration))
      return checker.getTypeAtLocation(node).symbol ?? symbol;
    const initializer = declarationInitializer(declaration);
    return initializer ? (target(initializer, seen) ?? symbol) : symbol;
  }

  function functionBody(symbol) {
    return symbol?.declarations?.find(isFunction) ?? unwrap(symbol?.valueDeclaration?.initializer);
  }

  function ownFunction(node) {
    node = unwrap(node);
    if (!node) return undefined;
    if (isFunction(node)) return node;
    const body = functionBody(target(node));
    if (isFunction(body)) return body;
    return checker
      .getTypeAtLocation(node)
      .getCallSignatures()
      .map((signature) => signature.declaration)
      .find(isFunction);
  }

  return { target, ownFunction };
}

function coreCall(call, target) {
  if (!ts.isCallExpression(call)) return undefined;
  const symbol = target(call.expression);
  if (!["operation", "resource", "extension"].includes(symbol?.name)) return undefined;
  return symbol.declarations?.some(
    (declaration) => packageName(realPath(declaration.getSourceFile().fileName)) === "@tinker/core",
  )
    ? symbol.name
    : undefined;
}

function typePosition(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isTypeNode(parent)) return true;
    if (ts.isExpression(parent) || ts.isStatement(parent)) break;
  }
  return false;
}

function valueUse(node) {
  if (typePosition(node)) return false;
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isShorthandPropertyAssignment(parent)) return true;
  return !(parent.name === node || ts.isImportDeclaration(parent) || ts.isExportSpecifier(parent));
}

function declarationInitializer(declaration) {
  if (!declaration) return undefined;
  if (ts.isVariableDeclaration(declaration)) return declaration.initializer;
  if (ts.isBindingElement(declaration)) return declaration.parent.parent.initializer;
}

function importedName(node, checker, seen = new Set()) {
  node = unwrap(node);
  if (!node) return undefined;
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
    return importedName(node.expression, checker, seen);
  const symbol = ts.isShorthandPropertyAssignment(node.parent)
    ? checker.getShorthandAssignmentValueSymbol(node.parent)
    : checker.getSymbolAtLocation(node);
  return importedSymbol(symbol, checker, seen);
}

function importedSymbol(symbol, checker, seen) {
  if (!symbol || seen.has(symbol)) return undefined;
  seen.add(symbol);
  if (symbol.flags & ts.SymbolFlags.Alias) {
    const target = checker.getAliasedSymbol(symbol);
    return target.declarations?.some(outside) ? target : undefined;
  }
  return importedName(declarationInitializer(symbol.valueDeclaration), checker, seen);
}

function lazyFactory(factory) {
  if (!factory || !isFunction(factory)) return undefined;
  const body = unwrap(factory.body);
  if (isImport(body)) return body;
  if (!ts.isBlock(body)) return undefined;
  return body.statements.find(
    (statement) => ts.isReturnStatement(statement) && isImport(statement.expression),
  )?.expression;
}

function stringMember(object, name, text) {
  const value = member(object, name)?.initializer;
  return value && ts.isStringLiteral(value) && value.text === text;
}

function moduleKeys(object) {
  const keys = object.properties.map((property) => propertyName(property.name));
  return keys.length === 3 && ["label", "target", "factory"].every((key) => keys.includes(key));
}

function moduleArrow(factory, load) {
  return (
    ts.isArrowFunction(factory) &&
    factory.parameters.length === 0 &&
    !factory.modifiers?.length &&
    !factory.typeParameters?.length &&
    !factory.type &&
    factory.body === load
  );
}

function moduleShape(object, factory, load) {
  const path = load.arguments[0];
  return (
    path &&
    ts.isStringLiteral(path) &&
    load.arguments.length === 1 &&
    moduleKeys(object) &&
    moduleFactory(object, factory, load) &&
    stringMember(object, "label", `module:${path.text}`) &&
    stringMember(object, "target", "scope")
  );
}

function moduleFactory(object, factory, load) {
  return unwrap(member(object, "factory")?.initializer) === factory && moduleArrow(factory, load);
}

function checkLazy(object, factory, load, fail, modules) {
  const shape = moduleShape(object, factory, load);
  if (!shape)
    fail(object, 10, "lazy module must have only label, scope target, and () => import(literal)");
  const path = load.arguments[0];
  if (!path || !ts.isStringLiteral(path)) return false;
  if (modules.has(path.text))
    fail(load, 9, `duplicate module ${path.text}; first at ${modules.get(path.text)}`);
  else modules.set(path.text, location(load));
  return shape;
}

function location(node) {
  const source = node.getSourceFile();
  return `${relative(process.cwd(), source.fileName)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
}

function loaderName(name) {
  return ["require", "createRequire"].includes(name);
}

function loaderDeclaration(declaration) {
  if (!declaration) return false;
  if (loaderName(propertyName(declaration.name))) return true;
  const owner = declaration.parent;
  return (
    ts.isInterfaceDeclaration(owner) &&
    ["Require", "NodeRequire"].includes(owner.name.text) &&
    packageName(realPath(declaration.getSourceFile().fileName)) === "@types/node"
  );
}

function checkGraph(bodies, checker, target, ownFunction, fail) {
  const visited = new Set();
  function follow(node) {
    if (!node || visited.has(node) || outside(node)) return;
    visited.add(node);
    walk(node, inspect);
  }

  function inspect(node) {
    if (isImport(node)) fail(node, 8, "import() in graph code");
    if (ts.isIdentifier(node) && !typePosition(node)) inspectName(node);
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) inspectCall(node);
  }

  function inspectCall(node) {
    const declaration = checker.getResolvedSignature(node)?.declaration;
    if (loaderDeclaration(declaration)) fail(node, 8, "require/createRequire in graph code");
    if (isFunction(declaration)) follow(declaration);
    follow(ownFunction(node.expression));
  }

  function inspectName(node) {
    const symbol = target(node);
    if (loaderName(node.text) || loaderName(symbol?.name))
      fail(node, 8, `${node.text} in graph code`);
    else if (valueUse(node) && importedName(node, checker))
      fail(node, 7, `outside name ${node.text} in graph code`);
  }

  for (const body of bodies) follow(body);
}

async function check(roots) {
  const hits = new Set();
  const modules = new Map();
  const fail = (node, rule, text) => hits.add(`${location(node)} rule-${rule}: ${text}`);
  for (const root of roots) {
    const files = await sourceFiles(root);
    const configPath = ts.findConfigFile(root, (path) => ts.sys.fileExists(path));
    assert.ok(configPath, `${root}: needs a tsconfig.json`);
    const config = ts.readConfigFile(configPath, (path) => ts.sys.readFile(path));
    assert.equal(config.error, undefined, configPath);
    const parsed = ts.parseJsonConfigFileContent(
      config.config,
      ts.sys,
      dirname(configPath),
      undefined,
      configPath,
    );
    const program = ts.createProgram(files, parsed.options);
    const checker = program.getTypeChecker();
    const { target, ownFunction } = symbols(checker);
    const bodies = [];
    for (const file of files) {
      walk(program.getSourceFile(file), (node) => {
        const kind = coreCall(node, target);
        if (!kind) return;
        const object = unwrap(node.arguments[0]);
        if (!object || !ts.isObjectLiteralExpression(object)) return;
        collectBodies(kind, object, ownFunction, fail, modules, bodies);
      });
    }
    checkGraph(bodies, checker, target, ownFunction, fail);
  }
  for (const hit of [...hits].sort((a, b) => a.localeCompare(b))) console.error(hit);
  if (!hits.size) console.log("Lazy modules: OK");
  return hits.size ? 1 : 0;
}

function hookBodies(object, ownFunction, bodies) {
  const hooks = unwrap(member(object, "hooks")?.initializer);
  if (hooks && ts.isObjectLiteralExpression(hooks))
    for (const hook of hooks.properties) bodies.push(ownFunction(hook.initializer ?? hook));
}

function collectBodies(kind, object, ownFunction, fail, modules, bodies) {
  if (kind === "extension") return hookBodies(object, ownFunction, bodies);
  const property = member(object, kind === "resource" ? "factory" : "run");
  const body = ownFunction(property?.initializer ?? property);
  const load = kind === "resource" ? lazyFactory(body) : undefined;
  if (load && checkLazy(object, body, load, fail, modules)) return;
  bodies.push(body);
}

async function prove() {
  const planted = await mkdtemp(join(tmpdir(), "lazy-modules-proof-"));
  const core = 'import { operation, resource, extension } from "@tinker/core";\n';
  const outsideImport = 'import { resolve as outside } from "node:path";\n';
  const lazy =
    'resource({label: "module:node:path", target: "scope", factory: () => import("node:path")})';
  const cases = [
    {
      name: "namespace-loader",
      rule: 8,
      source:
        'import * as native from "node:module"; operation({run: () => native["createRequire"](import.meta.url)});',
    },
    {
      name: "created-require",
      rule: 8,
      source:
        'import {createRequire} from "node:module"; const load = createRequire(import.meta.url); operation({run: () => load("node:path")});',
    },
    {
      name: "dep-loader",
      rule: 8,
      source:
        'const native = resource({label: "module:node:module", target: "scope", factory: () => import("node:module")}); operation({depends: {native}, run: async ({native}) => native.createRequire(import.meta.url)});',
    },
    {
      name: "overloaded-helper",
      rule: 7,
      source: 'import {hidden} from "./helper"; operation({run: () => hidden("x")});',
      helper:
        outsideImport +
        "export function hidden(value: string): string; export function hidden(value: number): string; export function hidden(value: string | number) {return outside(String(value));}",
    },
    {
      name: "factory-alias",
      rule: 10,
      source:
        'const load = () => import("node:path"); resource({label: "module:node:path", target: "scope", factory: load});',
    },
    {
      name: "wrapped-factory",
      rule: 8,
      source: 'resource({factory: Object.freeze(() => import("node:path"))});',
    },
    {
      name: "own-overload",
      source: 'import {hidden} from "./helper"; operation({run: () => hidden("x")});',
      helper:
        "export function hidden(value: string): string; export function hidden(value: number): string; export function hidden(value: string | number) {return String(value);}",
    },
    {
      name: "own-wrapped-factory",
      source: "resource({factory: Object.freeze(() => 1)});",
    },
    {
      name: "core-namespace",
      rule: 7,
      source:
        outsideImport +
        'import * as Core from "@tinker/core"; Core.operation({run: () => outside("x")});',
    },
    {
      name: "core-destructure",
      rule: 7,
      source:
        outsideImport +
        'import * as Core from "@tinker/core"; const {operation: op} = Core; op({run: () => outside("x")});',
    },
    {
      name: "reexport",
      rule: 7,
      source: 'import {external} from "./helper"; operation({run: () => external("x")});',
      helper: 'export {resolve as external} from "node:path";',
    },
    {
      name: "helper-method",
      rule: 7,
      source: 'import {helper} from "./helper"; operation({run: () => helper.read()});',
      helper: outsideImport + 'export const helper = {read() {return outside("x");}};',
    },
    {
      name: "method-body",
      rule: 7,
      source: outsideImport + 'operation({run() {return outside("x");}});',
    },
    {
      name: "destructure",
      rule: 7,
      source:
        'import * as path from "node:path"; const {resolve: read} = path; operation({run: () => read("x")});',
    },
    { name: "component", source: outsideImport + 'export function Page() {return outside("x");}' },
    {
      name: "isomorphic",
      source:
        'import {createIsomorphicFn} from "@tanstack/react-start";' +
        outsideImport +
        'createIsomorphicFn().server(() => outside("x"));',
    },
    {
      name: "server-handler",
      source:
        'import {createServerFn} from "@tanstack/react-start";' +
        outsideImport +
        'createServerFn().handler(() => outside("x"));',
    },
    { name: "outside", rule: 7, source: outsideImport + 'operation({run: () => outside("x")});' },
    {
      name: "helper",
      rule: 7,
      source: 'import { hidden } from "./helper"; operation({run: () => hidden()});',
      helper: outsideImport + 'export function hidden() { return outside("x"); }',
    },
    {
      name: "alias",
      rule: 7,
      source: outsideImport + 'const alias = outside; operation({run: () => alias("x")});',
    },
    {
      name: "namespace",
      rule: 7,
      source: 'import * as path from "node:path"; operation({run: () => path.resolve("x")});',
    },
    {
      name: "nested",
      rule: 7,
      source: outsideImport + 'resource({factory: () => ({read: () => outside("x")})});',
    },
    {
      name: "hook",
      rule: 7,
      source: outsideImport + 'extension({hooks: {run: () => outside("x")}});',
    },
    {
      name: "core-alias",
      rule: 7,
      source: outsideImport + 'const make = operation; make({run: () => outside("x")});',
    },
    { name: "import", rule: 8, source: 'operation({run: () => import("node:path")});' },
    { name: "require", rule: 8, source: 'operation({run: () => require("node:path")});' },
    {
      name: "createRequire",
      rule: 8,
      source:
        'import {createRequire as load} from "node:module"; operation({run: () => load(import.meta.url)});',
    },
    { name: "label", rule: 10, source: lazy.replace("module:node:path", "wrong") },
    { name: "target", rule: 10, source: lazy.replace('"scope"', '"session"') },
    { name: "depends", rule: 10, source: lazy.replace("factory:", "depends: {}, factory:") },
    {
      name: "block",
      rule: 10,
      source: lazy.replace('() => import("node:path")', '() => {return import("node:path");}'),
    },
    {
      name: "literal",
      rule: 10,
      source: 'const path = "node:path"; ' + lazy.replace('import("node:path")', "import(path)"),
    },
    { name: "duplicate", rule: 9, source: lazy + ";", second: lazy + ";" },
    {
      name: "table",
      source:
        'import {pgTable, text} from "drizzle-orm/pg-core"; const table = pgTable("test", {id: text("id")}); operation({run: () => table.id});',
    },
    {
      name: "schema",
      source:
        'import {z} from "zod"; const schema = z.string(); operation({run: () => schema.safeParse("x")});',
    },
    {
      name: "type",
      source:
        'import type {Stats} from "node:fs"; operation({run: () => {const stat: Stats | null = null; return stat;}});',
    },
    {
      name: "own",
      source: 'import { hidden } from "./helper"; operation({run: () => hidden()});',
      helper: "export function hidden() { return 1; }",
    },
    { name: "lazy", source: lazy + ";" },
    {
      name: "framework",
      source:
        outsideImport +
        'const framework = {operation: (options: unknown) => options}; framework.operation({run: () => outside("x")});',
    },
    {
      name: "type-query",
      source:
        outsideImport +
        "operation({run: () => {const value: typeof outside | null = null; return value;}});",
    },
  ];
  try {
    await symlink(
      join(workspace, "packages/start/node_modules"),
      join(planted, "node_modules"),
      "dir",
    );
    await writeFile(
      join(planted, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          module: "esnext",
          moduleResolution: "bundler",
          target: "esnext",
          types: ["node"],
        },
      }),
    );
    for (const test of cases) {
      const root = join(planted, test.name);
      await mkdir(root);
      await writeFile(join(root, "probe.ts"), core + test.source);
      if (test.helper) await writeFile(join(root, "helper.ts"), test.helper);
      const roots = [root];
      if (test.second) {
        const second = join(planted, `${test.name}-second`);
        await mkdir(second);
        await writeFile(join(second, "probe.ts"), core + test.second);
        roots.push(second);
      }
      const result = spawnSync(process.execPath, [script, ...roots], { encoding: "utf8" });
      assert.equal(
        result.status,
        test.rule ? 1 : 0,
        `${test.name}: ${result.stdout}${result.stderr}`,
      );
      if (test.rule) assert.match(result.stderr, new RegExp(`rule-${test.rule}:`), test.name);
      console.log(
        `PASS ${test.name}: ${test.rule ? `rule-${test.rule}` : "allowed"} EXIT ${result.status}`,
      );
    }
    console.log(`Lazy module proof: ${cases.length} cases passed`);
  } finally {
    await rm(planted, { recursive: true, force: true });
  }
}

if (process.argv.includes("--prove")) await prove();
else {
  const roots = process.argv.slice(2).map((root) => resolve(root));
  assert.ok(roots.length, "pass at least one src root, or --prove");
  process.exitCode = await check(roots);
}
