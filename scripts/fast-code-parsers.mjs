import { createRequire } from "node:module";
import { slots } from "./check-slots.mjs";

const jev = createRequire(new URL("../tools/jev/package.json", import.meta.url));
const { parseSync } = await import(jev.resolve("oxc-parser"));
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export const hotFunctions = [
  "runOnce",
  "settleRun",
  "OperationCtx",
  "buildHooklessResource",
  "resolveDep",
  "runHookChain",
  "invokeRunHooks",
  "stepRunHook",
];

export function parseProgram(file, code) {
  const { program, errors } = parseSync(file, code, { sourceType: "module" });
  if (errors.length) throw new Error(`${file}: ${errors[0].message}`);
  return program;
}

export function highestSlot(code) {
  return slots(parseProgram("bundle.mjs", code)).at(-1)?.slot ?? 2;
}

function children(node) {
  return Object.values(node)
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter((value) => value && typeof value === "object" && "type" in value);
}

function definition(program, name) {
  const found = program.body
    .map((node) => node.declaration ?? node)
    .find((node) => node.id?.name === name);
  if (!found) throw new Error(`Missing hot function ${name}`);
  if (found.type !== "ClassDeclaration") return found;
  const ctor = found.body.body.find((member) => member.kind === "constructor");
  if (!ctor) throw new Error(`Missing constructor ${name}`);
  return ctor.value;
}

function literalCount(node) {
  if (["ArrowFunctionExpression", "FunctionExpression", "FunctionDeclaration"].includes(node.type))
    return 1;
  return children(node).reduce((total, child) => total + literalCount(child), 0);
}

export function closures(code, names = hotFunctions) {
  const program = parseProgram("source.ts", code);
  return Object.fromEntries(
    names.map((name) => {
      const fn = definition(program, name);
      const count = [...fn.params, fn.body].reduce((total, node) => total + literalCount(node), 0);
      const klass = program.body.find(
        (node) => node.type === "ClassDeclaration" && node.id.name === name,
      );
      const fields =
        klass?.body.body.filter(
          (member) => member.type === "PropertyDefinition" && !member.static,
        ) ?? [];
      return [name, count + fields.reduce((total, field) => total + literalCount(field), 0)];
    }),
  );
}

function decode(segment) {
  const out = [];
  let value = 0;
  let shift = 0;
  for (const ch of segment) {
    const digit = alphabet.indexOf(ch);
    if (digit < 0) throw new Error("Invalid source map digit");
    value += (digit & 31) * 2 ** shift;
    shift += 5;
    if (digit & 32) continue;
    out.push(value & 1 ? -Math.floor(value / 2) : value / 2);
    value = 0;
    shift = 0;
  }
  if (shift) throw new Error("Incomplete source map segment");
  return out;
}

export function mappings(map) {
  const positions = [];
  let source = 0;
  let line = 0;
  let column = 0;
  for (const [generatedLine, row] of map.mappings.split(";").entries()) {
    let generatedColumn = 0;
    for (const segment of row.split(",").filter(Boolean)) {
      const fields = decode(segment);
      generatedColumn += fields[0];
      if (fields.length < 4) continue;
      source += fields[1];
      line += fields[2];
      column += fields[3];
      if (!map.sources[source]) throw new Error("Source map source is missing");
      positions.push({ generatedLine, generatedColumn, source, line, column });
    }
  }
  return positions;
}

function offsets(text) {
  const out = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") out.push(i + 1);
  return out;
}

/** Follow declaration positions, so minifier names are never kept in the baseline. */
export function builtNames(code, map, names = hotFunctions) {
  const program = parseProgram("bundle.mjs", code);
  const declarations = program.body.flatMap((node) =>
    node.type === "VariableDeclaration" ? node.declarations : [node],
  );
  const generatedLines = offsets(code);
  const originalLines = map.sourcesContent.map(offsets);
  const positions = mappings(map).map((pos) => ({
    ...pos,
    generated: generatedLines[pos.generatedLine] + pos.generatedColumn,
    original: originalLines[pos.source][pos.line] + pos.column,
  }));
  const source = map.sources.findIndex((file) => /(?:^|\/)src\/index\.ts$/.test(file));
  if (source < 0) throw new Error("Core source is missing from the source map");
  const originals = parseProgram("source.ts", map.sourcesContent[source]);
  return Object.fromEntries(
    names.map((name) => {
      const original = originals.body.find((node) => node.id?.name === name);
      if (!original) throw new Error(`Missing source declaration ${name}`);
      const built = declarations.find((node) => {
        const kind = node.init?.type ?? node.type;
        if (!["FunctionDeclaration", "ClassDeclaration", "ClassExpression"].includes(kind))
          return false;
        const pos = positions.findLast((pos) => pos.generated <= node.id.start);
        return (
          pos?.source === source && pos.original >= original.start && pos.original < original.end
        );
      });
      if (!built) throw new Error(`No built declaration maps to ${name}`);
      return [name, built.id.name];
    }),
  );
}

export function bytecodeLength(trace, name) {
  const rows = [
    ...trace.matchAll(
      /generated bytecode for function: ([\w$]*) \([^\n]*\nBytecode length: (\d+)/g,
    ),
  ];
  const lengths = new Set(rows.filter((row) => row[1] === name).map((row) => Number(row[2])));
  if (lengths.size !== 1) throw new Error(`Missing or ambiguous bytecode for ${name}`);
  return [...lengths][0];
}

export function inlinedInto(trace, callee, caller) {
  return trace.split("\n").some((line) => {
    const match =
      /Inlining .*<SharedFunctionInfo ([\w$]+)>.*? into .*<SharedFunctionInfo ([\w$]+)>/.exec(line);
    return match?.[1] === callee && match[2] === caller;
  });
}

/** Inspect mapped sources, not strings which minification can erase. */
export function clientLibraries(map) {
  const used = new Set(mappings(map).map((pos) => pos.source));
  const paths = [...used].map((index) => map.sources[index].replaceAll("\\", "/"));
  return ["zod", "drizzle", "pglite"].filter((library) => {
    const pattern = {
      zod: /(?:^|\/)zod(?:@[^/]+)?\//,
      drizzle: /(?:^|\/)drizzle-(?:orm|kit)(?:@[^/]+)?\//,
      pglite: /(?:^|\/)(?:@electric-sql\/pglite|@electric-sql\+pglite)(?:@[^/]+)?\//,
    }[library];
    return paths.some((path) => pattern.test(path));
  });
}

export function ratchet(label, actual, limit) {
  if (!Number.isInteger(limit) || actual > limit)
    throw new Error(
      `${label}: ${actual} > baseline ${limit}; lower the value or review a baseline edit`,
    );
}

/** Keep existing over-limit roots, but never raise their saved ceiling. */
export function rebaselineEngine(baseline, engine, bytecode, inlining) {
  if (!inlining || baseline.inlining.OperationCtxIntoRunOnce !== true)
    throw new Error("F1/F2 OperationCtx must remain inlined into runOnce with default Maglev");
  for (const name of hotFunctions) {
    const next = bytecode[name];
    const previous = baseline.bytecode[name];
    if (!Number.isInteger(next) || !Number.isInteger(previous))
      throw new Error(`F1 missing bytecode for ${name}`);
    if (next > 460 && next > previous)
      throw new Error(`F1 ${name}: ${previous} → ${next}; cannot raise bytecode above 460`);
  }
  return { ...baseline, node: engine.node, v8: engine.v8, bytecode };
}
