import { parseSync } from "oxc-parser";
import type {
  Declaration,
  Expression,
  ObjectProperty,
  Program,
  VariableDeclarator,
} from "oxc-parser";
import type { Blueprint } from "./blueprint.ts";

const UNIT_KINDS = new Set(["data", "resource", "operation", "tag"]);

/** Is `name` one of the four unit kinds? Narrows a plain identifier name to `Node["kind"]`. */
function isUnitKind(name: string): name is Blueprint.Node["kind"] {
  return UNIT_KINDS.has(name);
}

const sliceOf = (src: string, node: { readonly start: number; readonly end: number }): string =>
  src.slice(node.start, node.end);

const lineOf = (src: string, index: number): number => src.slice(0, index).split("\n").length;

function keyName(property: ObjectProperty): string | undefined {
  const key = property.key;
  if (key.type === "Identifier") return key.name;
  if (key.type === "Literal" && typeof key.value === "string") return key.value;
  return undefined;
}

/** The `{ … }` argument's property named `name`, or `undefined` — a `SpreadElement` carries
 * no name, so only a `Property` ever matches. */
function prop(config: Expression, name: string): Expression | undefined {
  if (config.type !== "ObjectExpression") return undefined;
  const found = config.properties.find(
    (property): property is ObjectProperty =>
      property.type === "Property" && keyName(property) === name,
  );
  return found?.value;
}

/** One `depends` value's identifier root: a bare name as written; `x.optional` strips to `x`
 * (the tag's own optional read, not a part of it); any other member access (`store.tx`) keeps
 * its full text — a dotted name never matches a node (ADR 0055 §1). */
function dependsRoot(src: string, value: Expression): string {
  if (value.type === "Identifier") return value.name;
  if (
    value.type === "MemberExpression" &&
    !value.computed &&
    value.property.type === "Identifier" &&
    value.property.name === "optional"
  )
    return dependsRoot(src, value.object);
  return sliceOf(src, value);
}

/** Every `depends` value's identifier root, in source order; `[]` with no `depends` property. */
function dependsOf(src: string, config: Expression): readonly string[] {
  const node = prop(config, "depends");
  if (node?.type !== "ObjectExpression") return [];
  return node.properties
    .filter((property): property is ObjectProperty => property.type === "Property")
    .map((property) => dependsRoot(src, property.value));
}

function labelOf(config: Expression): string | undefined {
  const node = prop(config, "label");
  return node?.type === "Literal" && typeof node.value === "string" ? node.value : undefined;
}

/** `"session"` on a literal `target: "session"`; else `"scope"` on a resource, `undefined`
 * otherwise (a `data`/`operation`/`tag` unit never carries `target`). */
function targetOf(
  config: Expression,
  kind: Blueprint.Node["kind"],
): "scope" | "session" | undefined {
  const node = prop(config, "target");
  if (node?.type === "Literal" && node.value === "session") return "session";
  return kind === "resource" ? "scope" : undefined;
}

/** The exact source text of `run` or `factory`, when its value is a function; `undefined`
 * otherwise (a `data`/`tag` unit carries neither). */
function bodyOf(src: string, config: Expression): string | undefined {
  const node = prop(config, "run") ?? prop(config, "factory");
  if (node?.type === "ArrowFunctionExpression" || node?.type === "FunctionExpression")
    return sliceOf(src, node);
  return undefined;
}

/** One `const x = kind({ … })` declarator as a unit, or `undefined`: not a unit builder call,
 * a spread argument, or no literal `label` (the diff cannot name it). */
function unitOf(
  src: string,
  file: string,
  declarator: VariableDeclarator,
): Blueprint.Unit | undefined {
  const init = declarator.init;
  if (init?.type !== "CallExpression" || init.callee.type !== "Identifier") return undefined;
  const kindName = init.callee.name;
  if (!isUnitKind(kindName)) return undefined;
  const arg = init.arguments[0];
  if (arg === undefined || arg.type === "SpreadElement") return undefined;
  const label = labelOf(arg);
  if (label === undefined) return undefined;
  return {
    kind: kindName,
    label,
    file,
    line: lineOf(src, declarator.start),
    depends: dependsOf(src, arg),
    target: targetOf(arg, kindName),
    body: bodyOf(src, arg),
  };
}

/** The declaration a top-level statement carries: itself when it already is one, the wrapped
 * declaration when it is an `export`, `undefined` otherwise (an import, a bare expression, …). */
function declarationOf(statement: Program["body"][number]): Declaration | undefined {
  if (statement.type === "ExportNamedDeclaration") return statement.declaration ?? undefined;
  if (statement.type === "VariableDeclaration") return statement;
  return undefined;
}

/** Every `const x = data|resource|operation|tag({ … })` in one file, with a string `label`.
 * A unit without a literal label, or wrapped in a function, is skipped (the diff cannot name
 * it). */
export function readUnits(src: string, file: string): readonly Blueprint.Unit[] {
  const program = parseSync(file, src).program;
  const units: Blueprint.Unit[] = [];
  for (const statement of program.body) {
    const declaration = declarationOf(statement);
    if (declaration?.type !== "VariableDeclaration" || declaration.kind !== "const") continue;
    for (const declarator of declaration.declarations) {
      const unit = unitOf(src, file, declarator);
      if (unit !== undefined) units.push(unit);
    }
  }
  return units;
}
