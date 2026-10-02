// Plain rule breaks (deterministic, no model): the style-census rules that match the writer
// guidelines (tools/writer-trial/guidelines.md), read off the oxc syntax tree and its comment
// list instead of raw text, so a rule word inside a string or a comment never counts. The
// census ids stay: T* for test files, S* for source files, S12/S13 for every file.
//
//   inspectPlain(source, file) → rows [{ id, line, message }] in source order
//
// A file that does not parse yields one `parse` row, never an empty list.
import {
  TSDocConfiguration,
  TSDocParser,
  TSDocTagDefinition,
  TSDocTagSyntaxKind,
} from "@microsoft/tsdoc";
import { parseSync } from "oxc-parser";
import { docs } from "./extract.mjs";

const TEST_PATH = /(^|\/)tests\/|\.(test|spec|browser)\./;
const SRC_PATH = /(^|\/)src\//;

/** Which rule family a path gets: test rules win over source rules. */
function kindOf(file) {
  if (TEST_PATH.test(file)) return "test";
  if (SRC_PATH.test(file)) return "src";
  return "other";
}

const MESSAGES = {
  S18: "unit built inside a function: declare every data, operation, resource, tag, and family once at module level; a builder function never creates one",
  S19: "helper takes a controller, scope, or session: a helper works on plain values; read and write cells inside the operation body",
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
  S20: "raw randomness: read ctx.random.next() or ctx.random.uuid(); a test seeds it with makeTestRandom",
  S21: "raw time: read ctx.clock.currentTimeMillis(), wait with ctx.clock.sleep(ms, ctx.signal); a test clock then drives it",
  S22: "a run's failure is dropped: call settle(call) and branch on its Result; a bare catch leaves a panic sticky (ADR 0067)",
  "S22.settle":
    "a settle's Result is dropped: settle recovers a panic, so an unread Result hides it (ADR 0067); read the Result, or call run and let the scope own the failure",
  S23: "hand-made subscribe: keep the value in a data cell; readers watch it or read it with useData",
  S24: "raw fetch: send through a copied HTTP endpoint operation so config, retry, spans, and the backend tag apply",
  S25: "component state: make it a data cell and read it with useData; write it from an operation",
  S26: "malformed TSDoc: the TSDoc parser rejects this doc",
  "S26.param": "a @param names no parameter of the declaration it documents",
  S27: "unguarded entry: a top-level await starts the program when a test imports it (ADR 0078)",
  "S29.ready": "lifetimeByHand: a failed ready closes the same root again (ADR 0085)",
  "S29.stop": "lifetimeByHand: an abort wait closes its root gracefully by hand (ADR 0085)",
  S28: "returned root: a function hands back a scope it made; build, use, and close the root in one function, and let a test build its own root (ADR 0078)",
};

/** The fix line a hand-rolled rule's message ends with: the tinker form, filled in. */
const FIXES = {
  S20: "`id: ctx.random.uuid()`",
  S21: "`await ctx.clock.sleep(ms, ctx.signal)`",
  S22: "`const r = await load.settle({ input: id })`",
  "S22.settle": "`const r = await load.settle({ input: id })`, then branch on `r.status`",
  S23: '`const status = data<WireStatus>({ label: "wire.status", initial: "connecting" })`',
  S24: "an endpoint operation, declared with the copied HTTP source in src/tinker/http/index.ts",
  S25: '`const running = data({ label: "bench.running", initial: false })`',
  S26: "escape `@`, `{`, `}`, and `>` in prose with a backslash, or put code in backticks on one line: `` `@tinker/core` ``, `{@link createScope}`",
  "S26.param": "`@param input - …` with the parameter's own name, or delete the line",
  S27: "`if (import.meta.main) await main(shell);`; for a server, `if (import.meta.main) process.exitCode = await runServer(process.env, stop.signal);`",
  "S29.ready":
    "nothing to close: `ready` rejects only after the forced close ended and every close hook ran (ADR 0085)",
  "S29.stop": "`createScope({ ...pieces, signal: stop })`, then `const end = await scope.closed`",
  S28: "`runServer(env, stop)` builds, uses, and closes its root, then returns an exit code or a Result",
};

const MOCK_ROOTS = new Set(["vi", "jest"]);
const MOCK_CALLS = new Set(["mock", "fn", "spyOn", "doMock", "stubGlobal", "useFakeTimers"]);
const TEST_ROOTS = new Set(["test", "it", "describe"]);
const INTERNALS = new Set(["isFrozen", "getPrototypeOf", "getOwnPropertyDescriptor"]);
const BARE_ERRORS = new Set(["Error", "TypeError", "RangeError"]);
const ERROR_MATCHERS = new Set(["toBeInstanceOf", "toThrowErrorMatchingInlineSnapshot"]);
const SLEEPS = new Set(["setTimeout", "sleep"]);
const PUBLIC_ENTRY =
  /^(?:[a-z-]+\/)?(?:index|testing|sse|pglite|migrations|dev|pages)(\.(ts|tsx|js))?$/;
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

/** One finding row for a rule id at a line; a rule with a fix line ends its message with it.
 *  `key` picks another message for the same id (`S22.settle`); `detail` names what this one
 *  hit found (the TSDoc parser's own words). */
