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

// oxlint-disable-next-line complexity
/** A `useScope(…)` call — bare, aliased, or off a `@tinker/react` namespace — else false. */
function isScopeCall(node, scopeAlias, scopeNs) {
  const c = node.callee;
  if (c?.type === "Identifier") return c.name === "useScope" || scopeAlias.has(c.name);
  const member = memberOf(c);
  return member !== null && member.name === "useScope" && scopeNs.has(member.obj);
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

/** Is this specifier the `useData` name itself from `@tinker/react`? */
function isHookSpec(s, hook) {
  return s.type === "ImportSpecifier" && hook && s.imported?.name === "useData";
}

/** Is this specifier a known `useData` alias from `@tinker/react`? */
function isAliasSpec(s, hook, hookAlias) {
  return s.type === "ImportSpecifier" && hook && hookAlias.has(s.local.name);
}

/** Is this specifier a namespace bound to `@tinker/react`? */
function isNsSpec(s, hook, hookNs) {
  const ns = s.type === "ImportDefaultSpecifier" || s.type === "ImportNamespaceSpecifier";
  return ns && hook && hookNs.has(s.local.name);
}

/** The binding kind of one import specifier: `hook` for the `useData` name itself
 *  or a known alias, `hook-ns` for a bound namespace, else `local`. */
function specKind(s, hook, hookAlias, hookNs) {
  if (isHookSpec(s, hook) || isAliasSpec(s, hook, hookAlias)) return "hook";
  if (isNsSpec(s, hook, hookNs)) return "hook-ns";
  return "local";
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

/** Function node types: one lexical scope each. Block statements own a scope for
 *  let/const/catch; `var` and function declarations belong to the function.
 *  `extract.mjs` keeps its own copy for units. */
const SHAPE_BLOCK_TYPES = new Set(["BlockStatement", "StaticBlock"]);

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

/** One scope-frame stack: push/pop maps of name → kind, read innermost first. */
function scopeStack() {
  const frames = [new Map()];
  return {
    push: () => frames.push(new Map()),
    pop: () => frames.pop(),
    set: (name, kind) => frames[frames.length - 1].set(name, kind),
    setVar: (name, kind) => {
      for (let i = frames.length - 1; i >= 0; i--) {
        if (frames[i].get("@kind") === "function") {
          frames[i].set(name, kind);
          return;
        }
      }
      frames[0].set(name, kind);
    },
    get: (name) => {
      for (let i = frames.length - 1; i >= 0; i--)
        if (frames[i].has(name)) return frames[i].get(name);
      return undefined;
    },
    markFunction: () => frames[frames.length - 1].set("@kind", "function"),
  };
}

/** Does this callee name the hook — a plain or aliased `useData` bound to the
 *  `@tinker/react` import, or `useData` off one of its bound namespaces? */
function namesHook(callee, dataAlias, dataNs, scopes) {
  if (callee?.type === "Identifier") {
    if (callee.name !== "useData" && !dataAlias.has(callee.name)) return false;
    return scopes.get(callee.name) === "hook";
  }
  const member = memberOf(callee);
  return (
    member !== null &&
    member.name === "useData" &&
    dataNs.has(member.obj) &&
    scopes.get(member.obj) === "hook-ns"
  );
}

/** Bind one `import … from` row: hook bindings stay `hook`/`hook-ns`, else `local`. */
function noteImport(scopes, hookAlias, hookNs, node) {
  const hook = node.source.value === "@tinker/react";
  for (const s of node.specifiers) {
    if (!s.local) continue;
    scopes.set(s.local.name, specKind(s, hook, hookAlias, hookNs));
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

/** Bind a `let`/`const` declarator: every name in its id pattern. `var` belongs
 *  to the enclosing function, so it walks outward past block frames. */
function noteDeclarator(scopes, node) {
  for (const d of node.declarations ?? [])
    for (const name of patternNames(d.id))
      (node.kind === "var" ? scopes.setVar : scopes.set.bind(scopes))(name, "local");
}

/** Bind a `catch` binding into the current block scope. */
function noteCatch(scopes, node) {
  if (node.param) for (const name of patternNames(node.param)) scopes.set(name, "local");
}

/** One node on the single scope-aware pass. Functions push a scope, bind params
 *  (plus a named expression's own name), and declare their name outside. Blocks
 *  push a scope for let/const/catch. The writable check reads the stack in place.
 *  One branch per node kind keeps it under the cap. */
function visitScoped(source, bound, inView, scopes, rows, node) {
  const kind = node.type ?? "";
  if (kind === "ImportDeclaration") return noteImport(scopes, bound.dataCall, bound.scopeNs, node);
  if (kind === "FunctionDeclaration") return enterNamed(source, bound, inView, scopes, rows, node);
  if (kind === "FunctionExpression" || kind === "ArrowFunctionExpression")
    return enterAnon(source, bound, inView, scopes, rows, node);
  if (SHAPE_BLOCK_TYPES.has(kind)) return enterBlock(source, bound, inView, scopes, rows, node);
  visitLeaf(source, bound, inView, scopes, rows, kind, node);
}
/** A leaf node: bind what it declares, check what it calls, then walk its kids. */
function visitLeaf(source, bound, inView, scopes, rows, kind, node) {
  if (kind === "VariableDeclaration") noteDeclarator(scopes, node);
  else if (kind === "CatchClause") noteCatch(scopes, node);
  else if (kind === "CallExpression" && node.start !== undefined) {
    checkCall(source, bound, inView, scopes, rows, node);
    return;
  }
  for (const v of Object.values(node))
    if (v && typeof v === "object") visitScoped(source, bound, inView, scopes, rows, v);
}

/** A named function: declare its name outside, then run its body in its own
 *  scope with params bound. The declaration hoists, so the name binds before
 *  the body runs even when the statement sits after a call. */
function enterNamed(source, bound, inView, scopes, rows, node) {
  if (node.id) scopes.set(node.id.name, "local");
  scopes.push();
  scopes.markFunction();
  bindParams(scopes, node);
  for (const v of Object.values(node.body ?? {}))
    if (v && typeof v === "object") visitScoped(source, bound, inView, scopes, rows, v);
  scopes.pop();
}

/** An anonymous function: its own scope with params bound; a named expression
 *  also binds its own name inside itself for recursion. */
function enterAnon(source, bound, inView, scopes, rows, node) {
  scopes.push();
  scopes.markFunction();
  if (node.id) scopes.set(node.id.name, "local");
  bindParams(scopes, node);
  for (const key of ["body", "returnType", "typeParameters"])
    if (node[key] && typeof node[key] === "object")
      visitScoped(source, bound, inView, scopes, rows, node[key]);
  scopes.pop();
}
/** Bind every param name of one function into its scope. */
function bindParams(scopes, node) {
  for (const p of node.params ?? []) for (const name of patternNames(p)) scopes.set(name, "local");
}

/** A block: its own scope for let/const/catch; `var` still lands on the function. */
function enterBlock(source, bound, inView, scopes, rows, node) {
  scopes.push();
  for (const v of Object.values(node))
    if (v && typeof v === "object") visitScoped(source, bound, inView, scopes, rows, v);
  scopes.pop();
}

/** A call in place: the writable check resolves its callee against live scopes. */
function checkCall(source, bound, inView, scopes, rows, node) {
  const resolve = (c) => namesHook(c.callee, bound.dataCall, bound.scopeNs, scopes);
  const row = callRow(source, node, bound, inView, resolve);
  if (row !== null) rows.push(row);
}

/** One writable-useData finding for a call node in a view, or null. The callee name
 *  must resolve to the `@tinker/react` import through the enclosing function scope —
 *  a sibling's local or an unimported name is never the hook. */
function writableRow(source, node, line, inView, resolve) {
  const writes = resolve(node) && writesCell(node) && inView(line);
  if (!writes) return null;
  return {
    id: "no-writable-in-view",
    line,
    message:
      "writable useData in a view (best-practices rule 9): typing and filter writes are actions; operations own their state changes",
  };
}

/** One banned-hook, writable-useData, or in-view scope finding for a call node, or null. */
function callRow(source, node, bound, inView, resolve) {
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
  if (isScopeCall(node, bound.scopeCall, bound.scopeNs) && inView(line))
    return {
      id: "no-scope-in-view",
      line,
      message:
        "useScope in a view (best-practices rule 2): only the root holds the scope; views read cells and run operations",
    };
  return writableRow(source, node, line, inView, resolve);
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
  const scopes = scopeStack();
  const comps = units(source, file).filter((u) => u.kind === "component");
  const starts = new Set(comps.map((u) => u.line));
  const ranges = comps.map((u) => [u.line, u.line + u.source.split("\n").length - 1]);
  const inView = (line) => ranges.some(([from, to]) => from <= line && line <= to);
  visitScoped(source, bound, inView, scopes, rows, program);
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
