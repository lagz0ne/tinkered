// Source-shape findings (deterministic, no model): the plain-code half of the component rules
// in docs/best-practices.md that a probabilistic judge cannot own — React state/effect hooks
// (rules 8–9; useId stays allowed), writable useData setters in views (rule 9: typing and
// filter writes are actions, operations own their state changes), and scope handles inside
// views (rule 2). Advisory: it lists, it never blocks; an app outside the worker policy may
// ignore a row.
//
//   inspectShape(source, file) → stable rows [{ id, line, message }] in source order
import { parseSync } from "oxc-parser";
import { units } from "./extract.mjs";

/** Banned React hooks in app code → the best-practices rule that owns each. `useId` is allowed. */
const HOOK_RULE = new Map([
  ["useState", 9],
  ["useReducer", 9],
  ["useRef", 9],
  ["useEffect", 8],
  ["useLayoutEffect", 8],
]);

const lineOf = (src, index) => src.slice(0, index).split("\n").length;

/** Depth-first over every child node; `visit` sees each object node once. */
function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  if (!Array.isArray(node)) visit(node);
  for (const v of Object.values(node)) if (v && typeof v === "object") walk(v, visit);
}

/** A member call `obj.name(…)` with plain identifiers, or null. */
function memberOf(callee) {
  const plain =
    callee?.type === "MemberExpression" &&
    !callee.computed &&
    callee.property.type === "Identifier" &&
    callee.object.type === "Identifier";
  return plain ? { obj: callee.object.name, name: callee.property.name } : null;
}

/** The banned named hook behind a bare call — `useState(…)` itself, even unimported,
 *  or an import alias (`import { useState as u }`) — else null. */
function bareHook(callee, bindings) {
  if (callee?.type !== "Identifier") return null;
  if (HOOK_RULE.has(callee.name)) return callee.name;
  const real = bindings.get(callee.name);
  return real !== undefined && HOOK_RULE.has(real) ? real : null;
}

/** The banned hook behind a namespace call — `React.useState(…)` — else null. */
function nsHook(callee, bindings) {
  const member = memberOf(callee);
  if (member === null) return null;
  const rooted = bindings.get(member.obj) === "*" || member.obj === "React";
  return rooted && HOOK_RULE.has(member.name) ? member.name : null;
}

/** The banned hook behind a call — bare, aliased, or namespaced — else null. */
function hookOf(callee, bindings) {
  return bareHook(callee, bindings) ?? nsHook(callee, bindings);
}

/** A `useScope(…)` call at this site — bare, aliased, or off a bound namespace —
 *  else false. The name must resolve to the `@tinker/react` import; a local
 *  `useScope` of our own is never the hook. */
function isScopeCall(node, bound, scopes) {
  const c = node.callee;
  if (c?.type === "Identifier") {
    if (c.name !== "useScope" && !bound.scopeCall.has(c.name)) return false;
    return resolvePos(scopes.tree, node.start, c.name) === "hook-scope";
  }
  const member = memberOf(c);
  return (
    member !== null &&
    member.name === "useScope" &&
    bound.scopeNs.has(member.obj) &&
    resolvePos(scopes.tree, node.start, member.obj) === "hook-ns"
  );
}

/** Is this options object the `useState`-like pair — a literal `{ writable: true }`? */
function isWritableOpt(arg) {
  if (arg?.type !== "ObjectExpression") return false;
  return arg.properties.some((p) => {
    const key = p.key?.name ?? p.key?.value;
    return key === "writable" && p.value?.type === "Literal" && p.value.value === true;
  });
}

/** Does this call take the pair form — `{ writable: true }` beside the cell or selector? */
function writesCell(node) {
  return (node.arguments ?? []).some(isWritableOpt);
}

/** The binding kind of one import specifier: `hook…` for a hook name or
 *  alias from `@tinker/react`, `hook-ns` for a bound namespace, else `local`.
 *  Split by hook family so each half stays under the cap. */
function specKind(s, hook, hookAlias, hookNs, scopeAlias) {
  return specData(s, hook, hookAlias, hookNs) ?? specScope(s, hook, scopeAlias) ?? "local";
}

