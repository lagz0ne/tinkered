import { readFileSync } from "node:fs";
import { parseSync } from "oxc-parser";
import { lineAt } from "./paths.mjs";

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
    const name = node.source?.value;
    if (typeof name === "string" && node.type !== "Literal")
      found.push({ name, line: source.line(node) });
  });
  return found;
}

/**
 * The identifiers one export statement names: `export const a`, `export function b`, `export { c }`.
 * @param {object} node - From exportsOf; why: one ExportNamedDeclaration.
 */
function exportedIds(node) {
  const declared = node.declaration?.declarations?.map((item) => item.id) ?? [];
  const named = node.specifiers.map((item) => item.exported);
  return [...declared, node.declaration?.id, ...named].filter(Boolean);
}

/**
 * The names the file exports, each with its line.
 * @param {ReturnType<typeof parseSource>} source - From parseSource; why: the file to read.
 */
export function exportsOf(source) {
  const names = new Map();
  for (const node of source.program.body) {
    if (node.type === "ExportDefaultDeclaration") names.set("default", source.line(node));
    if (node.type !== "ExportNamedDeclaration") continue;
    for (const id of exportedIds(node)) names.set(id.name ?? id.value, source.line(id));
  }
  return names;
}

/**
 * The line of each call to a function by name.
 * @param {ReturnType<typeof parseSource>} source - From parseSource; why: the file to read.
 * @param {string} name - From a check; why: the function whose calls count.
 */
export function callsOf(source, name) {
  const lines = [];
  walk(source.program, (node) => {
    if (node.type === "CallExpression" && node.callee.name === name) lines.push(source.line(node));
  });
  return lines;
}

/**
 * Nodes that use a name outside import lines: a JSX tag or a plain identifier.
 * @param {ReturnType<typeof parseSource>} source - From parseSource; why: the file to read.
 * @param {string} name - From a check; why: the name to look for.
 */
export function usesOf(source, name) {
  const lines = [];
  walk(source.program, (node) => {
    if (node.type === "ImportDeclaration") return false;
    if (/^(JSX)?Identifier$/.test(node.type) && node.name === name) lines.push(source.line(node));
    return true;
  });
  return lines;
}

/**
 * Object properties by key name, such as `component:` in a route's options.
 * @param {ReturnType<typeof parseSource>} source - From parseSource; why: the file to read.
 * @param {string} key - From a check; why: the property key to find.
 */
export function propertiesOf(source, key) {
  const found = [];
  walk(source.program, (node) => {
    if (node.type === "Property" && node.key.name === key) found.push(node);
  });
  return found;
}

/**
 * Names the file imports from other modules.
 * @param {ReturnType<typeof parseSource>} source - From parseSource; why: the file to read.
 */
export function importedNames(source) {
  return new Set(
    source.program.body
      .filter((node) => node.type === "ImportDeclaration")
      .flatMap((node) => node.specifiers.map((item) => item.local.name)),
  );
}
