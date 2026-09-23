// Plain rule breaks (deterministic, no model): the style-census rules that match the writer
// guidelines (tools/writer-trial/guidelines.md), read off the oxc syntax tree and its comment
// list instead of raw text, so a rule word inside a string or a comment never counts. The
// census ids stay: T* for test files, S* for source files, S12/S13 for every file.
//
//   inspectPlain(source, file) → rows [{ id, line, message }] in source order
//
// A file that does not parse yields one `parse` row, never an empty list.
import { parseSync } from "oxc-parser";

const TEST_PATH = /(^|\/)tests\/|\.(test|spec|browser)\./;
const SRC_PATH = /(^|\/)src\//;

/** Which rule family a path gets: test rules win over source rules. */
function kindOf(file) {
  if (TEST_PATH.test(file)) return "test";
  if (SRC_PATH.test(file)) return "src";
  return "other";
}

const MESSAGES = {
  T01: "mock or spy in a test: drive the real public API and check what it returns or shows",
  T02: "fixed sleep in a test: wait for the state you need (an awaited promise, a locator assert, expect.poll)",
  T03: "only or skip left in a test: remove it so every test runs",
  T04: "private source import in a test: import from the public entry src/index",
  T05: "internals asserted in a test: check public behavior, not frozen state or prototypes",
  T06: "cast through unknown in a test: type the value honestly or narrow it",
  T07: "error class or message asserted: narrow with isError, then check the payload",
  T08: "isError inside expect: narrow with isError in an if, then assert the payload",
  S02: "cast through unknown in source: fix the type or narrow the value",
  S05: "bare throw of Error, TypeError, or RangeError: throw a named error from errors.ts",
  S06: "console call in source: return a value or emit an event; the caller decides what to show",
  S12: "ts-ignore or ts-expect-error comment: fix the type error instead",
  S13: "lint disable comment: fix the cause instead",
  S17: "type assertion in source hides what the value really is: narrow it with a check, or fix the type; `as const` and `[] as T[]` are fine",
};

const MOCK_ROOTS = new Set(["vi", "jest"]);
const MOCK_CALLS = new Set(["mock", "fn", "spyOn", "doMock", "stubGlobal", "useFakeTimers"]);
const TEST_ROOTS = new Set(["test", "it", "describe"]);
const INTERNALS = new Set(["isFrozen", "getPrototypeOf", "getOwnPropertyDescriptor"]);
const BARE_ERRORS = new Set(["Error", "TypeError", "RangeError"]);
const ERROR_MATCHERS = new Set(["toBeInstanceOf", "toThrowErrorMatchingInlineSnapshot"]);
const SLEEPS = new Set(["setTimeout", "sleep"]);
const PUBLIC_ENTRY = /^index(\.(ts|tsx|js))?$/;
const PRIVATE_SRC = /^(\.\.\/)+src\/(.+)$/;
const TS_DIRECTIVE = /^[\s*/]*@ts-(ignore|expect-error)\b/m;
const LINT_DIRECTIVE = /^[\s*/]*(eslint|oxlint|biome)-disable/m;

/** Offsets where each line starts, for line lookups by binary search. */
function lineStarts(source) {
  const starts = [0];
  for (let i = source.indexOf("\n"); i !== -1; i = source.indexOf("\n", i + 1)) starts.push(i + 1);
  return starts;
}

/** The 1-based line holding `offset`. */
function lineAt(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** Depth-first over every AST node; `visit` sees each object node once. */
function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  if (typeof node.type === "string") visit(node);
  for (const v of Object.values(node)) walk(v, visit);
}

/** A non-computed member's property name, or null. */
function propOf(node) {
  if (node?.type !== "MemberExpression" || node.computed) return null;
  return node.property?.type === "Identifier" ? node.property.name : null;
}

/** The identifier at the root of a member or call chain (`test` in `test.describe.only`). */
function rootName(node) {
  let at = node;
  while (at?.type === "MemberExpression" || at?.type === "CallExpression")
    at = at.type === "MemberExpression" ? at.object : at.callee;
  return at?.type === "Identifier" ? at.name : null;
}