function row(id, line, key = id, detail) {
  const fix = FIXES[key];
  const said = detail === undefined ? MESSAGES[key] : `${MESSAGES[key]} (${detail})`;
  return { id, line, message: fix ? `${said}. Fix: ${fix}` : said };
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

// ---------- no wrapper (ADR 0060, best-practices rules 3 and "helpers over values") ----------
// S18 is writer policy. S19 also checks app roots, examples, and stack source.

/** The unit builders S18 counts, by the module that exports them. A `family` is a keyed cell
 *  memoized per id (glossary), so one made inside a function is a second family under the same
 *  label: it counts like `data`. An `extension` does not count: a driver builds its extension
 *  from wiring rows inside a function by design (ADR 0051, ADR 0060). */
const UNIT_BUILDERS = new Map([
  ["@tinker/core", new Set(["data", "operation", "resource", "tag"])],
]);
const HANDLE_TYPE =
  /\b(DataController|Controller|Scope\.Handle|Scope\.RootHandle|Scope\.Session|Session)\b/;
const FN_NODE = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

/** Local names the file imports by name from `module` for one of `wanted`. */
function importedNames(program, module, wanted) {
  const specs = program.body
    .filter((n) => n.type === "ImportDeclaration" && n.source.value === module)
    .flatMap((n) => n.specifiers ?? []);
  const named = specs.filter(
    (sp) => sp.type === "ImportSpecifier" && wanted.has(sp.imported?.name),
  );
  return named.map((sp) => sp.local.name);
}

/** Local names the file imports for the unit builders S18 counts. */
function builderNames(program) {
  const names = [...UNIT_BUILDERS].flatMap(([module, wanted]) =>
    importedNames(program, module, wanted),
  );
  const sync = program.body
    .filter(
      (n) =>
        n.type === "ImportDeclaration" &&
        n.source.value.startsWith(".") &&
        /(?:^|\/)sync\/index\.ts$/.test(n.source.value),
    )
    .flatMap((n) => n.specifiers ?? [])
    .filter((sp) => sp.type === "ImportSpecifier" && sp.imported?.name === "family")
    .map((sp) => sp.local.name);
  return new Set([...names, ...sync]);
}

/** Is this node a call to one of the named builders. */
const callsBuilder = (node, names) =>
  node.type === "CallExpression" &&
  node.callee?.type === "Identifier" &&
  names.has(node.callee.name);

/** The object children of a node, skipping the parent link. */
const childrenOf = (node) =>
  Object.entries(node)
    .filter(([k, v]) => k !== "parent" && v && typeof v === "object")
    .map(([, v]) => v);

/** S18: every builder call that sits inside some function body. */
function builderCallsInFunctions(program, names) {
  const hits = [];
  const visit = (node, depth) => {
    if (!node) return;
    if (Array.isArray(node)) return node.forEach((n) => visit(n, depth));
    if (depth > 0 && callsBuilder(node, names)) hits.push(["S18", node.start]);
    const inner = FN_NODE.has(node.type) ? depth + 1 : depth;
    for (const child of childrenOf(node)) visit(child, inner);
  };
  visit(program.body, 0);
  return hits;
}

/** Same-file type aliases whose body names a controller, scope, or session. */
function handleAliases(source, program) {
  const names = [];
  for (const n0 of program.body) {
    const n = n0.type === "ExportNamedDeclaration" ? n0.declaration : n0;
    if (
      n?.type === "TSTypeAliasDeclaration" &&
      HANDLE_TYPE.test(source.slice(n.typeAnnotation.start, n.typeAnnotation.end))
    )
      names.push(n.id.name);
  }
  return names;
}

/** A top-level statement without its export wrapper. */
const unexported = (n) =>
  n.type === "ExportNamedDeclaration" || n.type === "ExportDefaultDeclaration" ? n.declaration : n;

/** The functions one top-level statement declares: itself, or its function-valued consts. */
function fnsIn(n) {
  if (n?.type === "FunctionDeclaration") return [n];
  if (n?.type !== "VariableDeclaration") return [];
  return n.declarations.filter((d) => FN_NODE.has(d.init?.type)).map((d) => d.init);
}

/** The top-level functions of a file: declarations and function-valued consts. */
const topFunctions = (program) => program.body.flatMap((n) => fnsIn(unexported(n)));

/** S19: a top-level helper whose parameter type holds a controller, scope, or session. */
function handleParams(source, program) {
  const aliases = handleAliases(source, program);
  const holds = (t) => HANDLE_TYPE.test(t) || aliases.some((a) => new RegExp(`\\b${a}\\b`).test(t));
  const hits = [];
  for (const fn of topFunctions(program))
    for (const p of fn.params ?? []) {
      const ann = p.typeAnnotation ?? p.left?.typeAnnotation;
      if (ann && holds(source.slice(ann.start, ann.end))) hits.push(["S19", p.start]);
    }
  return hits;
}

/** The writer-mode no-wrapper rows of one source file: [id, offset] pairs. */
function noWrapperHits(source, program, file, writer) {
  if (kindOf(file) === "test") return [];
  const writerSource = writer && SRC_PATH.test(file);
  return [
    ...(writerSource ? builderCallsInFunctions(program, builderNames(program)) : []),
    ...(writerSource || /(^|\/)(apps\/[^/]+\/src\/|examples\/|registry\/src\/stack\/)/.test(file)
      ? handleParams(source, program)
      : []),
  ];
}

// ---------- hand-rolled: code that redoes what tinker gives (S20–S25) ----------
// From the 2026-09-27 survey (docs/roadmap/jev-handrolled). Any file that is not a test. S21
// counts only inside a unit body (an operation run, a resource factory, an extension start) in
// both lanes: outside one there is no ctx to reach, and a blocking rule may have no known false
// hit (ADR 0068). The writer gate reads the other rules over the whole file. The repo lint is
// narrower: S20 skips packages/core/src (the default randomness source); S23 and S24 count only
// in apps/ and examples/ (packages are the providers); S25 is writer policy only (a benchmark's
// plain-React control is a trap by design).

const CORE_SRC = /(^|\/)packages\/core\/src\//;
const USERLAND = /(^|\/)(apps|examples)\//;
const PACKAGE_SRC =
  /(^|\/)(?:packages\/[^/]+\/src\/|registry\/src\/|tools\/blueprint\/(?:src|tinker)\/)/;
const BROWSER_ENTRY = /\.tsx$|(^|\/)client\//;
const GLOBALS = new Set(["globalThis", "window", "self"]);
const RANDOM = new Map([
  ["Math", new Set(["random"])],
  ["crypto", new Set(["randomUUID", "getRandomValues"])],
]);
const RANDOM_IMPORTS = new Set(["randomUUID", "getRandomValues"]);
const CLOCK = new Map([
  ["Date", new Set(["now"])],
  ["performance", new Set(["now"])],
]);
const TIMERS = new Set(["setTimeout", "setInterval"]);
const STATE_HOOKS = new Set(["useState", "useReducer"]);
const TRANSPORT_PAIR = new Set(["onMessage", "onClose"]);
const LISTEN = /^on[A-Z]/;
const HANDLE_MAKERS = new Set(["createScope", "createSession", "useScope"]);
/** The config path to each core builder's body; extension hooks are nested. */
const UNIT_BODY = new Map([
  ["operation", ["run"]],
  ["resource", ["factory"]],
  ["extension", ["hooks", "start"]],
]);

/** The global a name reads: `x` itself, or `x` off `globalThis`, `window`, or `self`. */
function globalName(node) {
  if (node?.type === "Identifier") return node.name;
  const name = propOf(node);
  return name !== null && GLOBALS.has(node.object?.name) ? name : null;
}

/** Is this `G.name` (or `globalThis.G.name`) for a `G` in `table` that lists `name`. */
function isGlobalMember(node, table) {
  const name = propOf(node);
  return name !== null && table.get(globalName(node.object))?.has(name) === true;
}

/** S20: `Math.random`, `crypto.randomUUID`, or `crypto.getRandomValues` — called or passed as
 *  a value — or a call of `randomUUID` imported from node:crypto. */
function isRawRandom(node, cryptoNames) {
  if (node.type === "MemberExpression") return isGlobalMember(node, RANDOM);
  return (
    node.type === "CallExpression" &&
    node.callee.type === "Identifier" &&
    cryptoNames.has(node.callee.name)
  );
}

/** S21: a call of `Date.now`, `performance.now`, `setTimeout`, or `setInterval`, or a bare
 *  `new Date()`. `new Date(ms)` formats a saved time and reads no clock. */
function isRawClock(node) {
  if (node.type === "NewExpression")
    return globalName(node.callee) === "Date" && node.arguments.length === 0;
  if (node.type !== "CallExpression") return false;
  return isGlobalMember(node.callee, CLOCK) || TIMERS.has(globalName(node.callee));
}

/** Is this a call of a member named `run` (`load.run(…)`). */
const isRunCall = (node) => {
  const at = unwrapParens(node);
  return at?.type === "CallExpression" && propOf(at.callee) === "run";
};

/** A handler that drops what it gets: `() => undefined`, `() => void 0`, or `() => {}`. */
function isDropper(fn) {
  if (fn?.type !== "ArrowFunctionExpression" && fn?.type !== "FunctionExpression") return false;
  const body = unwrapParens(fn.body);
  if (body.type === "BlockStatement") return body.body.length === 0;
  if (body.type === "Identifier") return body.name === "undefined";
  return body.type === "UnaryExpression" && body.operator === "void";
}

/** S22 shape A: `x.run(…).then(ok, drop)` or `x.run(…).catch(drop)`. */
function isDroppedRun(node) {
  if (node.type !== "CallExpression") return false;
  const name = propOf(node.callee);
  if (name !== "then" && name !== "catch") return false;
  const drop = name === "then" ? node.arguments[1] : node.arguments[0];
  return isRunCall(node.callee.object) && isDropper(drop);
}

/** Does `node` await a run, outside any nested function. */
function awaitsRun(node) {
  if (!node || typeof node !== "object") return false;
  if (Array.isArray(node)) return node.some(awaitsRun);
  if (FN_NODE.has(node.type)) return false;
  if (node.type === "AwaitExpression" && isRunCall(node.argument)) return true;
  return childrenOf(node).some(awaitsRun);
}

/** S22 shape B: `try { await x.run(…) } catch { … }` — a catch with no parameter cannot tell a
 *  managed error from a panic. Reported at the catch. */
const isBareCatchRun = (node) =>
  node.type === "TryStatement" && node.handler?.param === null && awaitsRun(node.block);

/** Is this a call of a member named `settle` (`load.settle(…)`). */
const isSettleCall = (node) => node?.type === "CallExpression" && propOf(node.callee) === "settle";

/** The settle call whose Result a node drops: `x.settle(…);` or `await x.settle(…);` as a
 *  statement, or `void x.settle(…)`. Else null. */
function droppedSettle(node) {
  const byVoid = node.type === "UnaryExpression" && node.operator === "void";
  if (!byVoid && node.type !== "ExpressionStatement") return null;
  let at = unwrapParens(byVoid ? node.argument : node.expression);
  if (at?.type === "AwaitExpression") at = unwrapParens(at.argument);
  return isSettleCall(at) ? at : null;
}

/** The patterns each binding pattern holds. */
const PATTERN_PARTS = {
  ObjectPattern: (p) => p.properties.map((q) => (q.type === "RestElement" ? q.argument : q.value)),
  ArrayPattern: (p) => p.elements,
  AssignmentPattern: (p) => [p.left],
  RestElement: (p) => [p.argument],
};

/** The names a binding pattern declares: `b` and `d` in `{ a: b, ...d }`. */
function boundNames(p) {
  if (p?.type === "Identifier") return [p.name];
  const parts = PATTERN_PARTS[p?.type];
  return parts ? parts(p).flatMap(boundNames) : [];
}

/** The function a `.session(…)` call runs: its last argument, or null. */
function sessionFn(node) {
  if (node.type !== "CallExpression" || propOf(node.callee) !== "session") return null;
  const fn = node.arguments.at(-1);
  return FN_NODE.has(fn?.type) ? fn : null;
}

/** Does a const's value make a handle: `createScope(…)`, `x.createSession(…)`, `useScope()`. */
function makesHandle(init) {
  const at = unwrapParens(init);
  return at?.type === "CallExpression" && HANDLE_MAKERS.has(calleeName(at.callee));
}

/** Names the whole file binds to a handle: a parameter or const typed as a controller, scope,
 *  or session, or a const one of the handle makers returns. */
function fileHandles(source, program) {
  const names = new Set();
  walk(program, (n) => {
    const ann = n.type === "Identifier" ? n.typeAnnotation : null;
    if (ann && HANDLE_TYPE.test(source.slice(ann.start, ann.end))) names.add(n.name);
    if (n.type === "VariableDeclarator" && n.id.type === "Identifier" && makesHandle(n.init))
      names.add(n.id.name);
  });
  return names;
}

/** Is `name` at an offset a core handle. Plain code cannot see types, so a handle is a name the
 *  file binds to one: a parameter of a unit body (the deps it destructures, `ctx`, an
 *  extension's `scope`) or of a `.session(…)` callback, inside that function; or a name
 *  `fileHandles` finds, anywhere in the file. */
function handleTest(source, program, units) {
  const whole = fileHandles(source, program);
  const fns = [...units];
  walk(program, (n) => {
    const fn = sessionFn(n);
    if (fn !== null) fns.push(fn);
  });
  const scoped = fns.map((fn) => ({ names: new Set(fn.params.flatMap(boundNames)), fn }));
  return (name, at) =>
    whole.has(name) ||
    scoped.some(({ names, fn }) => fn.start <= at && at < fn.end && names.has(name));
}

/** S22 shape C: a dropped settle on a core handle. A local object's own `settle` method (a
 *  transaction, a waiter, a borrow) is not core's, so the receiver must be a handle. */
function droppedSettleAt(node, facts) {
  const call = droppedSettle(node);
  if (call === null) return [];
  return facts.isHandle(rootName(call.callee.object), call.start) ? [node.start] : [];
}

/** The function a property holds: its value, or the method itself. */
const fnOf = (prop) => (FN_NODE.has(prop.value?.type) ? prop.value : null);

/** The function a body returns: an arrow's expression, or a top-level `return`. */
function returnedFn(fn) {
  if (FN_NODE.has(fn.body?.type)) return fn.body;
  const ret = (fn.body?.body ?? []).find((st) => st.type === "ReturnStatement");
  return FN_NODE.has(ret?.argument?.type) ? ret.argument : null;
}

/** Does `node` name the identifier `name` anywhere. */
function mentions(node, name) {
  let found = false;
  walk(node, (n) => {
    if (n.type === "Identifier" && n.name === name) found = true;
  });
  return found;
}

/** The list a call adds `name` to: `S` in `S.add(name)` or `S.push(name)`, else null. */
function addTarget(node, name) {
  const m = node.type === "CallExpression" ? memberCall(node.callee) : null;
  if (m === null || (m.name !== "add" && m.name !== "push")) return null;
  const arg = node.arguments[0];
  return arg?.type === "Identifier" && arg.name === name ? m.obj : null;
}

/** The list `fn` adds its first parameter to (`S.add(listener)` or `S.push(listener)`), or null. */
function listenerStore(fn) {
  const param = fn.params?.[0];
  if (param?.type !== "Identifier") return null;
  let store = null;
  walk(fn.body, (n) => {
    store ??= addTarget(n, param.name);
  });
  return store;
}

/** S23: `onX(listener)` that adds the listener to a list and returns a remover that touches it. */
function isHandSubscribe(fn) {
  const store = listenerStore(fn);
  const remover = store === null ? null : returnedFn(fn);
  return remover !== null && mentions(remover, store);
}

/** S23 hits in one object literal. Its `onMessage`/`onClose` are the `Sync.Transport` contract
 *  when the same object also has `send` and `close`: sync requires those, so they are skipped. */
function handSubscribes(node) {
  const props = node.properties.filter((p) => p.type === "Property" && !p.computed);
  const keys = new Set(props.map((p) => p.key?.name));
  const transport = keys.has("send") && keys.has("close");
  return props.filter((p) => {
    const name = p.key?.name ?? "";
    if (!LISTEN.test(name) || (transport && TRANSPORT_PAIR.has(name))) return false;
    const fn = fnOf(p);
    return fn !== null && isHandSubscribe(fn);
  });
}

/** S24: a call of `fetch` or `globalThis.fetch`. */
const isRawFetch = (node) => node.type === "CallExpression" && globalName(node.callee) === "fetch";

/** S25: a call of `useState` or `useReducer`, bare or off a namespace. */
const isComponentState = (node) =>
  node.type === "CallExpression" && STATE_HOOKS.has(calleeName(node.callee));

/** Imported aliases use the same body path as the core builder they name. */
function bodiesOf(node, local) {
  const path = node.type === "CallExpression" ? local.get(node.callee?.name) : undefined;
  if (path === undefined) return [];
  let values = [node.arguments[0]];
  for (const key of path) {
    values = values.flatMap((config) => {
      if (config?.type !== "ObjectExpression") return [];
      return config.properties
        .filter((p) => p.type === "Property" && p.key?.name === key)
        .map((p) => p.value);
    });
  }
  return values.filter((value) => FN_NODE.has(value?.type));
}

/** Only imported core builders define the bodies S21 checks. */
function unitBodies(program) {
  const local = new Map();
  for (const [name, path] of UNIT_BODY)
    for (const as of importedNames(program, "@tinker/core", new Set([name]))) local.set(as, path);
  const fns = [];
  walk(program, (n) => fns.push(...bodiesOf(n, local)));
  return fns;
}

/** Is an offset inside one of the unit bodies. */
const unitTest = (units) => (at) => units.some((fn) => fn.start <= at && at < fn.end);

/** Local names the file imports `randomUUID` or `getRandomValues` under from node:crypto. */
const cryptoNames = (program) =>
  new Set(["node:crypto", "crypto"].flatMap((m) => importedNames(program, m, RANDOM_IMPORTS)));

/** Only the positive main branch guards startup; its condition and else branch still run on import. */
function isMainGuard(node) {
  const at = unwrapParens(node);
  return (
    propOf(at) === "main" &&
    at.object.type === "MetaProperty" &&
    at.object.meta.name === "import" &&
    at.object.property.name === "meta"
  );
}

const isAwait = (node) =>
  node.type === "AwaitExpression" ||
  (node.type === "ForOfStatement" && node.await) ||
  (node.type === "VariableDeclaration" && node.kind === "await using");

function hasUnguardedAwait(node) {
  if (!node) return false;
  if (Array.isArray(node)) return node.some(hasUnguardedAwait);
  if (FN_NODE.has(node.type)) return false;
  if (isAwait(node)) return true;
  if (node.type === "IfStatement" && isMainGuard(node.test))
    return hasUnguardedAwait(node.alternate);
  return childrenOf(node).some(hasUnguardedAwait);
}

/** S27 reports once per top-level statement, even when it contains several awaits. */
const unguardedEntries = (program) =>
  program.body.filter(hasUnguardedAwait).map((n) => ["S27", n.start]);

/** Type wrappers and parens do not change which value a return hands back. */
function returnedValue(node) {
  let at = unwrapParens(node);
  while (
    ["TSAsExpression", "TSTypeAssertion", "TSSatisfiesExpression", "TSNonNullExpression"].includes(
      at?.type,
    )
  )
    at = unwrapParens(at.expression);
  return at;
}

const makesRoot = (node) => {
  const at = returnedValue(node);
  return at?.type === "CallExpression" && calleeName(at.callee) === "createScope";
};

const ROOT_BLOCKS = new Set([
  "BlockStatement",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "SwitchStatement",
  "CatchClause",
]);

function bindRootDeclaration(node, frame, root) {
  const target = node.kind === "var" ? root : frame;
  for (const decl of node.declarations)
    for (const name of boundNames(decl.id))
      target.names.set(name, decl.id.type === "Identifier" && makesRoot(decl.init));
}

function bindRootNames(node, frame, root) {
  if (node.type === "VariableDeclaration") bindRootDeclaration(node, frame, root);
  if (node.type === "CatchClause")
    for (const name of boundNames(node.param)) frame.names.set(name, false);
  if (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration")
    if (node.id) frame.names.set(node.id.name, false);
}

/** Keep each return with its block so a nearer binding can hide a scope with the same name. */
function rootReturns(fn) {
  const root = { names: new Map(), parent: null };
  const returns = [];
  const visit = (node, outer) => {
    if (!node) return;
    if (Array.isArray(node)) return node.forEach((n) => visit(n, outer));
    const frame = ROOT_BLOCKS.has(node.type) ? { names: new Map(), parent: outer } : outer;
    bindRootNames(node, frame, root);
    if (FN_NODE.has(node.type)) return;
    if (node.type === "ReturnStatement") returns.push({ value: node.argument, frame });
    for (const child of childrenOf(node)) visit(child, frame);
  };
  visit(fn.body, root);
  if (fn.body.type !== "BlockStatement") returns.push({ value: fn.body, frame: root });
  return returns;
}

function isRootName(name, frame) {
  for (let at = frame; at !== null; at = at.parent)
    if (at.names.has(name)) return at.names.get(name);
  return false;
}

/** Returning a closure that uses a scope does not return the scope itself. */
function returnsRoot(value, frame) {
  const at = returnedValue(value);
  if (makesRoot(at)) return true;
  if (at?.type === "Identifier") return isRootName(at.name, frame);
  if (at?.type !== "ObjectExpression") return false;
  return at.properties.some((p) => p.type === "Property" && returnsRoot(p.value, frame));
}

function ownerInputs(node) {
  if (node.type === "CallExpression" || node.type === "NewExpression") return node.arguments;
  if (node.type === "JSXAttribute" && node.value?.type === "JSXExpressionContainer")
    return [node.value.expression];
  return [];
}

/** A direct factory argument hands ownership to its caller; a factory returned from it still counts. */
function ownerFactories(program) {
  const factories = new Set();
  walk(program, (node) => {
    for (const value of ownerInputs(node)) {
      const fn = unwrapParens(value);
      if (FN_NODE.has(fn?.type)) factories.add(fn);
    }
  });
  return factories;
}

const returnedRootAt = (node, facts) =>
  FN_NODE.has(node.type) &&
  node.body &&
  !facts.ownerFactories.has(node) &&
  rootReturns(node).some(({ value, frame }) => returnsRoot(value, frame))
    ? [node.start]
    : [];

// ---------- lifetime by hand (ADR 0085) ----------

const CORE_PATH = /(^|\/)packages\/core\//;
const SCOPE_TYPE = /\bScope\.(Handle|RootHandle)\b/;
const ROOT_MAKERS = new Set(["createScope", "useScope"]);

/** One record per declaration, so an inner name never stands for an outer root. */
function bindLifetime(pattern, init, kind, frame, source) {
  const id = pattern?.type === "AssignmentPattern" ? pattern.left : pattern;
  const simple = id?.type === "Identifier";
  const ann = simple ? id.typeAnnotation : null;
  const typed = ann && SCOPE_TYPE.test(source.slice(ann.start, ann.end));
  for (const name of boundNames(pattern))
    frame.names.set(name, {
      init: simple ? init : null,
      kind,
      typed,
      fn: frame.fn,
    });
}

function lifetimeVariables(node, frame, source) {
  let target = frame;
  if (node.kind === "var") while (!target.functionScope) target = target.parent;
  for (const decl of node.declarations) bindLifetime(decl.id, decl.init, node.kind, target, source);
}

function lifetimeDeclarations(node, frame, source) {
  if (node.type === "VariableDeclaration") lifetimeVariables(node, frame, source);
  if (node.type === "CatchClause") bindLifetime(node.param, null, "catch", frame, source);
  if (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration")
    bindLifetime(node.id, node, "declaration", frame, source);
  if (node.type === "ImportDeclaration")
    for (const spec of node.specifiers) bindLifetime(spec.local, null, "import", frame, source);
}

function lifetimeFrame(node, outer, source) {
  if (FN_NODE.has(node.type)) {
    const frame = { names: new Map(), parent: outer, fn: node, functionScope: true };
    if (node.id) bindLifetime(node.id, node, "declaration", frame, source);
    for (const param of node.params) bindLifetime(param, null, "param", frame, source);
    return frame;
  }
  return ROOT_BLOCKS.has(node.type)
    ? { names: new Map(), parent: outer, fn: outer.fn, functionScope: false }
    : outer;
}

/** Build scopes before reading any uses; a later declaration still hides an outer name. */
function lifetimeFacts(source, program) {
  const frames = new WeakMap();
  const nodes = [];
  const visit = (node, outer) => {
    if (!node) return;
    if (Array.isArray(node)) return node.forEach((n) => visit(n, outer));
    if (node.type === "FunctionDeclaration") lifetimeDeclarations(node, outer, source);
    const frame = lifetimeFrame(node, outer, source);
    frames.set(node, frame);
    nodes.push(node);
    lifetimeDeclarations(node, frame, source);
    for (const child of childrenOf(node)) visit(child, frame);
  };
  visit(program, { names: new Map(), parent: null, fn: null, functionScope: true });
  return { frames, nodes };
}

function lifetimeBinding(node, facts) {
  const at = returnedValue(node);
  if (at?.type !== "Identifier") return null;
  for (let frame = facts.frames.get(at); frame; frame = frame.parent)
    if (frame.names.has(at.name)) return frame.names.get(at.name);
  return null;
}

/** Sessions never count, even if their variable uses the shared Scope.Handle type. */
function knownRoot(binding) {
  if (!binding) return false;
  const init = returnedValue(binding.init);
  const maker = init?.type === "CallExpression" ? calleeName(init.callee) : null;
  if (maker === "createSession") return false;
  return Boolean(binding.typed || (binding.kind === "const" && ROOT_MAKERS.has(maker)));
}

/** Statements executed in this body, with nested function bodies left to their own callers. */
function lifetimeBody(node) {
  const nodes = [];
  const visit = (at) => {
    if (!at) return;
    if (Array.isArray(at)) return at.forEach(visit);
    if (FN_NODE.has(at.type)) return;
    nodes.push(at);
    for (const child of childrenOf(at)) visit(child);
  };
  visit(node);
  return nodes;
}

function lifetimeCallback(node, facts) {
  const at = returnedValue(node);
  const fn = at?.type === "Identifier" ? returnedValue(lifetimeBinding(at, facts)?.init) : at;
  return FN_NODE.has(fn?.type) ? fn : null;
}

function readyRoot(node, facts) {
  const at = returnedValue(node);
  if (propOf(at) !== "ready") return null;
  const binding = lifetimeBinding(at.object, facts);
  return knownRoot(binding) ? binding : null;
}

function closeRoot(node, facts) {
  if (node.type !== "CallExpression" || propOf(node.callee) !== "close") return null;
  return lifetimeBinding(node.callee.object, facts);
}

function closesIn(body, roots, facts) {
  return lifetimeBody(body)
    .filter((n) => roots.has(closeRoot(n, facts)))
    .map((n) => ["S29", n.start, "S29.ready"]);
}

function readyStatementRoot(node, facts) {
  if (node.type !== "ExpressionStatement") return null;
  const expression = returnedValue(node.expression);
  return expression.type === "AwaitExpression" ? readyRoot(expression.argument, facts) : null;
}

/** Other work can fail after ready resolved, so its catch still owns cleanup. */
function readyTryHits(node, facts) {
  if (!node.handler) return [];
  const roots = node.block.body.map((statement) => readyStatementRoot(statement, facts));
  const [root] = roots;
  if (!root || !roots.every((binding) => binding === root)) return [];
  return closesIn(node.handler.body, new Set([root]), facts);
}

function readyCatchHits(node, facts) {
  if (node.type === "TryStatement") return readyTryHits(node, facts);
  if (node.type !== "CallExpression") return [];
  const method = propOf(node.callee);
  if (method !== "catch" && method !== "then") return [];
  const root = readyRoot(node.callee.object, facts);
  const fail = lifetimeCallback(node.arguments[method === "catch" ? 0 : 1], facts);
  return root && fail ? closesIn(fail.body, new Set([root]), facts) : [];
}

const abortListener = (node) =>
  node.type === "CallExpression" &&
  propOf(node.callee) === "addEventListener" &&
  node.arguments[0]?.value === "abort";

function abortWait(node, facts) {
  let at = returnedValue(node.argument);
  if (at?.type === "Identifier") at = returnedValue(lifetimeBinding(at, facts)?.init);
  if (at?.type === "CallExpression")
    return calleeName(at.callee) === "once" && at.arguments[1]?.value === "abort";
  return abortPromise(at, facts);
}

function abortPromise(at, facts) {
  if (at?.type !== "NewExpression" || at.callee.name !== "Promise") return false;
  const executor = lifetimeCallback(at.arguments[0], facts);
  return (
    executor !== null &&
    lifetimeBody(executor.body).some((n) => abortListener(n) || propOf(n) === "aborted")
  );
}

/** Only a literal true opts into graceful close; a forced stop remains the caller's job. */
function gracefulClose(node) {
  if (node.type !== "CallExpression" || propOf(node.callee) !== "close") return false;
  const options = returnedValue(node.arguments[0]);
  if (options?.type !== "ObjectExpression") return false;
  const last = options.properties.findLast(
    (p) => p.type === "SpreadElement" || p.computed || (p.key?.name ?? p.key?.value) === "graceful",
  );
  return last?.type === "Property" && !last.computed && last.value.value === true;
}

function ownedRoot(node, owner, facts) {
  const binding = closeRoot(node, facts);
  return (
    owner !== null && binding?.fn === owner && binding.kind === "const" && makesRoot(binding.init)
  );
}

function stopListenerHits(node, facts) {
  if (!abortListener(node)) return [];
  const fn = lifetimeCallback(node.arguments[1], facts);
  if (!fn) return [];
  const owner = facts.frames.get(node).fn;
  return lifetimeBody(fn.body)
    .filter((n) => gracefulClose(n) && ownedRoot(n, owner, facts))
    .map((n) => ["S29", n.start, "S29.stop"]);
}

function stopWaitHits(node, waits, facts) {
  if (!gracefulClose(node)) return [];
  const owner = facts.frames.get(node).fn;
  if (!ownedRoot(node, owner, facts)) return [];
  const init = closeRoot(node, facts).init;
  return waits.some(
    (wait) =>
      facts.frames.get(wait).fn === owner && init.start < wait.start && wait.start < node.start,
  )
    ? [["S29", node.start, "S29.stop"]]
    : [];
}

/** Ready still owns cleanup in a test; stop checks keep the non-test lane. */
function lifetimeHits(source, program, file, writer) {
  if (CORE_PATH.test(file)) return [];
  if (!writer && !USERLAND.test(file) && !PACKAGE_SRC.test(file) && kindOf(file) !== "test")
    return [];
  const facts = lifetimeFacts(source, program);
  const waits = facts.nodes.filter((n) => n.type === "AwaitExpression" && abortWait(n, facts));
  const hits = facts.nodes.flatMap((node) => [
    ...readyCatchHits(node, facts),
    ...(kindOf(file) === "test"
      ? []
      : [...stopListenerHits(node, facts), ...stopWaitHits(node, waits, facts)]),
  ]);
  return [...new Map(hits.map((hit) => [`${hit[1]}:${hit[2]}`, hit])).values()];
}

/** Which hand-rolled rules one file gets, by lane and path. */
function handRolledScope(file, writer) {
  return {
    S20: !CORE_SRC.test(file),
    S21: true,
    S22: true,
    S23: writer || USERLAND.test(file),
    S24: writer || USERLAND.test(file),
    S25: writer && file.endsWith(".tsx"),
    S27: !BROWSER_ENTRY.test(file) && (writer || USERLAND.test(file) || PACKAGE_SRC.test(file)),
    S28: writer || USERLAND.test(file),
  };
}

/** S22's offsets for one node: shape A at the call, shape B at the catch. */
function droppedRunAt(node) {
  if (isDroppedRun(node)) return [node.start];
  return isBareCatchRun(node) ? [node.handler.start] : [];
}

/** Each hand-rolled rule: the offsets one node reports, and the message key when it is not the
 *  id. `facts` holds the file's crypto imports, its unit-body test, and its handle test. */
const HAND_ROLLED = [
  ["S20", (n, facts) => (isRawRandom(n, facts.cryptoNames) ? [n.start] : [])],
  ["S21", (n, facts) => (isRawClock(n) && facts.inUnit(n.start) ? [n.start] : [])],
  ["S22", droppedRunAt],
  ["S22", droppedSettleAt, "S22.settle"],
  ["S23", (n) => (n.type === "ObjectExpression" ? handSubscribes(n).map((p) => p.start) : [])],
  ["S24", (n) => (isRawFetch(n) ? [n.start] : [])],
  ["S25", (n) => (isComponentState(n) ? [n.start] : [])],
  ["S28", returnedRootAt],
];

/** The hand-rolled rows of one non-test file: [id, offset, key] triples. */
function handRolledHits(source, program, file, writer) {
  const on = handRolledScope(file, writer);
  const checks = HAND_ROLLED.filter(([id]) => on[id]);
  const units = unitBodies(program);
  const facts = {
    cryptoNames: cryptoNames(program),
    inUnit: unitTest(units),
    isHandle: handleTest(source, program, units),
    ownerFactories: ownerFactories(program),
  };
  const hits = on.S27 ? unguardedEntries(program) : [];
  walk(program, (n) => {
    for (const [id, check, key = id] of checks)
      for (const at of check(n, facts)) hits.push([id, at, key]);
  });
  return hits;
}

/** The rows read off the whole program, not one node: writer no-wrapper, then hand-rolled. */
function programHits(source, program, file, writer) {
  const kind = kindOf(file);
  return [
    ...noWrapperHits(source, program, file, writer),
    ...lifetimeHits(source, program, file, writer),
    ...(kind === "test" ? [] : handRolledHits(source, program, file, writer)),
  ];
}

// ---------- TSDoc (S26, coding-convention rule 10) ----------
// Every file, both lanes. The parser is the TSDoc reference one, on its default tags plus the
// repo's own: every standard tag (`@remarks`, `@example`, `@param`, `{@link}`, `@internal`, …)
// and every tag in CUSTOM_TAGS passes, and any other (`@type`, `@default`, a package name like
// `@tinker/core` left bare in prose) hits.

/** The repo's own TSDoc tags. `@ambientSource`: the declaration `scripts/check-ambient.mjs`
 *  lets read the real clock or randomness (ADR 0034, 0062). */
const CUSTOM_TAGS = ["@ambientSource"];

const TSDOC_CONFIG = new TSDocConfiguration();
TSDOC_CONFIG.addTagDefinitions(
  CUSTOM_TAGS.map(
    (tagName) => new TSDocTagDefinition({ tagName, syntaxKind: TSDocTagSyntaxKind.ModifierTag }),
  ),
);
const TSDOC = new TSDocParser(TSDOC_CONFIG);

/** The offset of a `@param` block's tag inside its doc. */
const tagOffset = (block) => block.blockTag.getTokenSequence().tokens[0].range.pos;

/** `@param` rows for one doc: each name that is not a parameter of its declaration. A doc on
 *  no function has no parameters; a destructured parameter lets any name stand for it. */
function paramRows(doc, docComment, starts) {
  const names = doc.declaration === null ? [] : doc.declaration.params;
  if (names === null) return [];
  return docComment.params.blocks
    .filter((block) => block.parameterName !== "")
    .filter((block) => !names.includes(block.parameterName.split(".")[0]))
    .map((block) =>
      row(
        "S26",
        lineAt(starts, doc.start + tagOffset(block)),
        "S26.param",
        `@param ${block.parameterName}`,
      ),
    );
}

/** S26 rows for one file: each TSDoc parser message at its line, then each `@param` whose
 *  name is not a parameter of the declaration the doc sits on. */
export function tsdocRows(source, file = "a.ts") {
  const starts = lineStarts(source);
  return docs(source, file).flatMap((doc) => {
    const { docComment, log } = TSDOC.parseString(doc.raw);
    const parsed = log.messages.map((m) =>
      row(
        "S26",
        lineAt(starts, doc.start + m.textRange.pos),
        "S26",
        `${m.messageId}: ${m.unformattedText}`,
      ),
    );
    return [...parsed, ...paramRows(doc, docComment, starts)];
  });
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
  for (const [id, at, key] of programHits(source, program, file, writer))
    rows.push(row(id, lineAt(starts, at), key));
  rows.push(...tsdocRows(source, file));
  rows.sort((a, b) => a.line - b.line || (a.id < b.id ? -1 : 1));
  return rows;
}