/** The `useData` half: name, alias, or namespace — else null. */
function specData(s, hook, hookAlias, hookNs) {
  if (s.type === "ImportSpecifier" && hook) return specNamed(s, hookAlias, "useData", "hook");
  if (hook && hookNs.has(s.local.name) && isNsKind(s.type)) return "hook-ns";
  return null;
}

/** A named import of one hook: its own name or a known alias — else null. */
function specNamed(s, hookAlias, name, kind) {
  if (s.imported?.name === name || hookAlias.has(s.local.name)) return kind;
  return null;
}

/** Is this specifier type a namespace form. */
function isNsKind(type) {
  return type === "ImportDefaultSpecifier" || type === "ImportNamespaceSpecifier";
}

/** The `useScope` half: name or alias — else null. Namespaces share `hook-ns`. */
function specScope(s, hook, scopeAlias) {
  const named = s.type === "ImportSpecifier" && hook;
  if (named && (s.imported?.name === "useScope" || scopeAlias.has(s.local.name)))
    return "hook-scope";
  return null;
}

/** The declarator's function init — `{ name, params, body }` — or null. */
function constInit(src, d) {
  const init = d?.init;
  const plain = init?.type === "ArrowFunctionExpression" || init?.type === "FunctionExpression";
  if (plain !== true || d.id.type !== "Identifier") return null;
  return { line: lineOf(src, d.start), name: d.id.name, params: init.params, body: init.body };
}

/** The export wrapper off one top-level statement, or the statement itself. */
function unwrapped(node) {
  return node.type === "ExportNamedDeclaration" || node.type === "ExportDefaultDeclaration"
    ? node.declaration
    : node;
}

/** One named `function` behind a statement, or null. */
function namedFn(src, node, decl) {
  if (decl?.type !== "FunctionDeclaration" || !decl.body) return null;
  return { line: lineOf(src, node.start), params: decl.params, body: decl.body };
}

/** One bare arrow / function expression statement, or null. */
function bareFn(src, node, decl) {
  const bare = decl?.type === "ArrowFunctionExpression" || decl?.type === "FunctionExpression";
  if (!bare) return null;
  return { line: lineOf(src, node.start), params: decl.params, body: decl.body };
}

/** Every function a top-level statement declares — named `function`s plus each function
 *  declarator in a `const A = …, B = …` (only the first one used to be read). */
function topFns(src, node) {
  const decl = unwrapped(node);
  const single = namedFn(src, node, decl) ?? bareFn(src, node, decl);
  if (single !== null) return [single];
  if (decl?.type !== "VariableDeclaration") return [];
  return decl.declarations.map((d) => constInit(src, d)).filter(Boolean);
}

/** The JSX tag behind an element's opening name: `Provider`, `Scope.Provider`, or null. */
function tagOf(opening) {
  if (opening?.name.type === "JSXMemberExpression")
    return { obj: opening.name.object.name, prop: opening.name.property.name };
  if (opening?.name.type === "JSXIdentifier") return { obj: null, prop: opening.name.name };
  return null;
}

/** Is this element the bound scope provider — `<ScopeProvider>` (or alias) or
 *  `<R.ScopeProvider>` off the `@tinker/react` namespace? */
function isScopeTag(tag, bound) {
  if (tag === null) return false;
  if (tag.obj === null) return bound.scopeView.has(tag.prop);
  return tag.prop === "ScopeProvider" && bound.scopeNs.has(tag.obj);
}

/** Does this body render the scope provider — the `ScopeProvider` binding from
 *  `@tinker/react` (or its alias), or `<R.ScopeProvider>` off its namespace? Then it is the
 *  composition-root adapter, not a scope leak (rule 2 leaves the root its hand). A
 *  `ThemeProvider` or any other `*Provider` is not one. */
function providesScope(body, bound) {
  let found = false;
  walk(body, (n) => {
    if (!found && n.type === "JSXElement" && isScopeTag(tagOf(n.openingElement), bound))
      found = true;
  });
  return found;
}

