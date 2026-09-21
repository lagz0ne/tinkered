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

/** A top-level function as a unit record of kind "function". */
const functionRecord = (src, node, name, exported) => ({
  kind: "function",
  name,
  line: lineOf(src, node.start),
  source: text(src, node),
  exported,
});

/** The name of a `.tsx` arrow component `const X = (…) => …` that declares no unit, else null. */
function arrowName(decl) {
  const d = decl?.type === "VariableDeclaration" ? decl.declarations[0] : undefined;
  const isArrow = d?.init?.type === "ArrowFunctionExpression" && d.id.type === "Identifier";
  return isArrow && !declaresUnit(d.init.body) ? d.id.name : null;
}

/** Top-level function declarations (and arrow consts in .tsx) that declare no unit. */
function functionOf(src, node, file) {
  const decl = node.type === "ExportNamedDeclaration" ? node.declaration : node;
  const exported = node.type === "ExportNamedDeclaration";
  if (decl?.type === "FunctionDeclaration" && decl.id && !declaresUnit(decl.body))
    return functionRecord(src, node, decl.id.name, exported);
  const arrow = file.endsWith(".tsx") ? arrowName(decl) : null;
  return arrow ? functionRecord(src, node, arrow, exported) : null;
}

/** Every declared unit and every top-level function that declares none, in source order. */
export function units(src, file = "a.ts") {
  const out = [];
  for (const node of parse(file, src).body) {
    const decl = node.type === "ExportNamedDeclaration" ? node.declaration : node;
    const exported = node.type === "ExportNamedDeclaration";
    const declarators = decl?.type === "VariableDeclaration" ? decl.declarations : [];
    out.push(...declarators.map((d) => unitOf(src, d, exported)).filter(Boolean));
    const fn = functionOf(src, node, file);
    if (fn) out.push(fn);
  }
  return out;
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
