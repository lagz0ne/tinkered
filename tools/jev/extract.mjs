// Extraction — the deterministic half of every jev tool, on a real parser (oxc-parser, the same
// family as the Oxlint `vp check` runs). Jev never locates or counts; this file does. It returns
// plain records with source spans, so a judge sees facts (a test's causes and assertions, a
// unit's kind and dependency keys) instead of a prose blob, and the grep-shaped rules become exact.
//
//   units(src, file)   declared data/resource/operation/tag/extension calls + top-level functions
//   tests(src)         each test("…")/it("…"): title, body, causes, asserts, narrows, awaits
//   imports(src)       [{ source, names }] · exports(src) → exported names
import { parseSync } from "oxc-parser";

const UNIT_KINDS = new Set(["data", "resource", "operation", "tag", "extension", "family"]);

/** Parse once; oxc is lenient, so a broken file still yields a program (errors are advisory). */
export function parse(file, src) {
  return parseSync(file, src).program;
}

const text = (src, node) => src.slice(node.start, node.end);
const lineOf = (src, index) => src.slice(0, index).split("\n").length;
const keyName = (p) => p.key?.name ?? p.key?.value;

/** The `{ … }` argument's property named `name`, or undefined. */
function prop(objectNode, name) {
  return objectNode?.type === "ObjectExpression"
    ? objectNode.properties.find((p) => keyName(p) === name)?.value
    : undefined;
}

/** Is this call `data(…)`, `resource(…)`, … — one of the unit builders? */
const isUnitCall = (node) =>
  node?.type === "CallExpression" &&
  node.callee.type === "Identifier" &&
  UNIT_KINDS.has(node.callee.name);

/** A `const x = kind({ … })` declarator as a unit record, or null when it is not one. */
function unitOf(src, declarator, exported) {
  const init = declarator.init;
  if (!isUnitCall(init) || declarator.id.type !== "Identifier") return null;
  const config = init.arguments[0];
  const label = prop(config, "label");
  const depends = prop(config, "depends");
  return {
    kind: init.callee.name,
    name: declarator.id.name,
    line: lineOf(src, declarator.start),
    source: text(src, declarator),
    exported,
    label: label?.type === "Literal" ? label.value : undefined,
    dependsKeys: depends?.type === "ObjectExpression" ? depends.properties.map(keyName) : [],
  };
}

/** Does this subtree call one of the unit builders? (Then its function is a root or a tour.) */
function declaresUnit(node) {
  let found = false;
  walk(node, (n) => {
    if (isUnitCall(n)) found = true;
  });
  return found;
}

/** Function node types: returns or JSX inside one of these belong to the inner function. */
const FN_TYPES = new Set(["ArrowFunctionExpression", "FunctionExpression", "FunctionDeclaration"]);

/** Ranges of nested function bodies under root — the root itself is never one of them. */
function innerBodies(root) {
  const out = [];
  walk(root, (n) => {
    if (n === root) return;
    if (!FN_TYPES.has(n.type)) return;
    if (!n.body || n.body.start === undefined) return;
    out.push([n.body.start, n.body.end]);
  });
  return out;
}

/** Is this offset inside one of the ranges? */
function insideAny(ranges, pos) {
  return ranges.some(([from, to]) => from <= pos && pos <= to);
}

/** Any JSX element or fragment in root outside nested function bodies. */
function rendersOutside(root) {
  const hidden = innerBodies(root);
  let found = false;
  walk(root, (n) => {
    if (found) return;
    if (n.type !== "JSXElement" && n.type !== "JSXFragment") return;
    if (n.start !== undefined && !insideAny(hidden, n.start)) found = true;
  });
  return found;
}

/** Does this function body return JSX — through `if`/`switch`/`try` branches too? An arrow
 *  expression body is its return. Returns inside a nested function do not count, so a helper
 *  holding `const render = () => <p/>` but returning a value stays a helper. */
function returnsJsx(body) {
  if (!body) return false;
  if (body.type !== "BlockStatement") return rendersOutside(body);
  const hidden = innerBodies(body);
  let found = false;
  walk(body, (n) => {
    if (found || n.type !== "ReturnStatement") return;
    if (n.start === undefined || !n.argument) return;
    if (insideAny(hidden, n.start)) return;
    if (rendersOutside(n.argument)) found = true;
  });
  return found;
}

/** A top-level function as a unit record: kind "component" when it returns JSX, else plain
 *  "function". One declarator of `const A = …, B = …` owns only its own span — name, line,
 *  and source — so a judge never reads a sibling. */
const functionRecord = (src, span, name, exported, kind) => ({
  kind,
  name,
  line: lineOf(src, span.start),
  source: src.slice(span.start, span.end),
  exported,
});

/** The functions one declaration holds — { name, body } each. Covers a named `function`,
 *  an anonymous default-exported function (which reads as "default"), and
 *  `const X = (…) => …` / `const X = function …`. */
function isFnInit(init) {
  return init?.type === "ArrowFunctionExpression" || init?.type === "FunctionExpression";
}

