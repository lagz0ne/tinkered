import { writeFileSync } from "node:fs";
import {
  applyEdits,
  findNodeAtLocation,
  modify,
  parse,
  parseTree,
  printParseErrorCode,
} from "jsonc-parser";
import { lineAt, readText } from "./paths.mjs";

/**
 * Read a config file the way tsc reads tsconfig.json: comments and trailing commas are fine.
 * TypeScript 7 ships no JS config reader, so this is jsonc-parser, the JSONC parser VS Code uses.
 * A parse error comes back with its line; the caller must then never write the file.
 * @param {string} path - From a check; why: the file to read; a missing file reads as `{}`.
 */
export function readJsonc(path) {
  const text = readText(path);
  const errors = [];
  const value = parse(text, errors, { allowTrailingComma: true });
  if (text && errors.length > 0) {
    const [first] = errors;
    return {
      text,
      error: { line: lineAt(text, first.offset), code: printParseErrorCode(first.error) },
    };
  }
  return { text, value: value ?? {} };
}

/**
 * Set one key and keep every other byte: comments, order, and formatting stay.
 * A new top-level key goes first, so no existing line moves.
 * @param {string} path - From a --fix; why: the file to edit in place.
 * @param {string} text - From readJsonc; why: the text that parsed, never a failed parse.
 * @param {string[]} key - From a --fix; why: the path to the key, such as ["extends"].
 * @param {string} value - From a --fix; why: the value the base owns.
 */
export function writeKey(path, text, key, value) {
  const base = text || "{}\n";
  const edits = modify(base, key, value, {
    formattingOptions: { insertSpaces: true, tabSize: 2 },
    getInsertionIndex: () => 0,
  });
  writeFileSync(path, applyEdits(base, edits));
}

/**
 * The line of a key in a JSONC text, read from the parse tree so a comment never matches.
 * @param {string} text - From readJsonc; why: the text that parsed.
 * @param {(string | number)[]} key - From a check; why: the path to the key.
 */
export function lineOfKey(text, key) {
  const node = findNodeAtLocation(parseTree(text, [], { allowTrailingComma: true }), key);
  return node ? lineAt(text, node.parent.offset) : 1;
}
