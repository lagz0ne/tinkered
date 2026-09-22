import { tsxLanguage, typescriptLanguage } from "@codemirror/lang-javascript";
import type { Source } from "@/lib/sources.ts";

/** A spot in a source: the file's name and the character offset inside it. */
export type Place = { file: string; offset: number };

type Tree = ReturnType<typeof tsxLanguage.parser.parse>;
type Node = ReturnType<Tree["resolveInner"]>;
type Hop = { module: string; imported: string };
type Binding = { local: string; imported: string };

const NAMES: Record<string, boolean> = {
  VariableName: true,
  TypeName: true,
  VariableDefinition: true,
  TypeDefinition: true,
  JSXIdentifier: true,
};

const DECLARERS: Record<string, boolean> = {
  VariableDeclaration: true,
  FunctionDeclaration: true,
  ClassDeclaration: true,
  NamespaceDeclaration: true,
  TypeAliasDeclaration: true,
  ForOfSpec: true,
  ForInSpec: true,
};

const WRAPPERS: Record<string, boolean> = {
  ExportDeclaration: true,
  AmbientDeclaration: true,
  ForSpec: true,
};

const SCOPES: Record<string, boolean> = { Block: true, ForStatement: true };

const FUNCTIONS: Record<string, boolean> = {
  FunctionDeclaration: true,
  FunctionExpression: true,
  ArrowFunction: true,
};

function parseSource(source: Source): Tree {
  const language = source.name.endsWith(".tsx") ? tsxLanguage : typescriptLanguage;
  return language.parser.parse(source.content);
}

function children(node: Node): Node[] {
  const out: Node[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) out.push(child);
  return out;
}

function childNamed(node: Node, name: string): Node | undefined {
  return children(node).find((child) => child.name === name);
}

function text(source: Source, node: Node): string {
  return source.content.slice(node.from, node.to);
}

function ancestor(node: Node, name: string): Node | undefined {
  for (let scope = node.parent; scope; scope = scope.parent) {
    if (scope.name === name) return scope;
  }
  return undefined;
}

function rootNode(tree: Tree): Node {
  let node = tree.resolveInner(0, 1);
  while (node.parent) node = node.parent;
  return node;
}

function nodeAt(tree: Tree, content: string, offset: number): Node {
  if (offset > 0) {
    const left = tree.resolveInner(offset - 1, 1);
    if (left.to === offset && /[A-Za-z_$]/.test(content[left.from] ?? "")) return left;
  }
  return tree.resolveInner(offset, 1);
}

function dirname(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? "" : path.slice(0, cut);
}

