import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// oxc-parser is a dependency of tools/jev, not of the root package: resolve it from there.
const jev = createRequire(new URL("../../tools/jev/package.json", import.meta.url));
const { parseSync } = jev("oxc-parser");

/**
 * The 1-based line of a character offset, so a message can name file:line.
 * @param {string} text - From a read file; why: count the newlines before the offset.
 * @param {number} offset - From a parser or indexOf; why: a miss (-1) reads as line 1.
 */
function lineAt(text, offset) {
  return offset < 0 ? 1 : text.slice(0, offset).split("\n").length;
}

/** @param {object} node - From oxc-parser; why: walk every child node. */
function children(node) {
  return Object.values(node)
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter((value) => value && typeof value === "object");
}

/**
 * Visit every node; a visitor that returns false skips that node's children.
 * @param {object} node - From parseSource; why: the tree to walk.
 * @param {(node: object) => boolean | void} visit - From a reader; why: what to collect.
 */
function walk(node, visit) {
  if (visit(node) === false) return;
  for (const child of children(node)) walk(child, visit);
}

/**
 * One parsed source file: its text, its tree, and the line of any node.
 * @param {string} path - From a check; why: the file to parse.
 */
export function parseSource(path) {
  const text = readFileSync(path, "utf8");
  const { program } = parseSync(path, text);
  return { text, program, line: (node) => lineAt(text, node.start) };
}

/**
 * Every module path the file names, with its line.
 * @param {ReturnType<typeof parseSource>} source - From parseSource; why: the file to read.
 */
export function specifiers(source) {
  const found = [];
  walk(source.program, (node) => {
    const name =
      node.type === "TSModuleDeclaration"
        ? node.id.value
        : node.type === "TSExternalModuleReference"
          ? node.expression.value
          : node.source?.value;
    if (typeof name === "string" && node.type !== "Literal") {
      found.push({ name, line: source.line(node) });
    }
  });
  return found;
}
