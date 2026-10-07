import { parseSync, Visitor } from "oxc-parser";
import type {
  ArrowFunctionExpression,
  CallExpression,
  Declaration,
  Expression,
  Function as ParsedFunction,
  MemberExpression,
  ObjectProperty,
  Program,
  VariableDeclarator,
} from "oxc-parser";
import type { Blueprint } from "./blueprint";

const UNIT_KINDS = ["data", "resource", "operation", "tag", "extension"];
const HOOK_NAMES = ["start", "session", "run", "resolve", "write", "close"];
const ACCESS_NAMES = ["controller", "resolve", "run"];

type Callable = ArrowFunctionExpression | ParsedFunction;

function isUnitKind(name: string): name is Blueprint.Node["kind"] {
  return UNIT_KINDS.includes(name);
}

function isInlineFunction(node: Expression): node is Callable {
  return node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression";
}

function isEventAccess(node: MemberExpression, receiver: string): boolean {
  return (
    !node.computed &&
    node.object.type === "Identifier" &&
    node.object.name === receiver &&
    node.property.type === "Identifier" &&
    ACCESS_NAMES.includes(node.property.name)
  );
}

function accessTarget(node: CallExpression, receiver: string): string | undefined {
  if (node.callee.type !== "MemberExpression" || !isEventAccess(node.callee, receiver))
    return undefined;
  const [target] = node.arguments;
  return target?.type === "Identifier" ? target.name : undefined;
}

/** Reads only a function's own calls on its first named parameter.
 * Nested functions have their own entry, so their parameters cannot look like hook access. */
function readFunctionAccess(program: Program): ReadonlyMap<Callable, readonly string[]> {
  const access = new Map<Callable, string[]>();
  const functions: Callable[] = [];
  function enter(node: Callable): void {
    functions.push(node);
  }
  function leave(): void {
    functions.pop();
  }
  new Visitor({
    ArrowFunctionExpression: enter,
    "ArrowFunctionExpression:exit": leave,
    FunctionExpression: enter,
    "FunctionExpression:exit": leave,
    FunctionDeclaration: enter,
    "FunctionDeclaration:exit": leave,
    CallExpression(node) {
      const owner = functions.at(-1);
      if (owner === undefined) return;
      const [parameter] = owner.params;
      if (parameter?.type !== "Identifier") return;
      const target = accessTarget(node, parameter.name);
      if (target === undefined) return;
      const found = access.get(owner);
      if (found === undefined) access.set(owner, [target]);
      else found.push(target);
    },
  }).visit(program);
  return access;
}

/** Hook dependencies are named direct access, not guesses about aliases or dynamic targets. */
function hookDepends(
  config: Expression,
  access: ReadonlyMap<Callable, readonly string[]>,
): readonly string[] {
  const hooks = prop(config, "hooks");
  if (hooks?.type !== "ObjectExpression") return [];
  const names = hooks.properties.flatMap((property) => {
    if (property.type !== "Property" || property.computed) return [];
    if (!HOOK_NAMES.includes(keyName(property) ?? "")) return [];
    if (!isInlineFunction(property.value)) return [];
    return access.get(property.value) ?? [];
  });
  return [...new Set(names)];
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

function dependsOf(
  src: string,
  config: Expression,
  kind: Blueprint.Node["kind"],
  access: ReadonlyMap<Callable, readonly string[]>,
): readonly string[] {
  if (kind === "extension") return hookDepends(config, access);
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

/** Literal resource targets keep their value; an absent or dynamic target reads as `scope`.
 * Other kinds have no target. */
function targetOf(config: Expression, kind: Blueprint.Node["kind"]): Blueprint.Unit["target"] {
  if (kind !== "resource") return undefined;
  const node = prop(config, "target");
  if (node?.type === "Literal" && (node.value === "session" || node.value === "namespace"))
    return node.value;
  return "scope";
}

/** Inline `run`/`factory` functions and an extension's literal `hooks` object keep their text.
 * A referenced function or hooks object cannot supply a body here. */
function bodyOf(src: string, config: Expression, kind: Blueprint.Node["kind"]): string | undefined {
  if (kind === "extension") {
    const hooks = prop(config, "hooks");
    return hooks?.type === "ObjectExpression" ? sliceOf(src, hooks) : undefined;
  }
  const node = prop(config, "run") ?? prop(config, "factory");
  if (node !== undefined && isInlineFunction(node)) return sliceOf(src, node);
  return undefined;
}

/** One `const x = kind({ … })` declarator as a unit, or `undefined`: not a unit builder call,
 * a spread argument, or no literal `label` (the diff cannot name it). */
function unitOf(
  src: string,
  file: string,
  declarator: VariableDeclarator,
  access: ReadonlyMap<Callable, readonly string[]>,
): Blueprint.Unit | undefined {
  const init = declarator.init;
  if (init?.type !== "CallExpression" || init.callee.type !== "Identifier") return undefined;
  const kindName = init.callee.name;
  if (!isUnitKind(kindName)) return undefined;
  const [arg] = init.arguments;
  if (arg === undefined || arg.type === "SpreadElement") return undefined;
  const label = labelOf(arg);
  if (label === undefined) return undefined;
  return {
    kind: kindName,
    label,
    file,
    line: lineOf(src, declarator.start),
    depends: dependsOf(src, arg, kindName, access),
    target: targetOf(arg, kindName),
    body: bodyOf(src, arg, kindName),
  };
}

function declarationOf(statement: Program["body"][number]): Declaration | undefined {
  if (statement.type === "ExportNamedDeclaration") return statement.declaration ?? undefined;
  if (statement.type === "VariableDeclaration") return statement;
  return undefined;
}

/** Every named core unit or extension declared as a top-level `const` with a string `label`.
 * A unit without a literal label, or wrapped in a function, is skipped (the diff cannot name
 * it). */
export function readUnits(src: string, file: string): readonly Blueprint.Unit[] {
  const program = parseSync(file, src).program;
  const access = readFunctionAccess(program);
  const units: Blueprint.Unit[] = [];
  for (const statement of program.body) {
    const declaration = declarationOf(statement);
    if (declaration?.type !== "VariableDeclaration" || declaration.kind !== "const") continue;
    for (const declarator of declaration.declarations) {
      const unit = unitOf(src, file, declarator, access);
      if (unit !== undefined) units.push(unit);
    }
  }
  return units;
}