function joinPath(dir: string, spec: string): string {
  const out: string[] = [];
  for (const part of [...dir.split("/"), ...spec.split("/")]) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

function resolveSource(spec: string, from: Source, sources: readonly Source[]): Source | undefined {
  const relative = spec.startsWith(".");
  const base = relative ? joinPath(dirname(from.name), spec) : spec;
  const candidates = relative
    ? [base, `${base}.ts`, `${base}.tsx`]
    : [`${base}/index.ts`, base, `${base}.ts`];
  for (const candidate of candidates) {
    const hit = sources.find((source) => source.name === candidate);
    if (hit) return hit;
  }
  return undefined;
}

function modulePlace(sources: readonly Source[], from: Source, node: Node): Place | undefined {
  const parent = node.parent;
  if (!parent || (parent.name !== "ImportDeclaration" && parent.name !== "ExportDeclaration"))
    return undefined;
  const target = resolveSource(text(from, node).slice(1, -1), from, sources);
  return target ? { file: target.name, offset: 0 } : undefined;
}

function importedName(from: Source, node: Node): string | undefined {
  if (node.name === "VariableName") return text(from, node);
  if (node.name !== "VariableDefinition") return undefined;
  const prev = node.prevSibling;
  if (prev?.name !== "as") return text(from, node);
  const imported = prev.prevSibling;
  return imported?.name === "VariableName" ? text(from, imported) : undefined;
}

function importPlace(
  sources: readonly Source[],
  from: Source,
  node: Node,
  declaration: Node,
  visited: Set<string>,
): Place | undefined {
  const spec = childNamed(declaration, "String");
  if (!spec) return undefined;
  const name = importedName(from, node);
  if (!name) return undefined;
  const target = resolveSource(text(from, spec).slice(1, -1), from, sources);
  if (!target) return undefined;
  return linkName(sources, target, name, visited);
}

function reexportPlace(
  sources: readonly Source[],
  from: Source,
  node: Node,
  declaration: Node,
  visited: Set<string>,
): Place | undefined {
  if (node.name !== "VariableName" && node.name !== "VariableDefinition") return undefined;
  const spec = childNamed(declaration, "String");
  if (!spec) return undefined;
  const target = resolveSource(text(from, spec).slice(1, -1), from, sources);
  if (!target) return undefined;
  return linkName(sources, target, text(from, node), visited);
}

function declarationIn(stmt: Node, source: Source, name: string): Node | undefined {
  if (WRAPPERS[stmt.name]) {
    for (const kid of children(stmt)) {
      const hit = declarationIn(kid, source, name);
      if (hit) return hit;
    }
    return undefined;
  }
  if (!DECLARERS[stmt.name]) return undefined;
  const wanted = stmt.name === "TypeAliasDeclaration" ? "TypeDefinition" : "VariableDefinition";
  return children(stmt).find((kid) => kid.name === wanted && text(source, kid) === name);
}

function paramNamed(kid: Node, source: Source, name: string): boolean {
  if (kid.name === "PatternProperty") {
    const key = childNamed(kid, "PropertyName");
    return key !== undefined && text(source, key) === name;
  }
  if (kid.name === "VariableDefinition" || kid.name === "TypeDefinition")
    return text(source, kid) === name;
  return false;
}

function deepDeclares(scope: Node, source: Source, name: string): boolean {
  for (const kid of children(scope)) {
    if (paramNamed(kid, source, name) || deepDeclares(kid, source, name)) return true;
  }
  return false;
}

function declaresParam(fn: Node, source: Source, name: string): boolean {
  const params = childNamed(fn, "ParamList");
  return params !== undefined && deepDeclares(params, source, name);
}

function shadowed(node: Node, source: Source, name: string): boolean {
  for (let scope = node.parent; scope; scope = scope.parent) {
    if (scope.parent === null) return false;
    if (SCOPES[scope.name] && children(scope).some((kid) => declarationIn(kid, source, name)))
      return true;
    if (FUNCTIONS[scope.name] && declaresParam(scope, source, name)) return true;
  }
  return false;
}

function importEntries(group: Node, source: Source): Binding[] {
  const out: Binding[] = [];
  const kids = children(group);
  for (let i = 0; i < kids.length; i++) {
    const kid = kids[i];
    if (kid.name === "VariableName") {
      const alias = kids[i + 2];
      if (kids[i + 1]?.name === "as" && alias?.name === "VariableDefinition") {
        i += 2;
        out.push({ local: text(source, alias), imported: text(source, kid) });
      }
    } else if (kid.name === "VariableDefinition") {
      out.push({ local: text(source, kid), imported: text(source, kid) });
    }
  }
  return out;
}

function importBinding(group: Node, source: Source, wanted: string): string | undefined {
  return importEntries(group, source).find((binding) => binding.local === wanted)?.imported;
}

function boundImport(root: Node, source: Source, name: string): Hop | undefined {
  for (const kid of children(root)) {
    if (kid.name !== "ImportDeclaration") continue;
    const spec = childNamed(kid, "String");
    const group = childNamed(kid, "ImportGroup");
    if (!spec || !group) continue;
    const imported = importBinding(group, source, name);
    if (imported) return { module: text(source, spec).slice(1, -1), imported };
  }
  return undefined;
}

function reexported(root: Node, source: Source, name: string): Hop | undefined {
  for (const kid of children(root)) {
    if (kid.name !== "ExportDeclaration") continue;
    const spec = childNamed(kid, "String");
    const group = childNamed(kid, "ExportGroup");
    if (!spec || !group) continue;
    const named = children(group).some(
      (entry) => entry.name === "VariableName" && text(source, entry) === name,
    );
    if (named) return { module: text(source, spec).slice(1, -1), imported: name };
  }
  return undefined;
}

function linkName(
  sources: readonly Source[],
  source: Source,
  name: string,
  visited: Set<string>,
): Place | undefined {
  const key = `${source.name} ${name}`;
  if (visited.has(key)) return undefined;
  visited.add(key);
  const tree = parseSource(source);
  const root = rootNode(tree);
  for (const kid of children(root)) {
    const hit = declarationIn(kid, source, name);
    if (hit) return { file: source.name, offset: hit.from };
  }
  const hop = boundImport(root, source, name) ?? reexported(root, source, name);
  if (!hop) return undefined;
  const target = resolveSource(hop.module, source, sources);
  if (!target) return undefined;
  return linkName(sources, target, hop.imported, visited);
}

function blocked(node: Node): boolean {
  if (node.name === "VariableDefinition" || node.name === "TypeDefinition") return true;
  const dot = node.prevSibling?.name === ".";
  if (node.name === "JSXIdentifier") return dot || node.parent?.name === "JSXAttribute";
  return dot;
}

/** The declaration `offset` points at: an import specifier, a module path, a reexport, or a
 * reference followed to its top-level declaration. Comments, strings, property names, declaration
 * names themselves, shadowed locals, and names nothing declares give no link, never a guess. */
export function resolveDefinition(
  sources: readonly Source[],
  from: Source,
  offset: number,
): Place | undefined {
  const tree = parseSource(from);
  const node = nodeAt(tree, from.content, offset);
  const visited = new Set<string>();
  if (node.name === "String") return modulePlace(sources, from, node);
  if (!NAMES[node.name]) return undefined;
  const imported = ancestor(node, "ImportDeclaration");
  if (imported) return importPlace(sources, from, node, imported, visited);
  if (blocked(node)) return undefined;
  const exported = ancestor(node, "ExportDeclaration");
  if (exported && childNamed(exported, "String"))
    return reexportPlace(sources, from, node, exported, visited);
  const name = text(from, node);
  if (shadowed(node, from, name)) return undefined;
  return linkName(sources, from, name, visited);
}
