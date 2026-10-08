import { resolve } from "node:path";
import { parseSource } from "../../packages/start/lib/source.mjs";

const BUILDERS = new Set(["operation", "resource", "tag", "data"]);
const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
const CLASSES = new Set(["ClassDeclaration", "ClassExpression"]);

function children(node) {
  return Object.values(node)
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter((value) => value && typeof value === "object");
}

function patternNames(node) {
  if (!node) return [];
  if (node.type === "Identifier") return [node.name];
  if (node.type === "RestElement") return patternNames(node.argument);
  if (node.type === "AssignmentPattern") return patternNames(node.left);
  if (node.type === "ObjectPattern")
    return node.properties.flatMap((p) => patternNames(p.value ?? p.argument));
  if (node.type === "ArrayPattern") return node.elements.flatMap(patternNames);
  return [];
}

/** Bindings in this block hide imports even before their declaration. */
function localNames(node) {
  const names = new Set((node.params ?? []).flatMap(patternNames));
  if (node.id?.name) names.add(node.id.name);
  const visit = (child) => {
    if (FUNCTIONS.has(child.type) || CLASSES.has(child.type)) {
      if (child.id) names.add(child.id.name);
      return;
    }
    if (
      [
        "BlockStatement",
        "CatchClause",
        "ForStatement",
        "ForInStatement",
        "ForOfStatement",
      ].includes(child.type)
    )
      return;
    if (child.type === "VariableDeclarator")
      for (const name of patternNames(child.id)) names.add(name);
    for (const next of children(child)) visit(next);
  };
  for (const child of children(node)) visit(child);
  return names;
}

function functionVars(node) {
  const names = new Set();
  const visit = (child) => {
    if (FUNCTIONS.has(child.type) || CLASSES.has(child.type)) return;
    if (child.type === "VariableDeclaration" && child.kind === "var")
      for (const decl of child.declarations)
        for (const name of patternNames(decl.id)) names.add(name);
    for (const next of children(child)) visit(next);
  };
  for (const child of children(node)) visit(child);
  return names;
}

function importedBuilders(program) {
  const names = new Map();
  for (const node of program.body) {
    if (node.type !== "ImportDeclaration" || node.source.value !== "@tinker/core") continue;
    for (const spec of node.specifiers) {
      if (spec.type === "ImportNamespaceSpecifier") names.set(spec.local.name, "*");
      if (spec.type === "ImportSpecifier" && BUILDERS.has(spec.imported.name))
        names.set(spec.local.name, spec.imported.name);
    }
  }
  return names;
}

function builderName(callee, names) {
  if (callee.type === "Identifier") {
    const name = names.get(callee.name);
    return name === "*" ? undefined : name;
  }
  if (callee.type !== "MemberExpression" || names.get(callee.object.name) !== "*") return;
  const name = callee.computed ? callee.property.value : callee.property.name;
  return BUILDERS.has(name) ? name : undefined;
}

function childBindings(node, names, nested) {
  if (
    !nested &&
    !["BlockStatement", "CatchClause", "ForStatement", "ForInStatement", "ForOfStatement"].includes(
      node.type,
    )
  )
    return names;
  const inner = new Map(names);
  for (const local of localNames(node)) inner.delete(local);
  if (FUNCTIONS.has(node.type)) for (const local of functionVars(node)) inner.delete(local);
  if (node.type === "CatchClause")
    for (const local of patternNames(node.param)) inner.delete(local);
  return inner;
}

function nestedBuilders(source) {
  const hits = [];
  const visit = (node, names, depth) => {
    const name = node.type === "CallExpression" ? builderName(node.callee, names) : undefined;
    if (depth > 0 && name) hits.push({ node, text: `${name} built inside a function or class` });
    const nested = FUNCTIONS.has(node.type) || CLASSES.has(node.type);
    const inner = childBindings(node, names, nested);
    for (const child of children(node)) visit(child, inner, depth + Number(nested));
  };
  visit(source.program, importedBuilders(source.program), 0);
  return hits;
}

function isThen(node) {
  if (node.type !== "CallExpression" || node.callee.type !== "MemberExpression") return false;
  const member = node.callee;
  return (member.computed ? member.property.value : member.property.name) === "then";
}

/** A chain used by await, return, assignment, or a later catch keeps its promise. */
function branchUses(node, discarded, visit) {
  if (node.type === "SequenceExpression") {
    node.expressions.forEach((expr, i) =>
      visit(expr, discarded || i < node.expressions.length - 1),
    );
    return true;
  }
  if (node.type === "ConditionalExpression") {
    visit(node.test);
    visit(node.consequent, discarded);
    visit(node.alternate, discarded);
    return true;
  }
  if (node.type === "LogicalExpression") {
    visit(node.left);
    visit(node.right, discarded);
    return true;
  }
  return false;
}

function expressionUse(node, discarded, visit) {
  if (node.type === "ExpressionStatement") {
    visit(node.expression, true);
    return true;
  }
  if (node.type === "UnaryExpression" && node.operator === "void") {
    visit(node.argument, true);
    return true;
  }
  if (
    ["ChainExpression", "TSAsExpression", "TSNonNullExpression", "TSSatisfiesExpression"].includes(
      node.type,
    )
  ) {
    visit(node.expression, discarded);
    return true;
  }
  return false;
}

function droppedThen(source) {
  const hits = [];
  const visit = (node, discarded = false) => {
    if (discarded && isThen(node)) hits.push({ node, text: "unused promise returned by .then" });
    if (expressionUse(node, discarded, visit)) return;
    if (branchUses(node, discarded, visit)) return;
    for (const child of children(node)) visit(child);
  };
  visit(source.program);
  return hits;
}

const [rule, ...files] = process.argv.slice(2);
const scope =
  rule === "P05" ? /(?:^|\/)apps\/|(?:^|\/)examples\// : /(?:^|\/)packages\/[^/]+\/src\//;
for (const file of files) {
  if (
    !scope.test(resolve(file)) ||
    /(?:^|\/)(?:tests?|__tests__)\/|\.(?:test|spec|browser)\./.test(file)
  )
    continue;
  const source = parseSource(file);
  const hits = rule === "P05" ? nestedBuilders(source) : droppedThen(source);
  for (const { node, text } of hits) console.log(`${file}:${source.line(node)}:${text}`);
}
