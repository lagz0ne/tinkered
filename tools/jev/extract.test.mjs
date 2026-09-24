import { test } from "node:test";
import { strict as assert } from "node:assert";
import { unitCouldBeModuleLevel, routesDeclaredOperation, units } from "./extract.mjs";

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
  assert.ok(units(src).some((u) => u.kind === "function" && u.name === "ask" && u.wrapperOnly));
  assert.ok(
    units(core + "function plain() { return 1; }").some(
      (u) => u.name === "plain" && !u.wrapperOnly,
    ),
  );
});

void test("inner locals derived from outer parameters stay dynamic", () => {
  const src =
    core +
    "function outer(x) { return () => { const y = x; return operation({ depends: { y } }); }; }";
  assert.deepEqual(unitCouldBeModuleLevel(src), []);
});

void test("a for-of or for-in binding derived from input stays dynamic", () => {
  for (const loop of ["of", "in"]) {
    const src =
      core +
      `function f(items) { for (const item ${loop} items) operation({ label: item.name }); }`;
    assert.deepEqual(unitCouldBeModuleLevel(src), []);
  }
});

void test("a nested function that closes over an input keeps its operation dynamic", () => {
  const src = core + "function f(x) { function h() { return x; } return operation({ run: h }); }";
  assert.deepEqual(unitCouldBeModuleLevel(src), []);
});

void test("a reassigned local derived from an input stays dynamic", () => {
  const src = core + "function f(x) { let y; y = x; return operation({ depends: { y } }); }";
  assert.deepEqual(unitCouldBeModuleLevel(src), []);
});

void test("a catch parameter used by a unit config stays dynamic", () => {
  const src = core + "function f() { try {} catch (e) { operation({ label: e.message }); } }";
  assert.deepEqual(unitCouldBeModuleLevel(src), []);
});

void test("dotted and dashed test filenames and test directories are excluded", () => {
  const src = core + "function f() { operation({ label: 'x' }); }";
  for (const file of ["a.b.test.ts", "foo-bar.spec.tsx", "pkg/tests/a.ts", "pkg/test/a.ts"])
    assert.deepEqual(unitCouldBeModuleLevel(src, file), []);
});

void test("inline routing of a declared op is not a new declared step", () => {
  assert.equal(
    routesDeclaredOperation("session.run({ depends: { op }, run: ({ op }) => op.run() })"),
    true,
  );
  assert.equal(
    routesDeclaredOperation("operation({ depends: { op }, run: ({ op }) => op.run() })"),
    false,
  );
  assert.equal(routesDeclaredOperation("session.run({ label, run: () => write() })"), false);
});

void test("this is not a module-level value", () => {
  const src = core + "class A { make() { return operation({ run: () => this.value }); } }";
  assert.deepEqual(unitCouldBeModuleLevel(src), []);
});