/** The function declarators of one `const` — each keeps its own name, body, and span. */
function constFns(decl) {
  return decl.declarations
    .filter((d) => d.id.type === "Identifier" && isFnInit(d.init))
    .map((d) => ({ name: d.id.name, body: d.init.body, span: d }));
}

/** The named `function` or bare arrow one declaration holds, or null. */
function singleFn(decl, node) {
  if (decl?.type === "FunctionDeclaration" && decl.body)
    return { name: decl.id?.name ?? "default", body: decl.body, span: node };
  if (isFnInit(decl)) return { name: "default", body: decl.body, span: node };
  return null;
}

/** Every function a declaration holds, in order: the named `function` or bare arrow, or each
 *  function declarator of a `const A = …, B = …` (the unit keeps its own const name). */
function fnsOf(decl, node) {
  const single = singleFn(decl, node);
  if (single !== null) return [single];
  if (decl?.type !== "VariableDeclaration") return [];
  return constFns(decl);
}

/** One unit record for a declared function: a component when `.tsx` JSX returns, else a helper. */
function fnRecord(src, exported, tsx, found) {
  const kind = tsx && returnsJsx(found.body) ? "component" : "function";
  return functionRecord(src, found.span, found.name, exported, kind);
}

/** The unit records for one named `function` declaration, or none. */
function namedRecords(src, node, exported, tsx, decl) {
  const found = fnsOf(decl, node)[0];
  if (!found || declaresUnit(found.body)) return [];
  return [fnRecord(src, exported, tsx, found)];
}

/** Top-level functions that declare no unit: a component when the body returns JSX
 *  (fragments count, nesting in the returned tree counts), a plain helper otherwise. Arrow
 *  and function-expression consts are units in every file: a default hidden in
 *  `const readId = (v) => …` is judged the same as one in `function readId(v) { … }`. */
function functionOf(src, node, file) {
  const decl =
    node.type === "ExportNamedDeclaration" || node.type === "ExportDefaultDeclaration"
      ? node.declaration
      : node;
  const exported =
    node.type === "ExportNamedDeclaration" || node.type === "ExportDefaultDeclaration";
  const tsx = file.endsWith(".tsx") || file.endsWith(".jsx");
  if (decl?.type === "FunctionDeclaration") return namedRecords(src, node, exported, tsx, decl);
  return fnsOf(decl, node)
    .filter((found) => !declaresUnit(found.body))
    .map((found) => fnRecord(src, exported, tsx, found));
}

/** Every declared unit and every top-level function that declares none, in source order. */
export function units(src, file = "a.ts") {
  const out = [];
  const program = parse(file, src);
  for (const node of program.body) {
    const decl = node.type === "ExportNamedDeclaration" ? node.declaration : node;
    const exported = node.type === "ExportNamedDeclaration";
    const declarators = decl?.type === "VariableDeclaration" ? decl.declarations : [];
    out.push(...declarators.map((d) => unitOf(src, d, exported)).filter(Boolean));
    out.push(...functionOf(src, node, file));
  }
  return withUses(src, program, out);
}

const MAX_USES = 6;

/** The plain name a call node calls (`name(…)`), or null. */
const calledName = (node) =>
  node.type === "CallExpression" && node.callee?.type === "Identifier" ? node.callee.name : null;

/** Is this line inside the record's own body. */
const insideOf = (record, line) =>
  line >= record.line && line <= record.line + record.source.split("\n").length - 1;

/** A helper function's `uses`: the lines of this file, outside its own body, that call it,
 *  in source order, at most six. A judge sees what happens to the value it returns (a
 *  `String(id)` that only fills a thrown error's payload is not a default that keeps going). */
function withUses(src, program, records) {
  const lines = src.split("\n");
  const helpers = new Map(records.filter((r) => r.kind === "function").map((r) => [r.name, r]));
  if (helpers.size === 0) return records;
  const found = new Map();
  walk(program, (node) => {
    const helper = helpers.get(calledName(node));
    const line = helper === undefined ? 0 : lineOf(src, node.start);
    if (helper === undefined || insideOf(helper, line)) return;
    found.set(helper.name, (found.get(helper.name) ?? new Set()).add(line));
  });
  return records.map((r) => {
    const at = found.get(r.name);
    if (r.kind !== "function" || at === undefined) return r;
    const texts = [...at].sort((a, b) => a - b).map((line) => lines[line - 1].trim());
    return { ...r, uses: [...new Set(texts)].slice(0, MAX_USES) };
  });
}

// ---------- tests ----------

/** `expect(subject).matcher(arg)` → { subject, matcher, arg, not } or null. */
/** Strip an `await`; then a `.not` between `expect(…)` and the matcher. */
const unwrapAwait = (e) => (e?.type === "AwaitExpression" ? e.argument : e);
function expectCallOf(memberObject) {
  const not = memberObject.type === "MemberExpression" && memberObject.property.name === "not";
  const inner = not ? memberObject.object : memberObject;
  const isExpect = inner.type === "CallExpression" && inner.callee.name === "expect";
  return isExpect ? { inner, not } : null;
}

