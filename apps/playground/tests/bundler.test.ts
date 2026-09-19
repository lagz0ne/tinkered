import { expect, test } from "vite-plus/test";
import { createScope, makeTestClock, preset, type Scope } from "@tinker/core";
import { addFile, editFile } from "@/actions.ts";
import { compiler } from "@/compiler.ts";
import { bundler } from "@/services.ts";
import { bundleCell, debounce, statusCell } from "@/state.ts";
import { fakeCompiler } from "./fixtures.ts";

/** A scope whose compiler is the fake and whose debounce is zero: an edit compiles on the next tick. */
function readScope(gate?: () => Promise<void>) {
  const seen: string[] = [];
  const clock = makeTestClock({ now: 1000 });
  const scope = createScope({
    clock,
    tags: [debounce(0)],
    presets: [preset(compiler, async () => fakeCompiler(seen, gate))],
  });
  const writes: (string | undefined)[] = [];
  scope.controller(bundleCell).watch((next) => writes.push(next));
  return { scope, seen, clock, writes, status: scope.controller(statusCell) };
}

/** The first value of `cell` (the current one included) that passes `ok`. */
function until<T>(cell: Scope.DataController<T>, ok: (value: T) => boolean): Promise<T> {
  return new Promise((resolve) => {
    if (ok(cell.get())) return resolve(cell.get());
    const stop = cell.watch((next) => {
      if (!ok(next)) return;
      stop();
      resolve(next);
    });
  });
}

const edit = (scope: Scope.Handle, content: string) =>
  scope.run(editFile, { input: { name: "main.tsx", content } });

test("compiles the open files once on build and records the compile time", async () => {
  const { scope, clock, writes, status } = readScope(async () => clock.advance(7));
  scope.resolve(bundler);
  expect(status.get()).toEqual({ kind: "info", text: "compiling…" });
  const ready = await until(status, (s) => s.text === "running…");
  expect(ready).toEqual({ kind: "info", text: "running…", ms: 7 });
  expect(writes.length).toBe(1);
  expect(writes[0]).toContain('import { App } from "./App";');
});

test("recompiles after a file change", async () => {
  const { scope, writes } = readScope();
  scope.resolve(bundler);
  const bundle = scope.controller(bundleCell);
  const first = await until(bundle, (b) => b !== undefined);
  edit(scope, 'import { App } from "./App";\nconsole.log("edited");');
  const code = await until(bundle, (b) => b !== first);
  expect(code).toContain('console.log("edited");');
  expect(writes).toEqual([first, code]);
});

test("drops a stale result: an edit queued during a compile wins over that compile's output", async () => {
  const holds: (() => void)[] = [];
  const { scope, seen, writes } = readScope(() => new Promise((release) => holds.push(release)));
  scope.resolve(bundler);
  await expect.poll(() => seen.length).toBe(1);
  edit(scope, 'console.log("second");');
  await expect.poll(() => seen.length).toBe(2);
  for (const release of holds) release();
  const code = await until(scope.controller(bundleCell), (b) => b !== undefined);
  expect(code).toBe('console.log("second");');
  expect(writes).toEqual([code]);
});

test("an edit that leaves the bundle unchanged is ready at once, nothing rewritten", async () => {
  const { scope, writes, status } = readScope();
  scope.resolve(bundler);
  await until(status, (s) => s.text === "running…");
  scope.run(addFile);
  const ready = await until(status, (s) => s.text === "ready");
  expect(ready).toEqual({ kind: "ok", text: "ready", ms: 0 });
  expect(writes.length).toBe(1);
});

test("a compile failure lands in status and keeps the last bundle", async () => {
  const { scope, writes, status } = readScope();
  scope.resolve(bundler);
  await until(status, (s) => s.text === "running…");
  edit(scope, 'import "./missing";');
  const failed = await until(status, (s) => s.kind === "error");
  expect(failed).toEqual({
    kind: "error",
    text: '[plugin: virtual-fs] Cannot find file "./missing"',
  });
  expect(writes.length).toBe(1);
});

test("releasing the bundler stops it: an edit armed before the release never compiles", async () => {
  const holds: (() => void)[] = [];
  const { scope, seen } = readScope(() => new Promise((release) => holds.push(release)));
  scope.resolve(bundler);
  await expect.poll(() => seen.length).toBe(1);
  edit(scope, 'console.log("armed");');
  scope.release(bundler);
  scope.resolve(bundler);
  await expect.poll(() => seen.length).toBe(2);
  edit(scope, 'console.log("after");');
  await expect.poll(() => seen.length).toBe(3);
  expect(seen.slice(1)).toEqual(['console.log("armed");', 'console.log("after");']);
  for (const release of holds) release();
});