/** A scope-typed view prop: `Scope.Handle` or a data controller in the parameter text,
 *  or a param named scope/session/controller threaded onward. */
const SCOPE_PROP = /Scope\s*\.\s*Handle|DataController/;
const SCOPE_NAME = /^(scope|session|controller)$/i;

/** Every name a pattern binds: identifiers, defaults, rests, holes skipped. */
function patternNames(p, out = []) {
  if (!p) return out;
  return patternInto(p, out);
}

/** One pattern node into `out`: the identifier, default, rest, or element kind. */
function patternInto(p, out) {
  if (p.type === "Identifier") out.push(p.name);
  else if (p.type === "AssignmentPattern") patternNames(p.left, out);
  else if (p.type === "RestElement") patternNames(p.argument, out);
  else patternKids(p, out);
  return out;
}

/** The bound names under one object or array pattern. */
function patternKids(p, out) {
  if (p.type === "ObjectPattern")
    for (const q of p.properties ?? [])
      patternNames(q.type === "Property" ? q.value : q.argument, out);
  if (p.type === "ArrayPattern") for (const e of p.elements ?? []) patternNames(e, out);
  return out;
}

/** A lexical scope: declared names plus child scopes with source spans. */
function newScope(kind) {
  return { kind, names: new Map(), kids: [] };
}

/** Names one statement hoists into its owner: function declarations and vars.
 *  `using`/`await using` are block-scoped and stay out of this pass. */
function declaredNames(node, out = []) {
  if (node?.type === "FunctionDeclaration" && node.id) out.push(node.id.name);
  if (node?.type === "VariableDeclaration" && node.kind === "var") varNames(node, out);
  return out;
}

/** A `var` declarator's bound names into `out`. */
function varNames(node, out) {
  for (const d of node.declarations ?? []) patternNames(d.id, out);
  return out;
}

/** Hoisted pass over one body: function names and vars first, so a call above
 *  a later `function` still resolves to the local. Vars hoist through nested
 *  blocks, so the pass walks the whole subtree outside nested functions. */
function declareHoisted(scope, body) {
  for (const st of body ?? []) hoistStmt(scope, st);
}

/** Is this node type a function of any shape. */
function isFnKind(kind) {
  return SHAPE_FRAMES.get(kind) === "function";
}

/** Hoisted names one statement contributes: its own, plus any `var` under
 *  nested blocks. Nested functions own their scope and stop the walk. */
function hoistStmt(scope, node) {
  for (const name of declaredNames(node)) scope.names.set(name, "local");
  if (isFnKind(node?.type)) return;
  for (const v of Object.values(node ?? {})) hoistKid(scope, v);
}

/** One child value into the hoist pass: lists fan out, non-functions recurse. */
function hoistKid(scope, v) {
  if (Array.isArray(v)) for (const w of v) hoistStmt(scope, w);
  else if (v?.type && !isFnKind(v.type)) hoistStmt(scope, v);
}

/** Build the scope tree for one body: hoisted names on the owner, one child
 *  scope per nested function, block, loop head, catch, or import row. */
function buildBody(owner, body, hookAlias, hookNs, scopeAlias) {
  declareHoisted(owner, body);
  for (const st of body ?? []) buildStatement(owner, st, hookAlias, hookNs, scopeAlias);
  for (const st of body ?? []) {
    if (st?.type === "VariableDeclaration" && st.kind !== "var") stmtLets(owner, st);
  }
}

/** Block-scoped declarators of one statement into the already-built body scope.
 *  Runs after children so a `const` never leaks into a sibling nested block. */
function stmtLets(owner, node) {
  for (const d of node.declarations ?? [])
    for (const name of patternNames(d.id)) owner.names.set(name, "local");
}

/** Node types with their own scope frame: blocks, loops, and functions. */
const SHAPE_FRAMES = new Map([
  ["BlockStatement", "block"],
  ["StaticBlock", "block"],
  ["ForStatement", "loop"],
  ["ForInStatement", "loop"],
  ["ForOfStatement", "loop"],
  ["FunctionDeclaration", "function"],
  ["FunctionExpression", "function"],
  ["ArrowFunctionExpression", "function"],
]);

