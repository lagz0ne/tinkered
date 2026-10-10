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
    return ts.isShorthandPropertyAssignment(node.parent)
      ? checker.getShorthandAssignmentValueSymbol(node.parent)
      : checker.getSymbolAtLocation(node);
  }

  function alias(symbol) {
    const seen = new Set();
    while (symbol?.flags & ts.SymbolFlags.Alias && !seen.has(symbol)) {
      seen.add(symbol);
      symbol = checker.getImmediateAliasedSymbol(symbol);
    }
    return symbol;
  }

  function target(node, seen = new Set()) {
    node = unwrap(node);
    if (!node) return undefined;
    const symbol = alias(symbolAt(node));
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

  function executables(node, seen = new Set()) {
    node = unwrap(node);
    if (!node || seen.has(node)) return [];
    seen.add(node);
    if (isExecutable(node)) return [node];
    if (ts.isConditionalExpression(node))
      return [...executables(node.whenTrue, seen), ...executables(node.whenFalse, seen)];
    return symbolExecutables(node, seen);
  }

  function symbolExecutables(node, seen) {
    const symbol = alias(symbolAt(node));
    const declarations = symbol?.declarations ?? [];
    const bodies = declarations.filter(isExecutable);
    if (bodies.length) return bodies;
    const found = executables(declarationInitializer(symbol?.valueDeclaration), seen);
    if (found.length) return found;
    return checker
      .getTypeAtLocation(node)
      .getCallSignatures()
      .map((signature) => signature.declaration)
      .filter(isExecutable);
  }

  function property(object, name, seen = new Set()) {
    object = unwrap(object);
    if (!object || seen.has(object)) return undefined;
    seen.add(object);
    const declaration = propertyDeclaration(checker, object, name);
    const value = declarationInitializer(declaration);
    if (value) return value;
    if (isFunction(declaration)) return declaration;
    return (
      spreadProperty(object, name, seen) ?? initializedProperty(object, name, seen) ?? declaration
    );
  }

  function spreadProperty(object, name, seen) {
    if (!ts.isObjectLiteralExpression(object)) return undefined;
    for (const entry of [...object.properties].reverse()) {
      if (!ts.isSpreadAssignment(entry)) continue;
      const found = property(entry.expression, name, seen);
      if (found) return found;
    }
  }

  function initializedProperty(object, name, seen) {
    const initializer = declarationInitializer(target(object)?.valueDeclaration);
    if (initializer) return property(initializer, name, seen);
    if (coreCall(object, target)) return property(object.arguments[0], name, seen);
  }

  return { target, executables, property };
}

function propertyDeclaration(checker, object, name) {
  const symbol = checker.getTypeAtLocation(object).getProperty(name);
  return symbol?.valueDeclaration ?? symbol?.declarations?.[0];
}