/** A plain `obj.name` callee as `{ obj, name }`, or null. */
function memberCall(callee) {
  const name = propOf(callee);
  if (name === null || callee.object.type !== "Identifier") return null;
  return { obj: callee.object.name, name };
}

/** Parens and `!` removed: the expression they wrap. */
function unwrap(node) {
  let at = node;
  while (at?.type === "ParenthesizedExpression" || at?.type === "UnaryExpression")
    at = at.type === "UnaryExpression" ? at.argument : at.expression;
  return at;
}

/** The name a call's callee ends in: `f` for `f(…)` and `a.f(…)`, else null. */
function calleeName(callee) {
  if (callee?.type === "Identifier") return callee.name;
  return propOf(callee);
}

/** T01: `vi.fn(…)`, `jest.spyOn(…)`, and the rest of the mock set. */
function isMock(node) {
  const m = memberCall(node.callee);
  return m !== null && MOCK_ROOTS.has(m.obj) && MOCK_CALLS.has(m.name);
}

/** T02: `setTimeout(…)`, `sleep(…)`, or any `*.waitForTimeout(…)`. */
function isSleep(node) {
  if (node.callee.type === "Identifier") return SLEEPS.has(node.callee.name);
  const name = propOf(node.callee);
  if (name === "waitForTimeout") return true;
  return name === "setTimeout" && rootName(node.callee) !== null;
}

/** T05: `Object.isFrozen(…)` and the other shape probes. */
function isInternals(node) {
  const m = memberCall(node.callee);
  return m !== null && m.obj === "Object" && INTERNALS.has(m.name);
}

/** Is this argument a fixed message string: a string literal or a plain template. */
function isMessage(arg) {
  if (arg?.type === "Literal") return typeof arg.value === "string";
  return arg?.type === "TemplateLiteral" && arg.expressions.length === 0;
}

/** T07: `.toBeInstanceOf(…)`, an inline error snapshot, or `.toThrow("message")`. */
function isErrorShape(node) {
  const name = propOf(node.callee);
  if (ERROR_MATCHERS.has(name)) return true;
  return name === "toThrow" && isMessage(node.arguments[0]);
}

/** T08: `expect(isError(…))` — the first argument of `expect` is an `isError` call. */
function isGuardAssert(node) {
  if (node.callee.type !== "Identifier" || node.callee.name !== "expect") return false;
  const first = unwrap(node.arguments[0]);
  return first?.type === "CallExpression" && calleeName(first.callee) === "isError";
}

/** Test-file call rules, in the order a row is reported. */
const TEST_CALLS = [
  ["T01", isMock],
  ["T02", isSleep],
  ["T05", isInternals],
  ["T07", isErrorShape],
  ["T08", isGuardAssert],
];

/** S05: `throw new Error(…)`, `TypeError`, or `RangeError`. */
function isBareThrow(node) {
  const arg = node.argument;
  return arg?.type === "NewExpression" && BARE_ERRORS.has(arg.callee?.name);
}

/** S06: `console.<x>(…)`. */
function isConsole(node) {
  const m = memberCall(node.callee);
  return m !== null && m.obj === "console";
}

/** A cast (`as` or angle form) to `unknown`. */
function isUnknownCast(node) {
  const cast = node?.type === "TSAsExpression" || node?.type === "TSTypeAssertion";
  return cast && node.typeAnnotation?.type === "TSUnknownKeyword";
}

/** S02/T06: `x as unknown as T` — a cast whose operand is a cast to `unknown`. */
function isDoubleCast(node) {
  const cast = node.type === "TSAsExpression" || node.type === "TSTypeAssertion";
  return cast && isUnknownCast(unwrapParens(node.expression));
}

/** `as const`: a literal marker, not a claim about a value's type. */
function isConstMarker(node) {
  const t = node.typeAnnotation;
  return (
    t?.type === "TSTypeReference" &&
    t.typeName?.type === "Identifier" &&
    t.typeName.name === "const"
  );
}

/** S17: any other `x as T` or `<T>x`. The `as unknown as T` chain is S02's row, so neither of
 *  its two casts is reported here again. */
