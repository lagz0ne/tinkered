import ts from "typescript-api";

import type { Exits } from "./exits";
import type { Tools } from "./tools";

/** The Core calls whose code may hold a watch: the unit owns it and ends it (#83). */
const units = new Set(["operation", "resource", "capsule"]);

/** The calls that read one part of a keyed cell. */
const partKinds = new Set(["of", "where"]);

const outside = "outside an operation, resource or capsule";

/** A declaration Core's own code makes: its source, or its built types in `dist`. */
const isCoreFile = ({ fileName }: ts.SourceFile) =>
  /[/\\](@tinkered[/\\]core|packages[/\\]core)[/\\]/.test(fileName);

/** The symbol a name stands for, through an import. */
function ownSymbol(checker: ts.TypeChecker, node: ts.Node) {
  const symbol = checker.getSymbolAtLocation(node);
  return symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
}

/** Core's own name for what an expression names: `watch` in `rows.watch`, `resource`. */
function coreName(checker: ts.TypeChecker, node: ts.Expression) {
  const symbol = ownSymbol(checker, ts.isPropertyAccessExpression(node) ? node.name : node);
  return symbol?.declarations?.some((each) => isCoreFile(each.getSourceFile()))
    ? symbol.name
    : undefined;
}

/** A node inside the call of a Core unit: an operation's `run`, a factory, a capsule hook. */
function inUnit(checker: ts.TypeChecker, node: ts.Node) {
  for (let up = node.parent; !ts.isSourceFile(up); up = up.parent) {
    if (ts.isCallExpression(up) && units.has(coreName(checker, up.expression) ?? "")) return true;
  }
  return false;
}

/** The value a name holds, when the name is a `const`: its initializer, through an import. */
function valueOf(checker: ts.TypeChecker, node: ts.Expression) {
  if (!ts.isIdentifier(node)) return node;
  const declaration = ownSymbol(checker, node)?.valueDeclaration;
  const constant =
    declaration &&
    ts.isVariableDeclaration(declaration) &&
    ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const;
  return (constant && declaration.initializer) || node;
}

/** The unit a `scope.resolve(…)` read names, followed through a `const`. */
function resolved(checker: ts.TypeChecker, receiver: ts.Expression) {
  const read = valueOf(checker, receiver);
  if (!ts.isCallExpression(read) || coreName(checker, read.expression) !== "resolve") return;
  const [arg] = read.arguments;
  return arg && valueOf(checker, arg);
}

/** The cell a part read is made on: `board.messages` in `board.messages.where(…)`. */
function cellOf(part: ts.Expression | undefined) {
  if (!part || !ts.isCallExpression(part)) return;
  const callee = part.expression;
  if (!ts.isPropertyAccessExpression(callee) || !partKinds.has(callee.name.text)) return;
  return ts.isPropertyAccessExpression(callee.expression) ? callee.expression : undefined;
}

/**
 * The remote part a watch reads, as the code names its cell: `board.messages` for the read
 * `scope.resolve(board.messages.where(…))`, where `board` is a `remoteData(…)` call. A read the
 * code makes some other way gives none.
 */
function remotePart(checker: ts.TypeChecker, receiver: ts.Expression) {
  const cell = cellOf(resolved(checker, receiver));
  if (!cell) return;
  const board = valueOf(checker, cell.expression);
  const remote = ts.isCallExpression(board) && coreName(checker, board.expression) === "remoteData";
  return remote ? `${cell.expression.getText()}.${cell.name.text}` : undefined;
}

/** What a loose watch reads: a remote part by its cell, or a read the check does not follow. */
function whatOf(checker: ts.TypeChecker, receiver: ts.Expression) {
  const part = remotePart(checker, receiver);
  return part ? `\`remoteData\` part \`${part}\`: watched ${outside}` : `\`watch\` ${outside}`;
}

/**
 * `tinker/loose-watch` (#83): a call of a Core reader's `watch` outside the call of an
 * operation, a resource or a capsule. No unit owns that watch, so no scope ends it, and no
 * trace or graph shows it. A watch of a remote part, followed through `const`s to its
 * `remoteData(…)` board, names that part. The finding is the fact: the reader judges it.
 */
export function findWatches(checker: ts.TypeChecker, files: readonly Exits.File[]) {
  return files.flatMap(({ path, source }) => {
    const found: Tools.Found[] = [];
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "watch" &&
        coreName(checker, node.expression) === "watch" &&
        !inUnit(checker, node)
      ) {
        const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        const what = whatOf(checker, node.expression.expression);
        found.push({ path, line, rule: "tinker/loose-watch", what });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    return found;
  });
}