/** Is this node type a block with its own lexical scope. */
function isBlockKind(kind) {
  return SHAPE_FRAMES.get(kind) === "block";
}

/** Is this node type a loop with a lexical head frame. */
function isLoopKind(kind) {
  return SHAPE_FRAMES.get(kind) === "loop";
}

/** Is this node type an anonymous function value. */
function isAnonKind(kind) {
  return kind === "FunctionExpression" || kind === "ArrowFunctionExpression";
}

/** `let`/`const` declarators of one loop head into the loop frame. */
function loopHead(inner, node) {
  const head = node.init ?? node.left;
  if (head?.type !== "VariableDeclaration" || head.kind === "var") return;
  for (const d of head.declarations ?? [])
    for (const name of patternNames(d.id)) inner.names.set(name, "local");
}

/** One statement into the scope tree. Plain blocks, loops, and catches own a
 *  child scope; everything else is scanned for nested functions and imports. */
function buildStatement(owner, node, hookAlias, hookNs, scopeAlias) {
  const kind = node?.type ?? "";
  if (kind === "FunctionDeclaration")
    return buildFunction(owner, node, hookAlias, hookNs, scopeAlias);
  if (kind === "ImportDeclaration")
    return noteImportNames(owner, hookAlias, hookNs, scopeAlias, node);
  if (SHAPE_FRAMES.has(kind) || kind === "CatchClause" || kind === "TryStatement")
    return buildFramed(owner, node, kind, hookAlias, hookNs, scopeAlias);
  scanValue(owner, node, hookAlias, hookNs, scopeAlias);
}

/** Build a framed node into its own child scope. */
function buildFramed(owner, node, kind, hookAlias, hookNs, scopeAlias) {
  if (isLoopKind(kind)) return buildLoop(owner, node, hookAlias, hookNs, scopeAlias);
  return buildScoped(owner, node, kind, hookAlias, hookNs, scopeAlias);
}

/** A block, try, or catch into its own child frame. A try builds its block,
 *  handler, and finalizer each in place, so the catch frame never wraps
 *  a sibling. */
function buildScoped(owner, node, kind, hookAlias, hookNs, scopeAlias) {
  if (isBlockKind(kind)) return buildBlock(owner, node, hookAlias, hookNs, scopeAlias);
  if (kind === "TryStatement") return buildTry(owner, node, hookAlias, hookNs, scopeAlias);
  return buildCatch(owner, node, hookAlias, hookNs, scopeAlias);
}

/** A try statement: its block, handler, and finalizer each build in place,
 *  so the handler's catch frame never wraps a sibling. */
function buildTry(owner, node, hookAlias, hookNs, scopeAlias) {
  if (node.block) buildBlock(owner, node.block, hookAlias, hookNs, scopeAlias);
  if (node.handler) buildCatch(owner, node.handler, hookAlias, hookNs, scopeAlias);
  if (node.finalizer) buildBlock(owner, node.finalizer, hookAlias, hookNs, scopeAlias);
}

/** One nested value into the tree: function values own a scope; other nodes
 *  are scanned for statements they hold (consequent, arms, handlers). */
function scanValue(owner, node, hookAlias, hookNs, scopeAlias) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const v of node) scanValue(owner, v, hookAlias, hookNs, scopeAlias);
    return;
  }
  const kind = node.type ?? "";
  if (kind === "FunctionDeclaration") buildFunction(owner, node, hookAlias, hookNs, scopeAlias);
  else if (isAnonKind(kind)) buildAnon(owner, node, hookAlias, hookNs, scopeAlias);
  else scanKids(owner, node, hookAlias, hookNs, scopeAlias);
}

/** Every other child value into the tree. */
function scanKids(owner, node, hookAlias, hookNs, scopeAlias) {
  for (const v of Object.values(node)) scanValue(owner, v, hookAlias, hookNs, scopeAlias);
}

