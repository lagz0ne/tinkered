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
  S23: "hand-made subscribe: keep the value in a data cell; readers watch it or read it with useData",
  S24: "raw fetch: send through an @tinker/http endpoint operation so config, retry, spans, and the backend tag apply",
  S25: "component state: make it a data cell and read it with useData; write it from an operation",
};

/** The fix line a hand-rolled rule's message ends with: the tinker form, filled in. */
const FIXES = {
  S20: "`id: ctx.random.uuid()`",
  S21: "`await ctx.clock.sleep(ms, ctx.signal)`",
  S22: "`const r = await load.settle({ input: id })`",
  S23: '`const status = data<WireStatus>({ label: "wire.status", initial: "connecting" })`',
  S24: "an endpoint operation, like `postIssue` in apps/issue-tracker/src/client/api.ts",
  S25: '`const running = data({ label: "bench.running", initial: false })`',
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

/** One finding row for a rule id at a line; a rule with a fix line ends its message with it. */
function row(id, line) {
  const fix = FIXES[id];
  return { id, line, message: fix ? `${MESSAGES[id]}. Fix: ${fix}` : MESSAGES[id] };
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
// Writer policy only: S18 and S19 run when `writer` is set, like S17.

/** The unit builders S18 counts, by the module that exports them. A `family` is a keyed cell
 *  memoized per id (glossary), so one made inside a function is a second family under the same
 *  label: it counts like `data`. An `extension` does not count: a driver builds its extension
 *  from wiring rows inside a function by design (ADR 0051, ADR 0060). */
const UNIT_BUILDERS = new Map([
  ["@tinker/core", new Set(["data", "operation", "resource", "tag"])],
  ["@tinker/sync", new Set(["family"])],
]);
const HANDLE_TYPE = /\b(DataController|Controller|Scope\.Handle|Scope\.Session|Session)\b/;
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
  return new Set(names);
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
function noWrapperHits(source, program) {
  return [
    ...builderCallsInFunctions(program, builderNames(program)),
    ...handleParams(source, program),
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
/** The unit body each core builder takes: the config key holding the function. */
const UNIT_BODY = new Map([
  ["operation", "run"],
  ["resource", "factory"],
  ["extension", "start"],
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

/** [start, end] of the unit body one call declares: the function under its builder's body key
 *  (`local` maps a local builder name to that key). */
function bodiesOf(node, local) {
  const key = node.type === "CallExpression" ? local.get(node.callee?.name) : undefined;
  const config = key === undefined ? null : node.arguments[0];
  if (config?.type !== "ObjectExpression") return [];
  return config.properties
    .filter((p) => p.type === "Property" && p.key?.name === key && fnOf(p) !== null)
    .map((p) => [p.value.start, p.value.end]);
}

/** [start, end] of every unit body in the file: the function under `run`, `factory`, or
 *  `start` in the config of an operation, resource, or extension imported from @tinker/core. */
function unitBodies(program) {
  const local = new Map();
  for (const [name, key] of UNIT_BODY)
    for (const as of importedNames(program, "@tinker/core", new Set([name]))) local.set(as, key);
  const ranges = [];
  walk(program, (n) => ranges.push(...bodiesOf(n, local)));
  return ranges;
}

/** Is an offset inside a unit body. */
function unitTest(program) {
  const bodies = unitBodies(program);
  return (at) => bodies.some(([from, to]) => from <= at && at < to);
}

/** Local names the file imports `randomUUID` or `getRandomValues` under from node:crypto. */
const cryptoNames = (program) =>
  new Set(["node:crypto", "crypto"].flatMap((m) => importedNames(program, m, RANDOM_IMPORTS)));

/** Which hand-rolled rules one file gets, by lane and path. */
function handRolledScope(file, writer) {
  return {
    S20: !CORE_SRC.test(file),
    S21: true,
    S22: true,
    S23: writer || USERLAND.test(file),
    S24: writer || USERLAND.test(file),
    S25: writer && file.endsWith(".tsx"),
  };
}

/** S22's offsets for one node: shape A at the call, shape B at the catch. */
function droppedRunAt(node) {
  if (isDroppedRun(node)) return [node.start];
  return isBareCatchRun(node) ? [node.handler.start] : [];
}

/** Each hand-rolled rule: the offsets one node reports. `facts` holds the file's crypto
 *  imports and its unit-body test. */
const HAND_ROLLED = [
  ["S20", (n, facts) => (isRawRandom(n, facts.cryptoNames) ? [n.start] : [])],
  ["S21", (n, facts) => (isRawClock(n) && facts.inUnit(n.start) ? [n.start] : [])],
  ["S22", droppedRunAt],
  ["S23", (n) => (n.type === "ObjectExpression" ? handSubscribes(n).map((p) => p.start) : [])],
  ["S24", (n) => (isRawFetch(n) ? [n.start] : [])],
  ["S25", (n) => (isComponentState(n) ? [n.start] : [])],
];

/** The hand-rolled rows of one non-test file: [id, offset] pairs. */
function handRolledHits(program, file, writer) {
  const on = handRolledScope(file, writer);
  const checks = HAND_ROLLED.filter(([id]) => on[id]);
  const facts = { cryptoNames: cryptoNames(program), inUnit: unitTest(program) };
  const hits = [];
  walk(program, (n) => {
    for (const [id, check] of checks) for (const at of check(n, facts)) hits.push([id, at]);
  });
  return hits;
}

/** The rows read off the whole program, not one node: writer no-wrapper, then hand-rolled. */
function programHits(source, program, file, writer) {
  const kind = kindOf(file);
  return [
    ...(writer && kind === "src" ? noWrapperHits(source, program) : []),
    ...(kind === "test" ? [] : handRolledHits(program, file, writer)),
  ];
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
  for (const [id, at] of programHits(source, program, file, writer))
    rows.push(row(id, lineAt(starts, at)));
  rows.sort((a, b) => a.line - b.line || (a.id < b.id ? -1 : 1));
  return rows;
}