function isExecutable(node) {
  return isFunction(node) || (node && (ts.isClassDeclaration(node) || ts.isClassExpression(node)));
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

function coreType(type, name, owner) {
  const symbol = type.aliasSymbol;
  if (symbol?.name !== name) return false;
  return symbol.declarations?.some(
    (declaration) =>
      propertyName(declaration.parent.parent?.name) === owner &&
      packageName(realPath(declaration.getSourceFile().fileName)) === "@tinker/core",
  );
}

function inlineParameter(signature, checker) {
  const parameter = signature?.declaration?.parameters[0];
  return parameter && coreType(checker.getTypeAtLocation(parameter), "Inline", "Scope");
}

function indirectInvocation(call) {
  const expression = unwrap(call.expression);
  if (ts.isPropertyAccessExpression(expression)) return reflectedInvocation(expression, call);
  if (ts.isCallExpression(expression)) return bindInvocation(expression, call);
}

function bindInvocation(bindCall, call) {
  const bound = unwrap(bindCall.expression);
  if (ts.isPropertyAccessExpression(bound) && bound.name.text === "bind")
    return {
      expression: bound.expression,
      object: bindCall.arguments[1] ?? call.arguments[0],
    };
}

function aliasedSymbol(node, checker) {
  node = unwrap(node);
  if (!node || !ts.isIdentifier(node)) return undefined;
  const symbol = checker.getSymbolAtLocation(node);
  return symbol?.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
}

function bindTarget(bindCall) {
  const bound = unwrap(bindCall.expression);
  if (ts.isPropertyAccessExpression(bound) && bound.name.text === "bind")
    return { expression: bound.expression, partial: bindCall.arguments[1] };
}

function boundTarget(node, checker, seen = new Set()) {
  const symbol = aliasedSymbol(node, checker);
  if (!symbol || seen.has(symbol)) return undefined;
  seen.add(symbol);
  const initializer = unwrap(declarationInitializer(symbol.valueDeclaration));
  if (initializer && ts.isCallExpression(initializer)) return bindTarget(initializer);
  return boundTarget(initializer, checker, seen);
}

function boundInvocation(call, checker) {
  const bound = boundTarget(call.expression, checker);
  return bound && { expression: bound.expression, object: bound.partial ?? call.arguments[0] };
}

function unbound(indirect, checker) {
  const bound = indirect && boundTarget(indirect.expression, checker);
  return bound
    ? { expression: bound.expression, object: bound.partial ?? indirect.object }
    : indirect;
}

function reflectedInvocation(method, call) {
  if (method.name.text === "call")
    return { expression: method.expression, object: call.arguments[1] };
  if (method.name.text !== "apply") return undefined;
  if (ts.isIdentifier(method.expression) && method.expression.text === "Reflect")
    return appliedInvocation(call.arguments[0], call.arguments[2]);
  return appliedInvocation(method.expression, call.arguments[1]);
}

function appliedInvocation(expression, list) {
  const args = unwrap(list);
  return {
    expression,
    object: args && ts.isArrayLiteralExpression(args) ? args.elements[0] : args,
  };
}

function inlineCall(call, checker) {
  if (!ts.isCallExpression(call)) return undefined;
  const indirect = unbound(indirectInvocation(call), checker) ?? boundInvocation(call, checker);
  if (!indirect)
    return inlineParameter(checker.getResolvedSignature(call), checker)
      ? { object: call.arguments[0] }
      : undefined;
  const { expression, object } = indirect;
  if (!object || coreType(checker.getTypeAtLocation(object), "Handle", "Operation"))
    return undefined;
  return checker
    .getTypeAtLocation(expression)
    .getCallSignatures()
    .some((signature) => inlineParameter(signature, checker))
    ? indirect
    : undefined;
}

function isComponent(node) {
  const name = node.name ?? node.parent.name;
  if (
    !isFunction(node) ||
    !node.getSourceFile().fileName.endsWith(".tsx") ||
    !/^[A-Z]/.test(propertyName(name) ?? "") ||
    node.parameters.length > 1
  )
    return false;
  let jsx = false;
  function inspect(child) {
    if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child))
      jsx = true;
    if (!isFunction(child)) ts.forEachChild(child, inspect);
  }
  inspect(node.body);
  return jsx;
}

function calledValue(node) {
  let value = node;
  while (value.parent && unwrap(value.parent) === value) value = value.parent;
  const parent = value.parent;
  if (callTarget(parent, value)) return true;
  return (
    ts.isPropertyAccessExpression(parent) &&
    ["call", "apply"].includes(parent.name.text) &&
    calledValue(parent)
  );
}

function callTarget(parent, value) {
  if (ts.isCallExpression(parent) || ts.isNewExpression(parent))
    return parent.expression === value || (parent.arguments?.includes(value) ?? false);
  return ts.isTaggedTemplateExpression(parent) && parent.tag === value;
}

function typePosition(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isExpressionWithTypeArguments(parent) && ts.isHeritageClause(parent.parent))
      return (
        parent.parent.token !== ts.SyntaxKind.ExtendsKeyword ||
        ts.isInterfaceDeclaration(parent.parent.parent)
      );
    if (ts.isTypeNode(parent)) return true;
    if (ts.isExpression(parent) || ts.isStatement(parent)) break;
  }
  return false;
}

function valueUse(node) {
  if (typePosition(node)) return false;
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (bindingKey(node)) return false;
  if (ts.isShorthandPropertyAssignment(parent)) return true;
  return !(parent.name === node || ts.isImportDeclaration(parent) || ts.isExportSpecifier(parent));
}

function bindingKey(node) {
  return ts.isBindingElement(node.parent) && node.parent.propertyName === node;
}

function declarationInitializer(declaration) {
  if (!declaration) return undefined;
  if (ts.isVariableDeclaration(declaration) || ts.isPropertyAssignment(declaration))
    return declaration.initializer;
  if (ts.isShorthandPropertyAssignment(declaration)) return declaration.name;
  if (ts.isBindingElement(declaration)) return declaration.parent.parent.initializer;
}

function moduleReference(declaration) {
  for (let node = declaration; node; node = node.parent) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return node.moduleSpecifier;
    if (ts.isImportEqualsDeclaration(node)) return node.moduleReference.expression;
  }
}

function ownPath(path) {
  return path.startsWith(".") || path.startsWith("#") || path.startsWith("@tinker/");
}