function isHidingCast(node) {
  const cast = node.type === "TSAsExpression" || node.type === "TSTypeAssertion";
  return (
    cast &&
    !isConstMarker(node) &&
    !isEmptyList(node.expression) &&
    !isUnknownCast(node) &&
    !isDoubleCast(node)
  );
}

/** `[] as readonly T[]` names an empty list's element type; no value can be wrong. */
function isEmptyList(node) {
  const at = unwrapParens(node);
  return at?.type === "ArrayExpression" && at.elements.length === 0;
}

/** Parens removed: the expression they wrap. */
function unwrapParens(node) {
  let at = node;
  while (at?.type === "ParenthesizedExpression") at = at.expression;
  return at;
}

/** T03: a `.only` or `.skip` member off `test`, `it`, or `describe`. */
function isFocus(node) {
  const name = propOf(node);
  return (name === "only" || name === "skip") && TEST_ROOTS.has(rootName(node.object));
}

/** T04: a module path into `../src/` that is not the public entry `src/index`. */
function isPrivateSrc(spec) {
  const m = typeof spec === "string" ? PRIVATE_SRC.exec(spec) : null;
  return m !== null && !PUBLIC_ENTRY.test(m[2]);
}

/** The module path an import, re-export, or `import(…)` names, or null. */
function modulePath(node) {
  const withSource =
    node.type === "ImportDeclaration" ||
    node.type === "ExportNamedDeclaration" ||
    node.type === "ExportAllDeclaration" ||
    node.type === "ImportExpression";
  return withSource ? (node.source?.value ?? null) : null;
}

/** Every rule id one test-file node breaks. */
function testIds(node) {
  const ids = [];
  if (node.type === "CallExpression")
    for (const [id, hit] of TEST_CALLS) if (hit(node)) ids.push(id);
  if (isFocus(node)) ids.push("T03");
  if (isPrivateSrc(modulePath(node))) ids.push("T04");
  if (isDoubleCast(node)) ids.push("T06");
  return ids;
}

/** Every rule id one source-file node breaks. S17 is writer policy only: the repo's own
 *  packages allow a plain cast at a typed boundary; the writer rules do not. */
function srcIds(node, writer) {
  const ids = [];
  if (isDoubleCast(node)) ids.push("S02");
  if (writer && isHidingCast(node)) ids.push("S17");
  if (node.type === "ThrowStatement" && isBareThrow(node)) ids.push("S05");
  if (node.type === "CallExpression" && isConsole(node)) ids.push("S06");
  return ids;
}

const NODE_RULES = { test: testIds, src: srcIds, other: () => [] };

/** S12/S13 rows from the parser's comment list, never from strings. */
function commentRows(comments, starts) {
  const rows = [];
  for (const c of comments) {
    const line = lineAt(starts, c.start);
    if (TS_DIRECTIVE.test(c.value)) rows.push(row("S12", line));
    if (LINT_DIRECTIVE.test(c.value)) rows.push(row("S13", line));
  }
  return rows;
}

/** One finding row for a rule id at a line. */
function row(id, line) {
  return { id, line, message: MESSAGES[id] };
}

/** The single row for a file the parser rejects, at the first error's line. */
function parseRow(errors, starts) {
  const at = errors[0].labels?.[0]?.start ?? 0;
  const why = errors[0].message ?? "syntax error";
  return {
    id: "parse",
    line: lineAt(starts, at),
    message: `file does not parse (${why}): fix the syntax so the plain rules can run`,
  };
}

/** Every plain rule break in one file, in source order. */
export function inspectPlain(source, file = "a.ts", { writer = false } = {}) {
  const { program, comments, errors } = parseSync(file, source);
  const starts = lineStarts(source);
  if (errors.length > 0) return [parseRow(errors, starts)];
  const rules = NODE_RULES[kindOf(file)];
  const rows = commentRows(comments, starts);
  walk(program, (node) => {
    for (const id of rules(node, writer)) rows.push(row(id, lineAt(starts, node.start)));
  });
  rows.sort((a, b) => a.line - b.line || (a.id < b.id ? -1 : 1));
  return rows;
}