/** A nested function declaration: name outside, params plus hoisted body inside. */
function buildFunction(owner, node, hookAlias, hookNs, scopeAlias) {
  if (node.id) owner.names.set(node.id.name, "local");
  const inner = newScope("function");
  owner.kids.push({ at: node.start, end: node.end, scope: inner });
  for (const q of node.params ?? [])
    for (const name of patternNames(q)) inner.names.set(name, "local");
  buildBody(inner, node.body?.body ?? [], hookAlias, hookNs, scopeAlias);
}

/** A function expression: params plus hoisted body inside; a named one also
 *  binds its own name within itself. */
function buildAnon(owner, node, hookAlias, hookNs, scopeAlias) {
  const inner = newScope("function");
  owner.kids.push({ at: node.start, end: node.end, scope: inner });
  if (node.id) inner.names.set(node.id.name, "local");
  for (const q of node.params ?? [])
    for (const name of patternNames(q)) inner.names.set(name, "local");
  const body = node.body?.type === "BlockStatement" ? node.body.body : [];
  buildBody(inner, body ?? [], hookAlias, hookNs, scopeAlias);
}

/** A plain block: one child scope spanning the block. */
function buildBlock(owner, node, hookAlias, hookNs, scopeAlias) {
  const inner = newScope("block");
  owner.kids.push({ at: node.start, end: node.end, scope: inner });
  buildBody(inner, node.body ?? [], hookAlias, hookNs, scopeAlias);
}

/** A loop: its head declares into one lexical frame wrapping head and body. */
function buildLoop(owner, node, hookAlias, hookNs, scopeAlias) {
  const inner = newScope("block");
  owner.kids.push({ at: node.start, end: node.end, scope: inner });
  loopHead(inner, node);
  const bodies = node.body?.type === "BlockStatement" ? node.body.body : [node.body];
  buildBody(inner, (bodies ?? []).filter(Boolean), hookAlias, hookNs, scopeAlias);
}

/** A catch clause: its own frame for the param, guarding handler and body. */
function buildCatch(owner, node, hookAlias, hookNs, scopeAlias) {
  const inner = newScope("block");
  owner.kids.push({ at: node.start, end: node.end, scope: inner });
  for (const name of patternNames(node.param)) inner.names.set(name, "local");
  buildBody(inner, node.body?.body ?? [], hookAlias, hookNs, scopeAlias);
}

/** An import row into the owning scope: hook bindings or locals. */
function noteImportNames(owner, hookAlias, hookNs, scopeAlias, node) {
  const hook = node.source.value === "@tinker/react";
  for (const q of node.specifiers) {
    if (q.local) owner.names.set(q.local.name, specKind(q, hook, hookAlias, hookNs, scopeAlias));
  }
}

/** The scope tree root: one module scope holding imports plus hoisted names. */
function buildTree(program, hookAlias, hookNs, scopeAlias) {
  const root = newScope("module");
  buildBody(root, program.body ?? [], hookAlias, hookNs, scopeAlias);
  return root;
}

/** The chain from the module scope down to the scope owning a call: at each
 *  level, the last child whose span holds the call. Later siblings start
 *  after earlier ones end, so the last match is the innermost owner. */
function chainAt(root, pos, out = []) {
  out.push(root);
  let match = null;
  for (const kid of root.kids) {
    if (kid.at !== undefined && kid.end !== undefined && kid.at <= pos && pos < kid.end)
      match = kid;
  }
  if (match !== null) chainAt(match.scope, pos, out);
  return out;
}

/** Resolve `name` at a call: innermost scope outward to the module. */
function resolvePos(root, pos, name) {
  const chain = chainAt(root, pos);
  for (let i = chain.length - 1; i >= 0; i--)
    if (chain[i].names.has(name)) return chain[i].names.get(name);
  return undefined;
}

