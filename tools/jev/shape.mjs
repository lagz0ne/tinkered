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

/** A `useData(…)` call — plain, aliased, or off a `@tinker/react` namespace — else false.
 *  A bare name bound anywhere else (another module's import, a local declaration) is an
 *  unrelated same-name function, never the hook. */
function isDataCall(node, dataAlias, dataNs, shadowed) {
  const c = node.callee;
  if (c?.type === "Identifier")
    return (c.name === "useData" || dataAlias.has(c.name)) && !shadowed.has(c.name);
  const member = memberOf(c);
  return member !== null && member.name === "useData" && dataNs.has(member.obj);
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

/** One parameter's bound names into `take`: plain, destructured, or array. */
function takeParam(take, p) {
  if (p.type === "Identifier") take(p);
  if (p.type === "ObjectPattern") for (const q of p.properties) take(q.value ?? q.key);
  if (p.type === "ArrayPattern") for (const e of p.elements) take(e);
}

/** One arrow/function-expression's parameter names into `take`. */
function takeParams(take, n) {
  for (const p of n.params ?? []) takeParam(take, p);
}

/** Local names hiding the hook: a declared `useData` of our own (imported elsewhere,
 *  function, param, or catch binding) means a bare call is that name, never the hook. */
function shadowedData(program) {
  const names = new Set();
  const take = (id) => {
    if (id?.type === "Identifier") names.add(id.name);
  };
  walk(program, (n) => {
    if (n.type === "ImportDeclaration" && n.source.value !== "@tinker/react")
      for (const s of n.specifiers) take(s.local);
    if (n.type === "FunctionDeclaration") take(n.id);
    if (n.type === "VariableDeclarator") take(n.id);
    if (n.type === "CatchClause" && n.param) take(n.param);
  });
  walk(program, (n) => {
    if (n.type !== "ArrowFunctionExpression" && n.type !== "FunctionExpression") return;
    takeParams(take, n);
  });
  return names;
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

/** One writable-useData finding for a call node in a view, or null. Plain, aliased,
 *  or namespaced from `@tinker/react`; anything else is not the hook. */
function writableRow(source, node, bound, line, inView, shadowed) {
  const writes =
    isDataCall(node, bound.dataCall, bound.scopeNs, shadowed) && writesCell(node) && inView(line);
  if (!writes) return null;
  return {
    id: "no-writable-in-view",
    line,
    message:
      "writable useData in a view (best-practices rule 9): typing and filter writes are actions; operations own their state changes",
  };
}

/** One banned-hook, writable-useData, or in-view scope finding for a call node, or null. */
function callRow(source, node, bound, inView, shadowed) {
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
  return writableRow(source, node, bound, line, inView, shadowed);
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
  const shadowed = shadowedData(program);
  const comps = units(source, file).filter((u) => u.kind === "component");
  const starts = new Set(comps.map((u) => u.line));
  const ranges = comps.map((u) => [u.line, u.line + u.source.split("\n").length - 1]);
  const inView = (line) => ranges.some(([from, to]) => from <= line && line <= to);
  walk(program, (n) => {
    if (n.type !== "CallExpression" || n.start === undefined) return;
    const row = callRow(source, n, bound, inView, shadowed);
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
