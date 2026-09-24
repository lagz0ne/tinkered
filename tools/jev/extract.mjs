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
const STATIC_KINDS = new Set(["data", "resource", "operation", "tag"]);
const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

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

/** Does this function declare a unit, rather than only use one? */
function declaresUnit(node) {
  let found = false;
  walk(node, (n) => {
    if (isUnitCall(n)) found = true;
  });
  return found;
}

/** A top-level function as a unit record; wrappers need a narrower set of questions. */
const functionRecord = (src, node, name, exported, wrapperOnly = false) => ({
  kind: "function",
  name,
  line: lineOf(src, node.start),
  source: text(src, node),
  exported,
  wrapperOnly,
});

/** The name of a top-level arrow function (including components). */
function arrowName(decl) {
  const d = decl?.type === "VariableDeclaration" ? decl.declarations[0] : undefined;
  const isArrow = d?.init?.type === "ArrowFunctionExpression" && d.id.type === "Identifier";
  return isArrow ? d.id.name : null;
}

/** Top-level functions are also judged when they declare units: wrappers live there. */
function functionOf(src, node, file) {
  const decl = node.type === "ExportNamedDeclaration" ? node.declaration : node;
  const exported = node.type === "ExportNamedDeclaration";
  if (decl?.type === "FunctionDeclaration" && decl.id)
    return functionRecord(src, node, decl.id.name, exported, declaresUnit(decl.body));
  const arrow = arrowName(decl);
  return arrow
    ? functionRecord(src, node, arrow, exported, !file.endsWith(".tsx") || declaresUnit(decl))
    : null;
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

/** Names bound by a parameter or a local pattern, including destructuring. */
function bindings(pattern) {
  if (!pattern) return [];
  if (pattern.type === "Identifier") return [pattern.name];
  if (pattern.type === "RestElement" || pattern.type === "AssignmentPattern")
    return bindings(pattern.argument ?? pattern.left);
  if (pattern.type === "ArrayPattern") return pattern.elements.flatMap(bindings);
  if (pattern.type === "ObjectPattern")
    return pattern.properties.flatMap((p) => bindings(p.value ?? p.argument));
  return [];
}

/** Identifier references, without property names, type syntax, or names shadowed in callbacks. */
function references(node, shadow = new Set()) {
  const out = new Set();
  // AST node kinds each need their own reference handling.
  // oxlint-disable-next-line complexity -- syntax cases are independent
  function visit(n, hidden) {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach((v) => visit(v, hidden));
    if (n.type === "Identifier") {
      if (!hidden.has(n.name)) out.add(n.name);
      return;
    }
    if (n.type === "ThisExpression") {
      out.add("this");
      return;
    }
    if (n.type?.startsWith("TS") || n.type === "TSTypeAnnotation") return;
    if (FUNCTION_TYPES.has(n.type)) {
      const scoped = new Set([...hidden, ...(n.params ?? []).flatMap(bindings)]);
      if (n.id?.name) scoped.add(n.id.name);
      visit(n.body, scoped);
      return;
    }
    if (n.type === "VariableDeclarator") return visit(n.init, hidden);
    // Writing a counter or cache has no effect on the value built from this initializer.
    if (n.type === "AssignmentExpression" && n.left.type === "MemberExpression")
      return visit(n.right, hidden);
    if (n.type === "Property") {
      if (n.computed) visit(n.key, hidden);
      visit(n.value, hidden);
      return;
    }
    if (n.type === "MemberExpression") {
      visit(n.object, hidden);
      if (n.computed) visit(n.property, hidden);
      return;
    }
    for (const [key, value] of Object.entries(n))
      if (!["id", "typeAnnotation", "returnType", "typeParameters", "typeArguments"].includes(key))
        visit(value, hidden);
  }
  visit(node, shadow);
  return out;
}

/** All enclosing scopes contribute to one fixed point, including writes and loop bindings. */
function derivedNames(functions, before) {
  const names = new Set(functions.flatMap(({ node: fn }) => (fn.params ?? []).flatMap(bindings)));
  const edges = [];
  // oxlint-disable-next-line complexity -- each binding form has its own source
  function collect(n) {
    if (!n || typeof n !== "object" || n.start >= before) return;
    if (Array.isArray(n)) return n.forEach(collect);
    if (n.type === "FunctionDeclaration") {
      if (n.id) edges.push({ names: bindings(n.id), value: n });
      return;
    }
    if (FUNCTION_TYPES.has(n.type)) return;
    if (n.type === "VariableDeclarator") edges.push({ names: bindings(n.id), value: n.init });
    if (n.type === "ForOfStatement" || n.type === "ForInStatement") {
      const left = n.left.type === "VariableDeclaration" ? n.left.declarations[0]?.id : n.left;
      edges.push({ names: bindings(left), value: n.right });
    }
    if (n.type === "AssignmentExpression" && n.left.type === "Identifier")
      edges.push({ names: bindings(n.left), value: n.right });
    for (const value of Object.values(n)) if (value && typeof value === "object") collect(value);
  }
  for (const { node: fn } of functions) collect(fn.body);
  let changed;
  do {
    changed = false;
    for (const edge of edges) {
      if (![...references(edge.value)].some((name) => names.has(name))) continue;
      for (const name of edge.names)
        if (!names.has(name)) {
          names.add(name);
          changed = true;
        }
    }
  } while (changed);
  return names;
}

/** Calls made inside a function that can be declared once, without its parameters. */
// oxlint-disable-next-line complexity -- import and function guards are separate AST cases
export function unitCouldBeModuleLevel(src, file = "a.ts") {
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)(?:test|tests|__tests__)\//.test(file)) return [];
  const program = parse(file, src);
  const coreNames = new Set();
  for (const n of program.body)
    if (n.type === "ImportDeclaration" && n.source.value === "@tinker/core")
      for (const s of n.specifiers)
        if (s.type === "ImportSpecifier" && STATIC_KINDS.has(s.imported.name))
          coreNames.add(s.local.name);
  const out = [];
  // oxlint-disable-next-line complexity -- nested function and call syntax needs separate guards
  function visit(node, functions = [], name, locals = []) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach((n) => visit(n, functions, name, locals));
    if (node.type === "ExportNamedDeclaration")
      return visit(node.declaration, functions, name, locals);
    if (node.type === "CatchClause")
      return visit(node.body, functions, name, [...locals, ...bindings(node.param)]);
    if (
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression"
    ) {
      const owner = node.id?.name ?? name ?? functions.at(-1)?.name ?? "<anonymous>";
      return visit(node.body, [...functions, { node, name: owner }], undefined, locals);
    }
    if (node.type === "VariableDeclarator") {
      visit(node.init, functions, node.id?.name, locals);
      return;
    }
    if (
      node.type === "CallExpression" &&
      functions.length &&
      node.callee.type === "Identifier" &&
      coreNames.has(node.callee.name) &&
      node.arguments[0]?.type === "ObjectExpression"
    ) {
      const config = node.arguments[0];
      const names = derivedNames(functions, node.start);
      for (const local of locals) names.add(local);
      const refs = references(config);
      if (!refs.has("this") && ![...refs].some((ref) => names.has(ref)))
        out.push({
          kind: node.callee.name,
          line: lineOf(src, node.start),
          functionName: functions.at(-1).name,
        });
    }
    for (const value of Object.values(node))
      if (value && typeof value === "object") visit(value, functions, name, locals);
  }
  visit(program);
  return out;
}

/** A named nested function, for labeling historical builders no longer in the current slice. */
export function namedFunction(src, file, name) {
  let match;
  // oxlint-disable-next-line complexity -- nested declarations and arrow bindings differ
  function visit(node) {
    if (!node || typeof node !== "object" || match) return;
    if (Array.isArray(node)) return node.forEach(visit);
    if (node.type === "FunctionDeclaration" && node.id?.name === name)
      match = functionRecord(src, node, name, false);
    if (
      node.type === "VariableDeclarator" &&
      node.id?.name === name &&
      FUNCTION_TYPES.has(node.init?.type)
    )
      match = functionRecord(src, node.init, name, false);
    for (const value of Object.values(node)) if (value && typeof value === "object") visit(value);
  }
  visit(parse(file, src));
  return match;
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