/** Does this callee name the imported hook at this call site. */
function hookAt(callee, dataAlias, dataNs, root, pos) {
  if (callee?.type === "Identifier") {
    if (callee.name !== "useData" && !dataAlias.has(callee.name)) return false;
    return resolvePos(root, pos, callee.name) === "hook";
  }
  const member = memberOf(callee);
  return (
    member !== null &&
    member.name === "useData" &&
    dataNs.has(member.obj) &&
    resolvePos(root, pos, member.obj) === "hook-ns"
  );
}

/** The declaration behind an alias — through `export type …` too — or null. */
function aliasDecl(node) {
  const decl = node.type === "ExportNamedDeclaration" ? node.declaration : node;
  const isAlias =
    decl?.type === "TSTypeAliasDeclaration" || decl?.type === "TSInterfaceDeclaration";
  if (!isAlias || decl.id?.type !== "Identifier") return null;
  return decl;
}

/** The local names of Props-like aliases whose members carry a scope type
 *  (`type Props = { scope: Scope.Handle }`, `export type …`, an interface), read off the
 *  source text of each alias. */
function scopeAliases(source, program) {
  const names = new Set();
  for (const node of program.body) {
    const decl = aliasDecl(node);
    if (decl === null) continue;
    if (SCOPE_PROP.test(source.slice(decl.start, decl.end))) names.add(decl.id.name);
  }
  return names;
}

/** One `import … from` row: react hook aliases/namespaces, or useScope/ScopeProvider
 *  aliases/namespaces from `@tinker/react`. One branch per source keeps it under the cap. */
function bindReact(into, node) {
  for (const s of node.specifiers) {
    if (s.type === "ImportSpecifier" && HOOK_RULE.has(s.imported?.name))
      into.hooks.set(s.local.name, s.imported.name);
    if (s.type === "ImportDefaultSpecifier" || s.type === "ImportNamespaceSpecifier")
      into.hooks.set(s.local.name, "*");
  }
}

/** One `@tinker/react` import row: useScope and ScopeProvider aliases plus namespaces,
 *  and useData aliases (namespaces share the scope set). */
function bindScope(into, node) {
  const named = {
    useScope: into.scopeCall,
    ScopeProvider: into.scopeView,
    useData: into.dataCall,
  };
  for (const s of node.specifiers) {
    if (s.type === "ImportSpecifier" && s.imported?.name in named)
      named[s.imported.name].add(s.local.name);
    if (s.type === "ImportDefaultSpecifier" || s.type === "ImportNamespaceSpecifier")
      into.scopeNs.add(s.local.name);
  }
}

/** One `import … from` row: react hook aliases/namespaces, or useScope/ScopeProvider
 *  aliases/namespaces from `@tinker/react`. */
function bindImports(into, node) {
  if (node.source.value === "react") bindReact(into, node);
  if (node.source.value === "@tinker/react") bindScope(into, node);
}

/** One writable-useData row for a call node, or null. The callee must resolve
 *  to the `@tinker/react` import through the declare-collected scope tree. */
function writableRow(source, node, scopes, inView) {
  const line = lineOf(source, node.start);
  const hook = hookAt(node.callee, scopes.dataAlias, scopes.dataNs, scopes.tree, node.start);
  if (!hook || !writesCell(node) || !inView(line)) return null;
  return {
    id: "no-writable-in-view",
    line,
    message:
      "writable useData in a view (best-practices rule 9): typing and filter writes are actions; operations own their state changes",
  };
}

/** One banned-hook, writable-useData, or in-view scope row for a call, or null. */
function callRow(source, node, bound, scopes, inView) {
  const line = lineOf(source, node.start);
  const hook = hookOf(node.callee, bound.hooks);
  if (hook !== null) {
    const rule = HOOK_RULE.get(hook);
    const what =
      rule === 8
        ? "an effect is a resource with defer cleanup"
        : "keep it in a data cell, read with useData";
    return {
      id: rule === 8 ? "no-effect" : "no-react-state",
      line,
      message: `${hook} (best-practices rule ${rule}): ${what}`,
    };
  }
  if (isScopeCall(node, bound, scopes) && inView(line))
    return {
      id: "no-scope-in-view",
      line,
      message:
        "useScope in a view (best-practices rule 2): only the root holds the scope; views read cells and run operations",
    };
  return writableRow(source, node, scopes, inView);
}

