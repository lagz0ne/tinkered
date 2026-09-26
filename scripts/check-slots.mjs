#!/usr/bin/env node
// Hot names below V8 slot 256 (perf/session-slots). V8 keeps a module's top-level names in one
// context; a slot index above 255 no longer fits the one-byte operand, so every read and write of
// it takes a `.Wide` bytecode (+4 bytes a use, which eats the inlining budget). Core's release
// and invalidation block sits at the END of `packages/core/src/index.ts` so the hot code keeps
// the cheap slots. This lane checks that promise on what users import.
//
//   node scripts/check-slots.mjs [dist/index.mjs]    default: packages/core/dist/index.mjs
//
// The slot rule, from V8's scope allocation (src/ast/scopes.cc), checked against
// `node --print-bytecode` on the core bundle (every function name's `StaCurrentContextSlot`):
// - A module context starts with 3 header slots (scope info, previous, the module), so the
//   first name gets slot 3.
// - An import, and a local that is exported, is a module cell (`LdaModuleVariable`): no slot.
// - Any other module-scope name (function, class, let, const, var) gets a slot only when code
//   inside a function reads or writes it; used only by the module body, it lives in a register.
//   A direct `eval` anywhere puts every name in the context.
// - Slots go in declaration order in the source (the order the parser declares them), not in
//   hoisting order: a hoisted function still takes the slot of its place in the file.
//
// The anchor: the dist name whose source line, through `index.mjs.map`, is the line that declares
// `invalidateResource`. It is the block's first runtime name (the block's first line is a type,
// which the build erases). If it is renamed or moved, the lane fails and says so, rather than
// guarding the wrong line.
//
// Exit 1 when a name declared before the anchor has a slot above 255, or the anchor is missing.
// A `pnpm validate` lane (ADR 0016).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

/** The last slot a one-byte operand can name. */
const MAX_SLOT = 255;
/** Module context header: scope info, previous context, the module record. */
const FIRST_SLOT = 3;
const ANCHOR = "invalidateResource";
const ANCHOR_SOURCE = "../src/index.ts";

// oxc-parser is a dependency of tools/jev, not of the root package: resolve it from there.
const jev = createRequire(new URL("../tools/jev/package.json", import.meta.url));
const { parseSync } = await import(jev.resolve("oxc-parser"));

/** A scope in the walk: its names, and whether it is a function body (a closure boundary). */
class Scope {
  /** @param {Scope | undefined} parent @param {boolean} fn */
  constructor(parent, fn) {
    this.parent = parent;
    this.fn = fn;
    this.names = new Set();
  }
}

/** The sub-patterns of a pattern node that can hold binding names. */
const PATTERN_PARTS = {
  ObjectPattern: (p) => p.properties.map((q) => (q.type === "RestElement" ? q : q.value)),
  ArrayPattern: (p) => p.elements,
  RestElement: (p) => [p.argument],
  AssignmentPattern: (p) => [p.left],
};

const parts = (pattern) => PATTERN_PARTS[pattern.type]?.(pattern) ?? [];

/** Every binding name in a declaration pattern (`a`, `{ a, b: [c] }`, `...d`, `e = 1`). */
function bindingNames(pattern, out = []) {
  if (!pattern) return out;
  if (pattern.type === "Identifier") out.push(pattern);
  for (const part of parts(pattern)) bindingNames(part, out);
  return out;
}

const isFunction = (node) =>
  node.type === "FunctionDeclaration" ||
  node.type === "FunctionExpression" ||
  node.type === "ArrowFunctionExpression";

const isNode = (value) => value !== null && typeof value === "object" && "type" in value;

/** The children of a node, in source order. */
function children(node) {
  const out = [];
  for (const value of Object.values(node))
    out.push(...(Array.isArray(value) ? value : [value]).filter(isNode));
  return out;
}

/** `var` bindings hoisted to the enclosing function (or module), not entering nested functions. */
function varNames(node, out = []) {
  if (node.type === "VariableDeclaration" && node.kind === "var")
    for (const d of node.declarations) bindingNames(d.id, out);
  for (const child of children(node)) if (!isFunction(child)) varNames(child, out);
  return out;
}

/** The names one statement declares in its block: let, const, class, function (not var). */
function declaredBy(statement) {
  const decl = statement.declaration ?? statement;
  if (decl.type === "VariableDeclaration")
    return decl.kind === "var" ? [] : decl.declarations.flatMap((d) => bindingNames(d.id));
  const named = decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration";
  return named && decl.id ? [decl.id] : [];
}

/** The names a statement list declares in its own block. */
const lexicalNames = (statements) => statements.flatMap(declaredBy);

/** Resolves every identifier; records the module names read from inside a function. */
class Resolver {
  constructor(moduleScope) {
    this.module = moduleScope;
    this.captured = new Set();
    this.evals = false;
  }

