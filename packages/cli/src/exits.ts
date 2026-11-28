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
  /** One operation of the app, as the checker reads it: where it is, its `run`, and its exits. */
  type Operation = {
    path: string;
    line: number;
    label: string;
    options: ts.ObjectLiteralExpression;
    run: ts.ObjectLiteralElementLike;
    exits: string[];
  };
  /** A file of the app's own code, and its path from the app's root. */
  type File = { path: string; source: ts.SourceFile };
  /**
   * The app's own files, its operations, and the checker that read them: it resolves the names
   * they use.
   */
  type App = { checker: ts.TypeChecker; files: File[]; operations: Operation[] };
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

/** The names a file imports from a package, by name: `import { a, b as c } from "…"`. */
export function importsOf(source: ts.SourceFile, from: string) {
  return source.statements.flatMap((statement) => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      return [];
    }
    const names = statement.importClause?.namedBindings;
    const named = statement.moduleSpecifier.text === from;
    return named && names && ts.isNamedImports(names) ? [...names.elements] : [];
  });
}

/** The names a file imports from Core. */
export const coreImports = (source: ts.SourceFile) => importsOf(source, "@tinkered/core");

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
export function labelOf(options: ts.ObjectLiteralExpression) {
  const label = member(options, "label");
  if (!label || !ts.isPropertyAssignment(label)) return undefined;
  return ts.isStringLiteralLike(label.initializer) ? label.initializer.text : undefined;
}

function operationsIn(checker: ts.TypeChecker, source: ts.SourceFile, path: string) {
  const operation = coreOperation(source);
  const found: Exits.Operation[] = [];
  if (!operation) return found;

  const visit = (node: ts.Node) => {
    ts.forEachChild(node, visit);
    const options = optionsOf(node, operation);
    const label = options && labelOf(options);
    const run = options && member(options, "run");
    if (!label || !run) return;

    const returned = returnOf(checker, run);
    const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    const exits = returned ? exitsOf(checker, returned) : [];
    found.push({ path, line, label, options, run, exits });
  };
  visit(source);
  return found;
}

/**
 * The app's own files and its operations, read with the types of the app's own `tsconfig.json`.
 * An app with no `tsconfig.json` has none.
 */
export function readOperations(root: string): Exits.App | undefined {
  const config = join(root, "tsconfig.json");
  if (!existsSync(config)) return undefined;

  const parsed = ts.getParsedCommandLineOfConfigFile(
    config,
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined },
  );
  if (!parsed) return undefined;
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const checker = program.getTypeChecker();

  const files = program.getSourceFiles().flatMap((source): Exits.File[] => {
    const path = relative(root, source.fileName).replaceAll("\\", "/");
    if (source.isDeclarationFile || !appCode.test(path) || testFile.test(path)) return [];
    return [{ path, source }];
  });
  const operations = files.flatMap(({ path, source }) => operationsIn(checker, source, path));
  return { checker, files, operations };
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

/**
 * The plain returns a run reached by its data: a run writes its answer's `kind`, and a
 * `kind: string` field is data, not an exit the op declares. Such a line reaches `value` (#74).
 */
function plainByData(reached: ReadonlySet<string>, declared: readonly Exits.Exit[]) {
  const kinds = new Set(declared.map(({ label, exit }) => `${label}\t${exit}`));
  const labels = [...reached].filter((line) => !kinds.has(line)).map((line) => line.split("\t")[0]);
  return new Set(labels.map((label) => `${label}\t${plain}`));
}

/** A finding for each exit in `declared` that no test reached. */
export function unreached(root: string, file: string, declared: Exits.Exit[]): Tools.Found[] {
  const reached = reachedIn(root, file);
  const byData = plainByData(reached, declared);

  return declared
    .filter(({ label, exit }) => !reached.has(`${label}\t${exit}`))
    .filter(({ label, exit }) => !byData.has(`${label}\t${exit}`))
    .map(({ path, line, label, exit }) => ({
      path,
      line,
      rule: "tinker/exit",
      what: `\`${label}\` ${said[exit] ?? `answers \`${exit}\``}, and no test reaches it`,
    }));
}