/** Every CallExpression under `node`: `fn` sees each once, in source order. */
function eachCall(node, fn) {
  walk(node, (n) => {
    if (n.type === "CallExpression" && n.start !== undefined) fn(n);
  });
}

/** The referenced type name behind a parameter annotation (`Props` in `p: Props`), or null. */
function refName(p) {
  const typeName = p.typeAnnotation?.typeAnnotation?.typeName;
  if (typeName?.type === "Identifier") return { plain: typeName.name, qualified: null };
  if (typeName?.type === "TSQualifiedName")
    return { plain: null, qualified: `${typeName.left.name}.${typeName.right.name}` };
  return { plain: null, qualified: null };
}

/** Is this parameter text a bare scope name (`scope`, not `scope.foo`)? */
function isBareScope(slice) {
  return SCOPE_NAME.test(slice.trim()) && !/\bscope\s*\./i.test(slice);
}

/** Is this parameter a scope by its own text — `Scope.Handle`, a controller, or a bare name? */
function textHit(slice) {
  return SCOPE_PROP.test(slice) || isBareScope(slice);
}

/** Is this parameter a scope by its annotation — a Props alias or a qualified `Scope.Handle`? */
function refHit(aliases, p) {
  const ref = refName(p);
  return (
    (ref.plain !== null && aliases.has(ref.plain)) ||
    (ref.qualified !== null && SCOPE_PROP.test(ref.qualified))
  );
}

/** One scope-prop finding for a parameter node, or null. Reads the name off the AST
 *  (`scope: Scope.Handle`, `{ scope }`, `scope`) and the type off its annotation when the
 *  name hides behind a Props alias carrying a scope type. */
function paramRow(source, seen, aliases, p) {
  if (!p || p.start === undefined || seen.has(p.start)) return null;
  seen.add(p.start);
  const hit = textHit(source.slice(p.start, p.end)) || refHit(aliases, p);
  if (hit)
    return {
      id: "no-scope-prop",
      line: lineOf(source, p.start),
      message:
        "scope in view props (best-practices rule 2): the root provides it; views never take it",
    };
  return null;
}

/** Every deterministic shape finding in one file, in source order. */
// oxlint-disable-next-line complexity
export function inspectShape(source, file = "a.tsx") {
  const program = parseSync(file, source).program;
  const rows = [];
  const bound = {
    hooks: new Map(),
    scopeCall: new Set(),
    scopeNs: new Set(),
    scopeView: new Set(),
    dataCall: new Set(),
  };
  for (const node of program.body) if (node.type === "ImportDeclaration") bindImports(bound, node);
  const aliases = scopeAliases(source, program);
  const tree = buildTree(program, bound.dataCall, bound.scopeNs, bound.scopeCall);
  const scopes = { tree, dataAlias: bound.dataCall, dataNs: bound.scopeNs };
  const comps = units(source, file).filter((u) => u.kind === "component");
  const starts = new Set(comps.map((u) => u.line));
  const ranges = comps.map((u) => [u.line, u.line + u.source.split("\n").length - 1]);
  const inView = (line) => ranges.some(([from, to]) => from <= line && line <= to);
  eachCall(program, (node) => {
    const row = callRow(source, node, bound, scopes, inView);
    if (row !== null) rows.push(row);
  });
  for (const node of program.body)
    for (const fn of topFns(source, node)) {
      if (!starts.has(fn.line) || providesScope(fn.body, bound)) continue;
      const seen = new Set();
      for (const p of fn.params) {
        if (p.type === "ObjectPattern")
          for (const q of p.properties) {
            const row = paramRow(source, seen, aliases, q.value ?? q);
            if (row !== null) rows.push(row);
          }
        else {
          const row = paramRow(source, seen, aliases, p);
          if (row !== null) rows.push(row);
        }
      }
    }
  rows.sort((a, b) => a.line - b.line || (a.id < b.id ? -1 : 1));
  return rows;
}