  /** Mark `name` captured when it resolves to the module scope across a function boundary. */
  reference(name, scope) {
    let crossed = false;
    for (let s = scope; s; s = s.parent) {
      if (s.names.has(name)) {
        if (s === this.module && crossed) this.captured.add(name);
        return;
      }
      crossed ||= s.fn;
    }
    if (name === "eval") this.evals = true;
  }

  walk(node, scope) {
    const visit = this[node.type];
    if (visit) visit.call(this, node, scope);
    else for (const child of children(node)) this.walk(child, scope);
  }

  /** A binding pattern: its names are declarations; defaults and computed keys are reads. */
  pattern(node, scope) {
    if (!node) return;
    if (node.type === "AssignmentPattern") this.walk(node.right, scope);
    if (node.type === "ObjectPattern")
      for (const p of node.properties) if (p.computed) this.walk(p.key, scope);
    for (const part of parts(node)) this.pattern(part, scope);
  }

  property(node, scope, value) {
    if (node.computed) this.walk(node.key, scope);
    value();
  }

  /** A new scope holding `names`, with `body` walked inside it. */
  inScope(parent, fn, names, body) {
    const scope = new Scope(parent, fn);
    for (const id of names) scope.names.add(id.name);
    body(scope);
  }

  func(node, scope) {
    const outer = node.type === "FunctionExpression" && node.id ? [node.id] : [];
    this.inScope(scope, false, outer, (named) => {
      const body = node.body.type === "BlockStatement" ? node.body.body : [];
      const params = node.params.flatMap((p) => bindingNames(p));
      const names = [...params, ...varNames(node.body), ...lexicalNames(body)];
      this.inScope(named, true, names, (inner) => {
        if (node.type !== "ArrowFunctionExpression") inner.names.add("arguments");
        for (const p of node.params) this.pattern(p, inner);
        for (const child of body.length ? body : [node.body]) this.walk(child, inner);
      });
    });
  }

  Identifier(node, scope) {
    this.reference(node.name, scope);
  }

  FunctionDeclaration(node, scope) {
    this.func(node, scope);
  }

  FunctionExpression(node, scope) {
    this.func(node, scope);
  }

  ArrowFunctionExpression(node, scope) {
    this.func(node, scope);
  }

  VariableDeclaration(node, scope) {
    for (const d of node.declarations) {
      this.pattern(d.id, scope);
      if (d.init) this.walk(d.init, scope);
    }
  }

  BlockStatement(node, scope) {
    this.inScope(scope, false, lexicalNames(node.body), (inner) => {
      for (const s of node.body) this.walk(s, inner);
    });
  }

  StaticBlock(node, scope) {
    const names = [...varNames(node), ...lexicalNames(node.body)];
    this.inScope(scope, true, names, (inner) => {
      for (const s of node.body) this.walk(s, inner);
    });
  }

  SwitchStatement(node, scope) {
    this.walk(node.discriminant, scope);
    const statements = node.cases.flatMap((c) => c.consequent);
    this.inScope(scope, false, lexicalNames(statements), (inner) => {
      for (const c of node.cases) for (const child of children(c)) this.walk(child, inner);
    });
  }

  loop(node, scope) {
    const head = node.init ?? node.left;
    const names = head ? lexicalNames([head]) : [];
    this.inScope(scope, false, names, (inner) => {
      for (const child of children(node)) this.walk(child, inner);
    });
  }

  ForStatement(node, scope) {
    this.loop(node, scope);
  }

  ForInStatement(node, scope) {
    this.loop(node, scope);
  }

  ForOfStatement(node, scope) {
    this.loop(node, scope);
  }

  CatchClause(node, scope) {
    this.inScope(scope, false, bindingNames(node.param), (inner) => {
      this.pattern(node.param, inner);
      this.walk(node.body, inner);
    });
  }

  klass(node, scope) {
    this.inScope(scope, false, node.id ? [node.id] : [], (inner) => {
      if (node.superClass) this.walk(node.superClass, inner);
      for (const member of node.body.body) this.walk(member, inner);
    });
  }

  ClassDeclaration(node, scope) {
    this.klass(node, scope);
  }

  ClassExpression(node, scope) {
    this.klass(node, scope);
  }

  MethodDefinition(node, scope) {
    this.property(node, scope, () => this.walk(node.value, scope));
  }

  /** A field initializer runs in its own function, so it counts as a closure boundary. */
  PropertyDefinition(node, scope) {
    this.property(node, scope, () => {
      if (node.value) this.inScope(scope, true, [], (inner) => this.walk(node.value, inner));
    });
  }

  Property(node, scope) {
    this.property(node, scope, () => this.walk(node.value, scope));
  }

  MemberExpression(node, scope) {
    this.walk(node.object, scope);
    if (node.computed) this.walk(node.property, scope);
  }

  LabeledStatement(node, scope) {
    this.walk(node.body, scope);
  }

  BreakStatement() {}

  ContinueStatement() {}

  MetaProperty() {}

  /** Module-level import and export lists name module cells, not reads. */
  ImportDeclaration() {}