function assertOf(src, expr) {
  const call = unwrapAwait(expr);
  if (call?.type !== "CallExpression" || call.callee.type !== "MemberExpression") return null;
  const found = expectCallOf(call.callee.object);
  if (!found) return null;
  const { inner, not } = found;
  return {
    subject: inner.arguments[0] ? text(src, inner.arguments[0]) : "",
    matcher: call.callee.property.name,
    arg: call.arguments[0] ? text(src, call.arguments[0]) : "",
    not,
    line: lineOf(src, call.start),
  };
}

/** `if (cond) throw …` → the condition text, or null. */
function narrowOf(src, stmt) {
  const body =
    stmt.consequent?.type === "BlockStatement" ? stmt.consequent.body[0] : stmt.consequent;
  return stmt.type === "IfStatement" && body?.type === "ThrowStatement"
    ? text(src, stmt.test)
    : null;
}

/** A statement that produces a subject a later assertion reads: `const x = …call…` or `await …call…`. */
const calleeText = (src, e) => (e?.type === "CallExpression" ? text(src, e.callee) : null);
function causeOf(src, stmt) {
  if (stmt.type === "VariableDeclaration")
    return calleeText(src, unwrapAwait(stmt.declarations[0]?.init));
  if (stmt.type !== "ExpressionStatement") return null;
  const e = unwrapAwait(stmt.expression);
  const isAssert = assertOf(src, e) !== null || e?.callee?.name === "expect";
  return isAssert ? null : calleeText(src, e);
}

/** Walk one test body's statements into the facts a judge reads. */
function factsOf(src, block) {
  const asserts = [];
  const narrows = [];
  const causes = [];
  for (const stmt of block.body) {
    const a = stmt.type === "ExpressionStatement" ? assertOf(src, stmt.expression) : null;
    if (a) asserts.push(a);
    const n = narrowOf(src, stmt);
    if (n) narrows.push(n);
    const c = causeOf(src, stmt);
    if (c) causes.push(c);
    if (stmt.type === "TryStatement") {
      const inner = factsOf(src, stmt.block);
      asserts.push(...inner.asserts);
      causes.push(...inner.causes);
    }
  }
  return { asserts, narrows, causes };
}

/** A title: a string literal, or a template with `${…}` standing for each placeholder. */
function titleOf(node) {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (node?.type === "TemplateLiteral") return node.quasis.map((q) => q.value.cooked).join("${…}");
  return null;
}

/** Depth-first over every child node; `visit` sees each object node once. */
function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  if (!Array.isArray(node)) visit(node);
  for (const v of Object.values(node)) if (v && typeof v === "object") walk(v, visit);
}

/** Is this node a `test(…)` / `it(…)` call with a callback? */
const isTestCall = (n) =>
  n.type === "CallExpression" && ["test", "it"].includes(n.callee?.name) && !!n.arguments[1]?.body;

/** Every test call anywhere in the tree (inside `describe`, loops, blocks). */
function testCalls(program) {
  const out = [];
  walk(program, (n) => {
    if (isTestCall(n)) out.push(n);
  });
  return out;
}

/** Every `test("…", fn)` / `it("…", fn)` call: title, body text, line, and the facts inside. */
export function tests(src, file = "a.test.ts") {
  return testCalls(parse(file, src)).flatMap((call) => {
    const title = titleOf(call.arguments[0]);
    const fn = call.arguments[1];
    if (title === null) return [];
    const block = fn.body.type === "BlockStatement" ? fn.body : { body: [] };
    const record = { title, line: lineOf(src, call.start), body: text(src, fn.body) };
    return [{ ...record, ...factsOf(src, block) }];
  });
}

/** Top-level `function` declarations in a test file: name and line count (the helper rule). */
export function helpers(src, file = "a.test.ts") {
  return parse(file, src)
    .body.filter((n) => n.type === "FunctionDeclaration" && n.id)
    .map((n) => ({
      name: n.id.name,
      lines: text(src, n).split("\n").length,
      line: lineOf(src, n.start),
    }));
}

/** `import … from "source"` → [{ source, names }]. */
export function imports(src, file = "a.ts") {
  return parse(file, src)
    .body.filter((n) => n.type === "ImportDeclaration")
    .map((n) => ({ source: n.source.value, names: n.specifiers.map((s) => s.local.name) }));
}

/** The names one `export …` statement exports: specifiers, declared variables, a declared function/class. */
function exportedNames(n) {
  const names = n.specifiers.map((s) => s.exported.name ?? s.exported.value);
  const d = n.declaration;
  if (d?.type === "VariableDeclaration")
    names.push(...d.declarations.map((v) => v.id.name).filter(Boolean));
  else if (d?.id?.name) names.push(d.id.name);
  return names;
}

/** Every exported name: declarations, `export { a, b }`, and re-exports. */
export function exports(src, file = "a.ts") {
  return parse(file, src)
    .body.filter((n) => n.type === "ExportNamedDeclaration")
    .flatMap(exportedNames);
}
