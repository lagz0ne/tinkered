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

/** The banned hook behind a call — bare, aliased, or namespaced — else null.
 *  `useData` is never a banned hook here: the writable rule owns it with
 *  scope resolution, so a local shadowing the import must not flag. */
function hookOf(callee, bindings) {
  if (callee?.type === "Identifier" && callee.name === "useData") return null;
  return bareHook(callee, bindings) ?? nsHook(callee, bindings);
}

/** A `useScope(…)` call at this site — bare, aliased, or off a bound namespace —
 *  else false. The name must resolve to the `@tinker/react` import; a local
 *  `useScope` of our own is never the hook. */
function isScopeCall(node, bound, ctx) {
  const c = node.callee;
  if (c?.type === "Identifier") {
    if (c.name !== "useScope" && !bound.scopeCall.has(c.name)) return false;
    return ctx.get(c.name, node) === "hook-scope";
  }
  const member = memberOf(c);
  return (
    member !== null &&
    member.name === "useScope" &&
    bound.scopeNs.has(member.obj) &&
    ctx.get(member.obj, node) === "hook-ns"
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

/** Node types with their own scope frame. */
const SHAPE_FRAMES = new Map([
  ["Program", "module"],
  ["FunctionDeclaration", "function"],
  ["FunctionExpression", "function"],
  ["ArrowFunctionExpression", "function"],
  ["BlockStatement", "block"],
  ["StaticBlock", "block"],
  ["ForStatement", "loop"],
  ["ForInStatement", "loop"],
  ["ForOfStatement", "loop"],
  ["CatchClause", "catch"],
]);

/** The frame kind of one node type, or null for nodes that share a frame. */
function frameKind(type) {
  return SHAPE_FRAMES.get(type) ?? null;
}

/** Visit array children under the same parent. */
function visitKids(node, parent, visit) {
  for (const v of node) visit(v, parent);
}

/** Visit one child value: arrays fan out, typed nodes recurse. */
function visitKid(v, node, parent, visit) {
  if (Array.isArray(v)) for (const w of v) visit(w, node.type ? node : parent);
  else if (v && typeof v === "object" && v.type) visit(v, node.type ? node : parent);
}

/** Record one node's parent and owning frame. */
function ownNode(node, parent, owners, parents, program) {
  parents.set(node, parent);
  if (frameKind(node.type)) owners.set(node, node);
  else if (!owners.has(node)) owners.set(node, owners.get(parent) ?? program);
}

/** Map every node to its parent and its owning frame, once. Arrays fan out
 *  without a frame; every other node resolves in its nearest frame owner.
 *  Parents live in a side table (never on the AST), so later generic walks
 *  cannot loop back through them. Owners link upward: each frame owner's
 *  owner is its own parent owner, so lookup walks frame to frame. */
function frameMap(program) {
  const owners = new Map([[program, program]]);
  const parents = new Map();
  const seen = new Set();
  const visit = (node, parent) => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) return visitKids(node, parent, visit);
    if (node.type) ownNode(node, parent, owners, parents, program);
    for (const v of Object.values(node)) visitKid(v, node, parent, visit);
  };
  visit(program, null);
  return { owners, parents };
}

/** Resolve `name` at `node`: innermost owning frame outward to the module.
 *  Frames own themselves in `owners`, so stepping from a frame goes through
 *  the parents table to the nearest enclosing frame — never through another
 *  entry's owner link. */
function lookupAt(frames, owners, parents, node, name) {
  let at = owners.get(node) ?? null;
  while (at) {
    const frame = frames.get(at);
    if (frame?.has(name)) return frame.get(name);
    at = parentFrame(owners, parents, at);
  }
  return undefined;
}

/** The parent frame above one frame: nearest enclosing frame-owning node. */
function parentFrame(owners, parents, at) {
  let parent = parents.get(at) ?? null;
  while (parent && !frameKind(parent.type)) parent = parents.get(parent) ?? null;
  return parent;
}

/** Declare hoisted names through the whole tree before anything else:
 *  every function declaration name and every `var` name, each in its own
 *  owning frame. Order-free, so a call above a later declaration resolves
 *  to the local, and a block-level `function` in strict mode stays put.
 *  (Module code here is strict — see the strict-block test below.) */
function declareHoisted(program, bind, owners, frames, parents) {
  walk(program, (n) => {
    if (!n.type) return;
    if (n.type === "FunctionDeclaration" && n.id) bindOuter(frames, owners, parents, n, n.id.name);
    if (n.type === "VariableDeclaration" && n.kind === "var") bindVar(n, owners, frames, parents);
  });
}

/** A function declaration's name binds in the enclosing frame (parent frame
 *  of its own frame), never inside itself. */
function bindOuter(frames, owners, parents, n, name) {
  const outer = parentFrame(owners, parents, n);
  if (outer !== null && !frames.has(outer)) frames.set(outer, new Map());
  frames.get(outer)?.set(name, "local");
}

/** Declare every binding into its owning frame: imports and hoisted names
 *  first (order-free), then params, lets, catches, and loop heads in place.
 *  One generic child walk — every node kind reaches a frame this way, so no
 *  statement shape can hide a nested block from scope creation. Loop heads
 *  bind through the generic `bindLocals` below: their declarator already owns
 *  to the loop frame, so no head-specific branch is needed. */
