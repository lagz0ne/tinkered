import { test } from "node:test";
import { strict as assert } from "node:assert";
import { unitCouldBeModuleLevel, units } from "./extract.mjs";

const core = 'import { operation, resource, data, tag, operation as op } from "@tinker/core";\n';

void test("a static core unit inside a function is reported at its call", () => {
  const src =
    core +
    'function shell(options) { const command = operation({ label: "check", depends: { io }, run: () => 1 }); return { command, options }; }';
  assert.deepEqual(
    unitCouldBeModuleLevel(src).map(({ line, functionName }) => [line, functionName]),
    [[2, "shell"]],
  );
});

void test("parameters and locals derived from them keep factory units dynamic", () => {
  const src =
    core +
    'function frame({ tools, open }) { const alias = tools; const next = alias; const a = op({ depends: { next } }); const b = resource({ factory: () => open() }); const c = tag({ label: "plain" }); return [a,b,c]; }';
  assert.deepEqual(
    unitCouldBeModuleLevel(src).map((hit) => hit.kind),
    ["tag"],
  );
});

void test("a loader that only updates an input counter still builds the same unit", () => {
  const src =
    core +
    "function route(loads) { const once = () => { loads.count += 1; return ping; }; return { entry: () => operation({ depends: { ping: once() } }) }; }";
  assert.deepEqual(
    unitCouldBeModuleLevel(src).map((hit) => hit.functionName),
    ["route"],
  );
});

void test("module names and callback parameters do not make a config depend on the factory", () => {
  const src =
    core +
    "const outside = 1; function make(ctx) { return data({ initial: outside, read: (ctx) => ctx.value }); }";
  assert.equal(unitCouldBeModuleLevel(src).length, 1);
});

void test("inline run configs and other modules are not core unit calls", () => {
  const src =
    core +
    'import { operation as foreign } from "elsewhere"; function make() { scope.run({ label: "inline", run: () => 1 }); foreign({ label: "other" }); }';
  assert.deepEqual(unitCouldBeModuleLevel(src), []);
});

void test("tests are excluded; functions that declare units remain judge candidates", () => {
  const src =
    core + "export function ask(frame) { return operation({ depends: { turn: frame.turn } }); }";
  assert.deepEqual(unitCouldBeModuleLevel(src, "a.test.ts"), []);
  assert.ok(units(src).some((u) => u.kind === "function" && u.name === "ask"));
});