  ExportNamedDeclaration(node, scope) {
    if (node.declaration) this.walk(node.declaration, scope);
  }
}

/** The module cells one statement names: imports, and locals it exports. */
function cellsOf(statement) {
  const locals = (statement.specifiers ?? []).map((sp) => sp.local);
  if (statement.type === "ImportDeclaration") return locals;
  if (!statement.type.startsWith("Export")) return [];
  const decl = statement.declaration;
  const vars = decl?.type === "VariableDeclaration" ? varNames(decl) : [];
  return [...locals, ...vars, ...(decl ? declaredBy(statement) : [])];
}

/** The module's names in declaration order, and the ones that are module cells. */
function moduleNames(program) {
  const cells = new Set(program.body.flatMap(cellsOf).map((id) => id.name));
  const declared = [...lexicalNames(program.body), ...varNames(program)];
  declared.sort((a, b) => a.start - b.start);
  const seen = new Set();
  const names = declared.filter((id) => !seen.has(id.name) && seen.add(id.name));
  return { names, cells };
}

/** Assign V8 context slots: see the rule at the top of this file. */
export function slots(program) {
  const { names, cells } = moduleNames(program);
  const scope = new Scope(undefined, false);
  for (const name of [...names.map((id) => id.name), ...cells]) scope.names.add(name);
  const resolver = new Resolver(scope);
  for (const s of program.body) resolver.walk(s, scope);
  let next = FIRST_SLOT;
  return names
    .filter((id) => !cells.has(id.name) && (resolver.evals || resolver.captured.has(id.name)))
    .map((id) => ({ name: id.name, start: id.start, slot: next++ }));
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Decode one VLQ-encoded mapping segment into its numbers. */
function vlq(segment) {
  const out = [];
  let value = 0;
  let shift = 0;
  for (const ch of segment) {
    const digit = B64.indexOf(ch);
    value += (digit & 31) << shift;
    shift += 5;
    if (digit & 32) continue;
    out.push(value & 1 ? -(value >>> 1) : value >>> 1);
    value = 0;
    shift = 0;
  }
  return out;
}

/** The source map's segments for generated line 1 (the bundle is one line): column → source line. */
function segments(map) {
  const out = [];
  const pos = [0, 0, 0, 0];
  for (const segment of map.mappings.split(";")[0].split(",")) {
    const fields = vlq(segment);
    for (let i = 0; i < 4 && i < fields.length; i++) pos[i] += fields[i];
    if (fields.length >= 4) out.push({ column: pos[0], source: pos[1], line: pos[2] + 1 });
  }
  return out;
}

/** The source line of the segment at or before a generated column. */
function sourceAt(segs, column) {
  let found;
  for (const s of segs) {
    if (s.column > column) break;
    found = s;
  }
  return found;
}

/** The first `function|class|const|let|var <name>` on a source line: the name a report shows. */
function sourceName(map, at) {
  const text = map.sourcesContent[at.source].split("\n")[at.line - 1] ?? "";
  const m = /\b(?:function\*?|class|const|let|var)\s+([\w$]+)/.exec(text);
  return `${m ? m[1] : "?"} (${map.sources[at.source].replace("../", "")}:${at.line})`;
}

function main(file) {
  const code = readFileSync(file, "utf8");
  const map = JSON.parse(readFileSync(`${file}.map`, "utf8"));
  const { program, errors } = parseSync(file, code, { sourceType: "module" });
  if (errors.length) throw new Error(`${file}: ${errors[0].message}`);
  const source = map.sources.indexOf(ANCHOR_SOURCE);
  const lines = map.sourcesContent[source].split("\n");
  const anchorLine = lines.findIndex((l) => new RegExp(`^function ${ANCHOR}\\b`).test(l)) + 1;
  const segs = segments(map);
  const all = slots(program).map((s) => ({ ...s, at: sourceAt(segs, s.start) }));
  const anchor = all.findIndex((s) => s.at?.source === source && s.at.line === anchorLine);
  if (anchorLine === 0 || anchor < 0) {
    console.log(
      `FAIL no slot maps to \`function ${ANCHOR}\` in ${ANCHOR_SOURCE}: re-pick the anchor`,
    );
    return 1;
  }
  const hot = all.slice(0, anchor);
  const last = hot.at(-1)?.slot ?? FIRST_SLOT - 1;
  const over = hot.find((s) => s.slot > MAX_SLOT);
  console.log(
    `${hot.length} hot names before ${ANCHOR} (last slot ${last}), ${all.length} names in slots ` +
      `(last slot ${all.at(-1).slot}); headroom ${MAX_SLOT - last} names`,
  );
  if (!over) return 0;
  console.log(
    `FAIL ${over.name} = ${sourceName(map, over.at)} is slot ${over.slot} (> ${MAX_SLOT}): ` +
      `move cold names below ${ANCHOR}, or hot ones up`,
  );
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`)
  process.exit(main(process.argv[2] ?? "packages/core/dist/index.mjs"));