function declareAll(program, frames, bound, owners, parents) {
  const bind = (node, name, kind) => bindAt(frames, owners, node, name, kind);
  declareHoisted(program, bind, owners, frames, parents);
  const pre = (node) => {
    if (node.type === "ImportDeclaration") noteRow(node, bind, bound);
  };
  walk(program, (n) => {
    if (!n.type) return;
    pre(n);
  });
  walk(program, (n) => {
    if (!n.type) return;
    bindParams(n, bind);
    bindLocals(n, bind);
    if (n.type === "CatchClause" && n.param)
      for (const name of patternNames(n.param)) bind(n, name, "local");
  });
  return owners;
}

/** Bind one non-hoisted declaration into its owning frame: `let`/`const`
 *  declarators and named function-expression names. A loop head's declarator
 *  already owns to the loop frame, so no head check is needed. Loop bodies
 *  declare nothing here; their own BlockStatement frame owns them. */
function bindLocals(n, bind) {
  bindDecl(n, bind);
  if ((n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression") && n.id)
    bind(n, n.id.name, "local");
}

/** Bind `let`/`const` declarator names into the owning frame. */
function bindDecl(n, bind) {
  if (n.type !== "VariableDeclaration" || n.kind === "var") return;
  for (const d of n.declarations ?? [])
    for (const name of patternNames(d.id)) bind(n, name, "local");
}

/** Bind function params into the function's own frame. */
function bindParams(n, bind) {
  if (
    n.type !== "FunctionDeclaration" &&
    n.type !== "FunctionExpression" &&
    n.type !== "ArrowFunctionExpression"
  )
    return;
  for (const q of n.params ?? []) for (const name of patternNames(q)) bind(n, name, "local");
}

/** Is this binding kind a hook import (fills gaps only). */
function isHookKind(kind) {
  return kind === "hook" || kind === "hook-scope" || kind === "hook-ns";
}

/** Bind `name` → `kind` in the frame owning `node`. A local declared
 *  anywhere in the frame beats the import: locals overwrite, imports only
 *  fill gaps, so passes can run in any order. */
function bindAt(frames, owners, node, name, kind) {
  const owner = owners.get(node) ?? null;
  if (owner === null) return;
  if (!frames.has(owner)) frames.set(owner, new Map());
  const frame = frames.get(owner);
  if (!frame) return;
  if (!isHookKind(kind) || !frame.has(name)) frame.set(name, kind);
}

/** A `var` binds at the enclosing function (or module) frame, past blocks.
 *  Walks the parents table (strictly upward like parentFrame), never the
 *  owners map: a frame owns itself there, which loops forever. */
function bindVar(node, owners, frames, parents) {
  const owner = fnOwner(owners, parents, owners.get(node) ?? null);
  for (const d of node.declarations ?? [])
    for (const name of patternNames(d.id)) bindAt(frames, owners, owner ?? node, name, "local");
}

/** Walk up to the enclosing function (or module) frame owner. */
function fnOwner(owners, parents, owner) {
  let at = owner;
  while (at && !isFnRoot(at)) at = parentFrame(owners, parents, at);
  return at;
}

/** Is this frame owner a function or the module. */
function isFnRoot(node) {
  return node?.type === "Program" || frameKind(node?.type) === "function";
}

/** Bind one import row: hook kinds stay, everything else is `local`. */
function noteRow(node, bind, bound) {
  const hook = node.source.value === "@tinker/react";
  for (const q of node.specifiers) {
    if (q.local)
      bind(node, q.local.name, specKind(q, hook, bound.dataCall, bound.scopeNs, bound.scopeCall));
  }
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
 *  to the `@tinker/react` import through the frame tree at the call site. */
function writableRow(source, node, ctx, inView) {
  const line = lineOf(source, node.start);
  const hook = hookAt(node.callee, ctx, node);
  if (!hook || !writesCell(node) || !inView(line)) return null;
  return {
    id: "no-writable-in-view",
    line,
    message:
      "writable useData in a view (best-practices rule 9): typing and filter writes are actions; operations own their state changes",
  };
}

/** Does this callee name the imported hook at this call site. */
function hookAt(callee, ctx, node) {
  if (callee?.type === "Identifier") {
    if (callee.name !== "useData" && !ctx.alias.has(callee.name)) return false;
    return ctx.get(callee.name, node) === "hook";
  }
  const member = memberOf(callee);
  return (
    member !== null &&
    member.name === "useData" &&
    ctx.ns.has(member.obj) &&
    ctx.get(member.obj, node) === "hook-ns"
  );
}

/** One banned-hook, writable-useData, or in-view scope row for a call, or null. */
function callRow(source, node, bound, ctx, inView) {
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
  if (isScopeCall(node, bound, ctx) && inView(line))
    return {
      id: "no-scope-in-view",
      line,
      message:
        "useScope in a view (best-practices rule 2): only the root holds the scope; views read cells and run operations",
    };
  return writableRow(source, node, ctx, inView);
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
  const frames = new Map();
  const { owners, parents } = frameMap(program);
  const scopes = {
    alias: bound.dataCall,
    ns: bound.scopeNs,
    get: (name, node) => lookupAt(frames, owners, parents, node, name),
  };
  declareAll(program, frames, bound, owners, parents);
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
