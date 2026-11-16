import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import ts from "typescript-api";

import type { Tools } from "./tools";

export declare namespace Exits {
  /**
   * One way out of an operation, as the type of its `run` declares it. `exit` is an answer's
   * `kind`, `refused` for a hook's refusal, or `value` for every other return.
   */
  type Exit = { path: string; line: number; label: string; exit: string };
}

/** The exit of a return with no `kind` of its own. */
const plain = "value";

/** A hook's `refuse(payload)`, by the name Core gives its type. */
const refusal = "Refused";

/**
 * The app's own code. The base under `tinker/` is Tinker's, and moves into a package that has
 * its own tests (ADR 0159).
 */
export const appCode = /^(?:src|cmds)\//;

/** A test file declares no exit: its operations are fixtures. */
const testFile = /\.test\.[mc]?tsx?$/;

function kindsOf(checker: ts.TypeChecker, type: ts.Type) {
  const kind = type.getProperty("kind");
  if (!kind) return [];

  const of = checker.getTypeOfSymbol(kind);
  const parts = of.isUnion() ? of.types : [of];
  return parts.every((part) => part.isStringLiteral()) ? parts.map((part) => part.value) : [];
}

/** Each exit a return type holds: a union gives one per member, and a promise gives its value's. */
function exitsOf(checker: ts.TypeChecker, returned: ts.Type) {
  const type = checker.getAwaitedType(returned) ?? returned;
  if (type.flags & ts.TypeFlags.Never) return [];

  const exits = new Set<string>();
  for (const part of type.isUnion() ? type.types : [type]) {
    if (checker.typeToString(part) === refusal) {
      exits.add("refused");
      continue;
    }
    const kinds = kindsOf(checker, part);
    for (const kind of kinds.length ? kinds : [plain]) exits.add(kind);
  }
  return [...exits].sort();
}

/** The names a file imports from Core. */
function coreImports(source: ts.SourceFile) {
  return source.statements.flatMap((statement) => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      return [];
    }
    const names = statement.importClause?.namedBindings;
    const core = statement.moduleSpecifier.text === "@tinkered/core";
    return core && names && ts.isNamedImports(names) ? [...names.elements] : [];
  });
}

/** The name `operation` has in this file, when it comes from Core. */
function coreOperation(source: ts.SourceFile) {
  return coreImports(source).find(
    (element) => (element.propertyName ?? element.name).text === "operation",
  )?.name.text;
}

function member(options: ts.ObjectLiteralExpression, name: string) {
  return options.properties.find(
    (property) => property.name && ts.isIdentifier(property.name) && property.name.text === name,
  );
}

/** The return type of an operation's `run`, written as a property or as a method. */
function returnOf(checker: ts.TypeChecker, run: ts.ObjectLiteralElementLike) {
  if (ts.isMethodDeclaration(run)) {
    return checker.getSignatureFromDeclaration(run)?.getReturnType();
  }
  if (!ts.isPropertyAssignment(run)) return undefined;
  return checker.getTypeAtLocation(run.initializer).getCallSignatures()[0]?.getReturnType();
}

/** The options of a call of `operation`, when the call has them as a literal. */
function optionsOf(node: ts.Node, operation: string) {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return undefined;
  const [options] = node.arguments;
  if (node.expression.text !== operation || !options) return undefined;
  return ts.isObjectLiteralExpression(options) ? options : undefined;
}

/** An operation's label, when it is a literal: a tool cannot name a label made at run time. */
function labelOf(options: ts.ObjectLiteralExpression) {
  const label = member(options, "label");
  if (!label || !ts.isPropertyAssignment(label)) return undefined;
  return ts.isStringLiteralLike(label.initializer) ? label.initializer.text : undefined;
}

function exitsIn(checker: ts.TypeChecker, source: ts.SourceFile, path: string) {
  const operation = coreOperation(source);
  const found: Exits.Exit[] = [];
  if (!operation) return found;

  const visit = (node: ts.Node) => {
    ts.forEachChild(node, visit);
    const options = optionsOf(node, operation);
    const label = options && labelOf(options);
    const run = options && member(options, "run");
    if (!label || !run) return;

    const returned = returnOf(checker, run);
    const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    for (const exit of returned ? exitsOf(checker, returned) : []) {
      found.push({ path, line, label, exit });
    }
  };
  visit(source);
  return found;
}

/**
 * Each exit the app's operations declare, read from the types of the app's own `tsconfig.json`.
 * An app with no `tsconfig.json` declares none.
 */
export function declaredExits(root: string): Exits.Exit[] {
  const config = join(root, "tsconfig.json");
  if (!existsSync(config)) return [];

  const parsed = ts.getParsedCommandLineOfConfigFile(
    config,
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined },
  );
  if (!parsed) return [];
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const checker = program.getTypeChecker();

  return program.getSourceFiles().flatMap((source) => {
    const path = relative(root, source.fileName).replaceAll("\\", "/");
    if (source.isDeclarationFile || !appCode.test(path) || testFile.test(path)) return [];
    return exitsIn(checker, source, path);
  });
}

/** Where a page test leaves its store's text: one `.json` file a test file, under the app. */
export const pageExits = ".tinker/exits";

/** The exits of one page file: the keys of the store's JSON object. */
function keysIn(path: string) {
  const counts: unknown = JSON.parse(readFileSync(path, "utf8"));
  return typeof counts === "object" && counts !== null ? Object.keys(counts) : [];
}

/**
 * The exits a test run reached. The `exits` capsule wrote `file`: one `label<tab>exit` a line.
 * A page test wrote its store's JSON to a file in `pageExits`.
 */
function reachedIn(root: string, file: string) {
  const folder = join(root, pageExits);
  const pages = existsSync(folder) ? readdirSync(folder) : [];
  const lines = existsSync(file) ? readFileSync(file, "utf8").split("\n") : [];

  return new Set([...lines, ...pages.flatMap((name) => keysIn(join(folder, name)))]);
}

const said: Readonly<Record<string, string>> = {
  refused: "refuses",
  [plain]: "returns",
};

/** A finding for each declared exit that no test reached. */
export function unreached(root: string, file: string): Tools.Found[] {
  const reached = reachedIn(root, file);

  return declaredExits(root)
    .filter(({ label, exit }) => !reached.has(`${label}\t${exit}`))
    .map(({ path, line, label, exit }) => ({
      path,
      line,
      rule: "tinker/exit",
      what: `\`${label}\` ${said[exit] ?? `answers \`${exit}\``}, and no test reaches it`,
    }));
}