function importedName(node, checker, seen = new Set()) {
  node = unwrap(node);
  if (!node) return false;
  if (namespaceOutside(node, checker, seen)) return true;
  if (
    (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
    importedName(node.expression, checker, seen)
  )
    return true;
  const symbol = ts.isShorthandPropertyAssignment(node.parent)
    ? checker.getShorthandAssignmentValueSymbol(node.parent)
    : checker.getSymbolAtLocation(node);
  return importedSymbol(symbol, checker, seen);
}

function namespaceOutside(node, checker, seen) {
  if (!ts.isPropertyAccessExpression(node)) return false;
  const symbol = checker.getSymbolAtLocation(node.expression);
  return (
    symbol?.declarations?.some((declaration) => {
      if (!ts.isNamespaceImport(declaration)) return false;
      const reference = moduleReference(declaration);
      return (
        reference &&
        moduleOutside(checker.getSymbolAtLocation(reference), node.name.text, checker, seen)
      );
    }) ?? false
  );
}

function importedSymbol(symbol, checker, seen) {
  if (!symbol || seen.has(symbol)) return false;
  seen.add(symbol);
  if (
    symbol.declarations?.some((declaration) => {
      return importHopOutside(declaration, checker, seen);
    })
  )
    return true;
  if (symbol.flags & ts.SymbolFlags.Alias)
    return importedSymbol(checker.getImmediateAliasedSymbol(symbol), checker, seen);
  return importedName(declarationInitializer(symbol.valueDeclaration), checker, seen);
}

function importHopOutside(declaration, checker, seen) {
  const reference = moduleReference(declaration);
  if (!reference) return false;
  if (!ownPath(reference.text)) return true;
  const name = propertyName(declaration.propertyName ?? declaration.name);
  return (
    name !== undefined && moduleOutside(checker.getSymbolAtLocation(reference), name, checker, seen)
  );
}

function moduleOutside(module, name, checker, seen) {
  if (!module || seen.has(module)) return false;
  seen.add(module);
  const exported = checker.getExportsOfModule(module).find((symbol) => symbol.name === name);
  if (importedSymbol(exported, checker, seen)) return true;
  return (
    module.declarations?.some(
      (declaration) =>
        ts.isSourceFile(declaration) &&
        declaration.statements.some((statement) => starOutside(statement, name, checker, seen)),
    ) ?? false
  );
}

function starOutside(statement, name, checker, seen) {
  if (!ts.isExportDeclaration(statement) || statement.exportClause || !statement.moduleSpecifier)
    return false;
  if (!ownPath(statement.moduleSpecifier.text)) return true;
  return moduleOutside(checker.getSymbolAtLocation(statement.moduleSpecifier), name, checker, seen);
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
  const key = path.text.replace(/^node:/, "");
  if (modules.has(key))
    fail(load, 9, `duplicate module ${path.text}; first at ${modules.get(key)}`);
  else modules.set(key, location(load));
  return shape;
}

function location(node) {
  const source = node.getSourceFile();
  return `${relative(process.cwd(), source.fileName)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
}

function loaderDeclaration(declaration) {
  if (!declaration || packageName(realPath(declaration.getSourceFile().fileName)) !== "@types/node")
    return false;
  if (["require", "createRequire", "getBuiltinModule"].includes(propertyName(declaration.name)))
    return true;
  const owner = declaration.parent;
  return ts.isInterfaceDeclaration(owner) && ["Require", "NodeRequire"].includes(owner.name.text);
}

function checkGraph(bodies, checker, target, executables, fail) {
  const visited = new Set();
  function follow(node) {
    if (!node || visited.has(node) || node.getSourceFile().isDeclarationFile) return;
    visited.add(node);
    walk(node, inspect);
  }

  function inspect(node) {
    if (isImport(node)) fail(node, 8, "import() in graph code");
    inspectCall(node);
    if (ts.isIdentifier(node) && valueUse(node)) inspectValue(node);
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      if (!typePosition(node)) inspectValue(node);
    }
  }

  function inspectCall(node) {
    if (!ts.isCallExpression(node) && !ts.isNewExpression(node)) return;
    const declaration = checker.getResolvedSignature(node)?.declaration;
    if (loaderDeclaration(declaration)) fail(node, 8, "module loader in graph code");
  }

  function inspectValue(node) {
    const symbol = target(node);
    if (symbol?.declarations?.some(loaderDeclaration)) fail(node, 8, "module loader in graph code");
    else if (importedName(node, checker))
      fail(node, 7, `outside name ${node.getText()} in graph code`);
    else
      for (const body of executables(node)) {
        if (!isComponent(body) || calledValue(node)) follow(body);
      }
  }

  for (const body of bodies) follow(body);
}

async function check(roots) {
  const hits = new Set();
  const modules = new Map();
  const fail = (node, rule, text) =>
    hits.add(`${location(node)} ${typeof rule === "number" ? `rule-${rule}` : rule}: ${text}`);
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
    const program = ts.createProgram([...new Set([...parsed.fileNames, ...files])], parsed.options);
    const checker = program.getTypeChecker();
    const { target, executables, property } = symbols(checker);
    const bodies = [];
    for (const file of files) {
      walk(program.getSourceFile(file), (node) => {
        const declared = coreCall(node, target);
        const inline = inlineCall(node, checker);
        const kind = declared ?? (inline ? "operation" : undefined);
        if (!kind) return;
        const object = unwrap(inline ? inline.object : node.arguments[0]);
        if (!object) return fail(node, "unit-body", "unit body not found");
        collectBodies(kind, object, executables, property, checker, fail, modules, bodies, node);
      });
    }
    checkGraph(bodies, checker, target, executables, fail);
  }
  for (const hit of [...hits].sort((a, b) => a.localeCompare(b))) console.error(hit);
  if (!hits.size) console.log("Lazy modules: OK");
  return hits.size ? 1 : 0;
}

function collectBodies(kind, object, executables, property, checker, fail, modules, bodies, call) {
  function collect(value) {
    const found = executables(value).filter(isFunction);
    if (!found.length) return fail(call, "unit-body", "unit body not found");
    for (const body of found) collectBody(body);
  }
  function collectBody(body) {
    const load = kind === "resource" ? lazyFactory(body) : undefined;
    if (
      load &&
      ts.isObjectLiteralExpression(object) &&
      checkLazy(object, body, load, fail, modules)
    )
      return;
    bodies.push(body);
  }
  if (kind !== "extension")
    return collect(property(object, kind === "resource" ? "factory" : "run"));
  const hooks = property(object, "hooks");
  if (!hooks) return fail(call, "unit-body", "unit body not found");
  const members = checker.getTypeAtLocation(hooks).getProperties();
  if (!members.length) return fail(call, "unit-body", "unit body not found");
  for (const hook of members) collect(property(hooks, hook.name));
}

function extraCases(outsideImport) {
  const cases = [];
  for (const method of ["run", "settle"]) {
    for (const call of ["", ", {tags: []}", ", {signal: new AbortController().signal}"]) {
      const suffix = call.includes("tags") ? "tags" : call.includes("signal") ? "signal" : "plain";
      cases.push({
        name: `inline-${method}-${suffix}`,
        rule: 7,
        hit: "probe.ts:3",
        source:
          outsideImport +
          `const scope=createScope(); scope.${method}({run:()=>outside("x")}${call});`,
      });
    }
    cases.push(
      {
        name: `inline-${method}-named`,
        rule: 8,
        hit: "probe.ts:2",
        source: `const scope=createScope(); const spec={run:()=>import("node:path")}; scope.${method}(spec);`,
      },
      {
        name: `inline-${method}-alias`,
        rule: 7,
        hit: "probe.ts:3",
        source:
          outsideImport +
          `const scope=createScope(); const {${method}: invoke}=scope; invoke({run:()=>outside("x")});`,
      },
      {
        name: `inline-${method}-spread`,
        rule: 7,
        hit: "probe.ts:3",
        source:
          outsideImport +
          `const scope=createScope(); const spec={run:()=>outside("x")}; scope.${method}({...spec});`,
      },
      {
        name: `inline-${method}-borrowed`,
        rule: 7,
        hit: "probe.ts:3",
        source:
          outsideImport +
          `function use(scope:Scope.Handle) {scope.${method}({run:()=>outside("x")});}`,
      },
      {
        name: `inline-${method}-own`,
        source: `const scope=createScope(); scope.${method}({run:()=>1});`,
      },
      {
        name: `inline-${method}-declared`,
        source: `const scope=createScope(); const op=operation({label:"x",run:()=>1}); scope.${method}(op);`,
      },
      {
        name: `other-${method}`,
        source:
          outsideImport +
          `const other={${method}(value) {return value;}}; other.${method}({run:()=>outside("x")});`,
      },
    );
  }
  for (const method of ["run", "settle"]) {
    for (const invoke of ["call(scope,", "bind(scope)("]) {
      cases.push({
        name: `inline-${method}-${invoke.startsWith("call") ? "call" : "bind"}`,
        rule: 7,
        hit: "probe.ts:3",
        source:
          outsideImport +
          `const scope=createScope(); scope.${method}.${invoke}{run:()=>outside("x")});`,
      });
    }
    cases.push(
      {
        name: `inline-${method}-apply`,
        rule: 7,
        hit: "probe.ts:3",
        source:
          outsideImport +
          `const scope=createScope(); scope.${method}.apply(scope, [{run:()=>outside("x")}]);`,
      },
      {
        name: `inline-${method}-apply-variable`,
        tag: "unit-body",
        hit: "probe.ts:3",
        source:
          outsideImport +
          `const scope=createScope(); const specs=[{run:()=>outside("x")}]; scope.${method}.apply(scope, specs);`,
      },
      {
        name: `inline-${method}-reflect-apply`,
        rule: 7,
        hit: "probe.ts:3",
        source:
          outsideImport +
          `const scope=createScope(); Reflect.apply(scope.${method}, scope, [{run:()=>outside("x")}]);`,
      },
      {
        name: `inline-${method}-reflect-apply-variable`,
        tag: "unit-body",
        hit: "probe.ts:3",
        source:
          outsideImport +
          `const scope=createScope(); const specs=[{run:()=>outside("x")}]; Reflect.apply(scope.${method}, scope, specs);`,
      },
      {
        name: `inline-${method}-bind-variable`,
        rule: 7,
        hit: "probe.ts:3",
        source:
          outsideImport +
          `const scope=createScope(); const invoke=scope.${method}.bind(scope); invoke({run:()=>outside("x")});`,
      },
      {
        name: `inline-${method}-bind-variable-partial`,
        rule: 7,
        hit: "probe.ts:3",
        source:
          outsideImport +
          `const scope=createScope(); const invoke=scope.${method}.bind(scope, {run:()=>outside("x")}); invoke();`,
      },
      {
        name: `inline-${method}-bind-copy`,
        rule: 7,
        hit: "probe.ts:3",
        source:
          outsideImport +
          `const scope=createScope(); const invoke=scope.${method}.bind(scope); const later=invoke; later({run:()=>outside("x")});`,
      },
      {
        name: `inline-${method}-bind-imported`,
        rule: 7,
        hit: "probe.ts:3",
        source: outsideImport + 'import {invoke} from "./helper"; invoke({run:()=>outside("x")});',
        helper: `import {createScope} from "@tinker/core"; const scope=createScope(); export const invoke=scope.${method}.bind(scope);`,
      },
      {
        name: `inline-${method}-reflect-bind-variable`,
        rule: 7,
        hit: "probe.ts:3",
        source:
          outsideImport +
          `const scope=createScope(); const invoke=scope.${method}.bind(scope); Reflect.apply(invoke, null, [{run:()=>outside("x")}]);`,
      },
      {
        name: `inline-${method}-bind-variable-own`,
        source: `const scope=createScope(); const invoke=scope.${method}.bind(scope); invoke({run:()=>1});`,
      },
    );
  }
  cases.push(
    {
      name: "inline-renamed-parameter",
      rule: 7,
      hit: "probe.ts:3",
      source:
        outsideImport +
        'const invoke: (task: Scope.Inline<{},string,void>) => string = createScope().run; invoke({run:()=>outside("x")});',
    },
    {
      name: "component-map",
      tsx: true,
      rule: 7,
      hit: "probe.tsx:2",
      source:
        'import {useState} from "react"; function Row() {const [n]=useState(0); return <div>{n}</div>;} operation({run:()=>["a"].map(Row)});',
    },
    {
      name: "component-via-helper",
      tsx: true,
      rule: 7,
      hit: "probe.tsx:2",
      source:
        'import {useState} from "react"; function Page() {const [n]=useState(0); return <div>{n}</div>;} function render(view) {return view();} operation({run:()=>render(Page)});',
    },
    {
      name: "component-new-argument",
      tsx: true,
      rule: 7,
      hit: "probe.tsx:2",
      source:
        'import {useState} from "react"; function Page() {const [n]=useState(0); return <div>{n}</div>;} class View {constructor(view) {view();}} operation({run:()=>new View(Page)});',
    },
    ...["d.ts", "d.mts"].map((suffix) => ({
      name: `declared-unit-${suffix}`,
      tag: "unit-body",
      hit: "probe.ts:2",
      source: `import {spec} from "./helper.${suffix === "d.ts" ? "js" : "mjs"}"; operation(spec);`,
      helperName: `helper.${suffix}`,
      helper: "export declare const spec: {label:string; run:()=>number};",
    })),
  );
  cases.push(
    {
      name: "inline-hook",
      rule: 7,
      hit: "probe.ts:3",
      source:
        outsideImport +
        'extension({label:"x",hooks:{start({scope}) {scope.run({run:()=>outside("x")});}}});',
    },
    {
      name: "component-value",
      tsx: true,
      source:
        'import {useState} from "react"; function Page() {const [n]=useState(0); return <div>{n}</div>;} resource({factory:()=>({Page})});',
    },
    {
      name: "component-imported-value",
      source: 'import {Page} from "./helper"; resource({factory:()=>({Page})});',
      helperTsx: true,
      helper:
        'import {useState} from "react"; export function Page() {const [n]=useState(0); return <div>{n}</div>;}',
    },
    {
      name: "component-called",
      tsx: true,
      rule: 7,
      hit: "probe.tsx:2",
      source:
        'import {useState} from "react"; function Page() {const [n]=useState(0); return <div>{n}</div>;} resource({factory:()=>Page()});',
    },
    {
      name: "capital-helper",
      rule: 7,
      hit: "probe.ts:3",
      source:
        outsideImport + 'function Page() {return outside("x");} resource({factory:()=>({Page})});',
    },
  );
  return cases;
}

async function prove() {
  const planted = await mkdtemp(join(tmpdir(), "lazy-modules-proof-"));
  const core =
    'import { operation, resource, extension, createScope, type Scope } from "@tinker/core";\n';
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
  const expected = {
    "namespace-loader": "probe.ts:2",
    "created-require": "probe.ts:2",
    "dep-loader": "probe.ts:2",
    "overloaded-helper": "helper.ts:2",
    "factory-alias": "probe.ts:2",
    "wrapped-factory": "probe.ts:2",
    "core-namespace": "probe.ts:3",
    "core-destructure": "probe.ts:3",
    reexport: "probe.ts:2",
    "helper-method": "helper.ts:2",
    "method-body": "probe.ts:3",
    destructure: "probe.ts:2",
    outside: "probe.ts:3",
    helper: "helper.ts:2",
    alias: "probe.ts:3",
    namespace: "probe.ts:2",
    nested: "probe.ts:3",
    hook: "probe.ts:3",
    "core-alias": "probe.ts:3",
    import: "probe.ts:2",
    require: "probe.ts:2",
    createRequire: "probe.ts:2",
    label: "probe.ts:2",
    target: "probe.ts:2",
    depends: "probe.ts:2",
    block: "probe.ts:2",
    literal: "probe.ts:2",
    duplicate: "duplicate-second/probe.ts:2",
  };
  for (const test of cases) if (test.rule) test.hit = expected[test.name];
  cases.push(
    {
      name: "conditional-unit",
      rule: 7,
      hit: "probe.ts:3",
      source:
        outsideImport +
        'const safe=()=>1, bad=()=>outside("x"); operation({label:"x",run:true?safe:bad});',
    },
    {
      name: "conditional-unit-own",
      source: 'const a=()=>1, b=()=>2; operation({label:"x",run:true?a:b});',
    },
    {
      name: "factory-value",
      rule: 7,
      hit: "probe.ts:3",
      source: outsideImport + 'const spec={label:"x",factory:()=>outside("x")}; resource(spec);',
    },
    { name: "factory-value-own", source: 'const spec={label:"x",factory:()=>1}; resource(spec);' },
    {
      name: "star-reexport",
      rule: 7,
      hit: "probe.ts:2",
      source: 'import {resolve as external} from "./helper"; operation({run:()=>external("x")});',
      helper: 'export * from "node:path";',
    },
    {
      name: "namespace-star-reexport",
      rule: 7,
      hit: "probe.ts:2",
      source: 'import * as helper from "./helper"; operation({run:()=>helper.resolve("x")});',
      helper: 'export * from "node:path";',
    },
    {
      name: "own-star-reexport",
      source: 'import {hidden} from "./helper"; operation({run:()=>hidden()});',
      helper: 'export * from "./leaf";',
      leaf: "export function hidden() {return 1;}",
    },
    {
      name: "alias-hop",
      rule: 7,
      hit: "probe.ts:2",
      source: 'import {hidden} from "./helper"; operation({run:()=>hidden("x")});',
      helper: 'export {hidden} from "./leaf";',
      leaf: 'export {resolve as hidden} from "node:path";',
    },
    {
      name: "argument-value",
      rule: 7,
      hit: "probe.ts:3",
      source: outsideImport + 'const spec = {label:"x", run: () => outside("x")}; operation(spec);',
    },
    {
      name: "argument-spread",
      rule: 7,
      hit: "probe.ts:3",
      source:
        outsideImport + 'const spec = {run: () => outside("x")}; operation({label:"x", ...spec});',
    },
    {
      name: "named-hooks",
      rule: 7,
      hit: "probe.ts:3",
      source:
        outsideImport + 'const hooks = {start: () => outside("x")}; extension({label:"x", hooks});',
    },
    {
      name: "parameter-body",
      tag: "unit-body",
      hit: "probe.ts:2",
      source: 'function op(run) {return operation({label:"x", run});} op(() => 1);',
    },
    {
      name: "wrapped-unit-callback",
      tag: "unit-body",
      hit: "probe.ts:3",
      source:
        outsideImport +
        'function op(run) {return operation({label:"x", run});} op(() => outside("x"));',
    },
    { name: "missing-run", tag: "unit-body", hit: "probe.ts:2", source: 'operation({label:"x"});' },
    {
      name: "missing-hooks",
      tag: "unit-body",
      hit: "probe.ts:2",
      source: 'extension({label:"x", hooks: unknownHooks});',
    },
    {
      name: "named-callback",
      rule: 7,
      hit: "probe.ts:3",
      source:
        outsideImport +
        'function own(x) {return outside(x);} operation({run: () => ["a"].map(own)});',
    },
    {
      name: "object-getter",
      rule: 7,
      hit: "probe.ts:3",
      source:
        outsideImport +
        'const obj = {get v() {return outside("x");}}; operation({run: () => obj.v});',
    },
    {
      name: "class-getter",
      rule: 7,
      hit: "probe.ts:3",
      source:
        outsideImport +
        'class Box {get v() {return outside("x");}} const obj = new Box(); operation({run: () => obj.v});',
    },
    {
      name: "class-field",
      rule: 7,
      hit: "probe.ts:3",
      source:
        outsideImport + 'class Box {value = outside("x");} operation({run: () => new Box()});',
    },
    {
      name: "class-static-field",
      rule: 7,
      hit: "probe.ts:3",
      source:
        outsideImport +
        'class Box {static value = outside("x");} operation({run: () => new Box()});',
    },
    {
      name: "class-static-block",
      rule: 7,
      hit: "probe.ts:3",
      source:
        outsideImport + 'class Box {static {outside("x");}} operation({run: () => new Box()});',
    },
    {
      name: "class-constructor",
      rule: 7,
      hit: "probe.ts:3",
      source:
        outsideImport +
        'class Box {constructor() {outside("x");}} operation({run: () => new Box()});',
    },
    {
      name: "own-call",
      rule: 7,
      hit: "probe.ts:3",
      source:
        outsideImport +
        'function own(x) {return outside(x);} operation({run: () => own.call(null, "x")});',
    },
    {
      name: "own-apply",
      rule: 7,
      hit: "probe.ts:3",
      source:
        outsideImport +
        'function own(x) {return outside(x);} operation({run: () => own.apply(null, ["x"])});',
    },
    {
      name: "tagged-helper",
      rule: 7,
      hit: "probe.ts:3",
      source:
        outsideImport + 'function own() {return outside("x");} operation({run: () => own`x`});',
    },
    {
      name: "conditional-function",
      rule: 7,
      hit: "probe.ts:3",
      source:
        outsideImport +
        'const a = () => 1, b = () => outside("x"); const fn = true ? a : b; operation({run: () => fn()});',
    },
    {
      name: "returned-method",
      rule: 7,
      hit: "probe.ts:3",
      source:
        outsideImport +
        'function query() {return outside("x");} resource({factory: () => ({query})});',
    },
    {
      name: "untyped-library",
      rule: 7,
      hit: "probe.ts:2",
      source: 'import thing from "no-such-lib"; operation({run: () => thing("x")});',
    },
    {
      name: "ambient-library",
      rule: 7,
      hit: "probe.ts:2",
      source: 'import {thing} from "x"; operation({run: () => thing("x")});',
      declaration: 'declare module "x" {export function thing(value:string):string;}',
    },
    {
      name: "mapped-library",
      rule: 7,
      hit: "probe.ts:2",
      source: 'import {hidden} from "outside-lib"; operation({run: () => hidden()});',
      helper: "export function hidden() {return 1;}",
    },
    {
      name: "class-extends",
      rule: 7,
      hit: "probe.ts:2",
      source:
        'import {EventEmitter} from "node:events"; operation({run: () => {class Mine extends EventEmitter {} return new Mine();}});',
    },
    {
      name: "object-bare-outside",
      rule: 7,
      hit: "probe.ts:3",
      source: outsideImport + 'const tools = {r: outside}; operation({run: () => tools.r("x")});',
    },
    {
      name: "object-shorthand-outside",
      rule: 7,
      hit: "probe.ts:3",
      source:
        outsideImport + 'const tools = {outside}; operation({run: () => tools.outside("x")});',
    },
    {
      name: "process-loader",
      rule: 8,
      hit: "probe.ts:2",
      source: 'operation({run: () => process.getBuiltinModule("path")});',
    },
    {
      name: "normalized-duplicate",
      rule: 9,
      hit: "normalized-duplicate-second/probe.ts:2",
      source: lazy + ";",
      second: 'resource({label:"module:path",target:"scope",factory:()=>import("path")});',
    },
    {
      name: "argument-value-own",
      source: 'const spec = {label:"x", run: () => 1}; operation(spec);',
    },
    {
      name: "argument-spread-own",
      source: 'const spec = {run: () => 1}; operation({label:"x", ...spec});',
    },
    {
      name: "named-hooks-own",
      source: 'const hooks = {start: () => 1}; extension({label:"x", hooks});',
    },
    {
      name: "named-callback-own",
      source: 'function own(x) {return x;} operation({run: () => ["a"].map(own)});',
    },
    {
      name: "returned-method-own",
      source: "function query() {return 1;} resource({factory: () => ({query})});",
    },
    {
      name: "own-package-path",
      source: 'import {hidden} from "@tinker/fixture"; operation({run: () => hidden()});',
      helper: "export function hidden() {return 1;}",
    },
    {
      name: "own-hash-path",
      source: 'import {hidden} from "#helper"; operation({run: () => hidden()});',
      helper: "export function hidden() {return 1;}",
    },
    {
      name: "object-built-value",
      source:
        'import {z} from "zod"; const shape = z.object({id:z.string()}); operation({run: () => shape.safeParse({id:"x"})});',
    },
    {
      name: "dep-destructure",
      source:
        'const orm = resource({label:"module:drizzle-orm",target:"scope",factory:()=>import("drizzle-orm")}); operation({depends:{orm},run:async({orm})=>{const {eq,sql}=orm; return sql;}});',
    },
    {
      name: "dep-renamed-key",
      source:
        'const orm = resource({label:"module:drizzle-orm",target:"scope",factory:()=>import("drizzle-orm")}); operation({depends:{orm},run:async({orm})=>{const {eq:equals}=orm; return equals;}});',
    },
    {
      name: "dep-nested-key",
      source:
        'const orm = resource({label:"module:drizzle-orm",target:"scope",factory:()=>import("drizzle-orm")}); operation({depends:{orm},run:async({orm:{eq}})=>eq});',
    },
    {
      name: "dep-member",
      source:
        'const orm = resource({label:"module:drizzle-orm",target:"scope",factory:()=>import("drizzle-orm")}); operation({depends:{orm},run:async({orm})=>orm.eq});',
    },
    {
      name: "own-require-method",
      source: "const deps={require(){return 1;}}; operation({run:()=>deps.require()});",
    },
    {
      name: "own-require-function",
      source: "function require() {return 1;} operation({run:()=>require()});",
    },
    {
      name: "own-createRequire",
      source: "function createRequire() {return 1;} operation({run:()=>createRequire()});",
    },
  );
  cases.unshift(...extraCases(outsideImport));
  try {
    await symlink(
      join(workspace, "packages/start/node_modules"),
      join(planted, "node_modules"),
      "dir",
    );
    const config = JSON.stringify({
      compilerOptions: {
        module: "esnext",
        moduleResolution: "bundler",
        target: "esnext",
        jsx: "react-jsx",
        types: ["node"],
        paths: {
          "outside-lib": ["./helper.ts"],
          "@tinker/fixture": ["./helper.ts"],
          "#helper": ["./helper.ts"],
        },
      },
    });
    for (const test of cases) {
      const root = join(planted, test.name);
      await mkdir(root);
      await writeFile(join(root, "tsconfig.json"), config);
      await plantSource(root, test, core);
      const roots = [root];
      if (test.second) {
        const second = join(planted, `${test.name}-second`);
        await mkdir(second);
        await writeFile(join(second, "tsconfig.json"), config);
        await writeFile(join(second, "probe.ts"), core + test.second);
        roots.push(second);
      }
      proveCase(test, roots, planted);
    }
    console.log(`Lazy module proof: ${cases.length} cases passed`);
  } finally {
    await rm(planted, { recursive: true, force: true });
  }
}

async function plantSource(root, test, core) {
  await writeFile(join(root, test.tsx ? "probe.tsx" : "probe.ts"), core + test.source);
  if (test.helper)
    await writeFile(
      join(root, test.helperName ?? (test.helperTsx ? "helper.tsx" : "helper.ts")),
      test.helper,
    );
  if (test.leaf) await writeFile(join(root, "leaf.ts"), test.leaf);
  if (test.declaration) await writeFile(join(root, "ambient.d.ts"), test.declaration);
}

function proveCase(test, roots, planted) {
  const result = spawnSync(process.execPath, [script, ...roots], {
    encoding: "utf8",
    cwd: planted,
  });
  assert.equal(
    result.status,
    test.rule || test.tag ? 1 : 0,
    `${test.name}: ${result.stdout}${result.stderr}`,
  );
  if (test.rule || test.tag) proveHit(test, result.stderr);
  console.log(
    `PASS ${test.name}: ${test.tag ?? (test.rule ? `rule-${test.rule}` : "allowed")} EXIT ${result.status}`,
  );
}

function proveHit(test, stderr) {
  assert.ok(test.hit, `${test.name}: exact file and line required`);
  const file = test.hit.includes("/") ? test.hit : `${test.name}/${test.hit}`;
  const expectedHit = `${file} ${test.tag ?? `rule-${test.rule}`}:`;
  assert.ok(
    stderr.split("\n").some((line) => line.startsWith(expectedHit)),
    `${test.name}: expected ${expectedHit}\n${stderr}`,
  );
  if (
    ["parameter-body", "wrapped-unit-callback", "missing-run", "missing-hooks"].includes(test.name)
  )
    assert.match(stderr, /unit body not found/, test.name);
}

if (process.argv.includes("--prove")) await prove();
else {
  const roots = process.argv.slice(2).map((root) => resolve(root));
  assert.ok(roots.length, "pass at least one src root, or --prove");
  process.exitCode = await check(roots);
}
