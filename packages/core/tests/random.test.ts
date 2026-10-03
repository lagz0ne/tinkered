import { makeTestRandom } from "@tinker/core/testing";
import { expect, test } from "vite-plus/test";
import { createScope, operation } from "../src/index.ts";

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const drawNext = operation({
  label: "drawNext",
  run: (_deps, { random }) => [random.next(), random.next(), random.next()],
});

const drawUuid = operation({
  label: "drawUuid",
  run: (_deps, { random }) => [random.uuid(), random.uuid(), random.uuid()],
});

test("two scopes with the same seed replay the same next() stream", () => {
  const first = createScope({ random: makeTestRandom({ seed: 42 }) }).run(drawNext);
  const second = createScope({ random: makeTestRandom({ seed: 42 }) }).run(drawNext);
  expect(second).toEqual(first);
});

test("two scopes with the same seed replay the same uuid() stream, each v4-shaped", () => {
  const first = createScope({ random: makeTestRandom({ seed: 42 }) }).run(drawUuid);
  const second = createScope({ random: makeTestRandom({ seed: 42 }) }).run(drawUuid);
  expect(second).toEqual(first);
  for (const id of first) expect(id).toMatch(V4);
});

test("different seeds produce different next() streams", () => {
  const one = createScope({ random: makeTestRandom({ seed: 1 }) }).run(drawNext);
  const two = createScope({ random: makeTestRandom({ seed: 2 }) }).run(drawNext);
  expect(two).not.toEqual(one);
});

test("uuid() yields a distinct id on each call", () => {
  const ids = createScope({ random: makeTestRandom({ seed: 99 }) }).run(drawUuid);
  expect(new Set(ids).size).toBe(ids.length);
});

test("makeTestRandom with no seed is a deterministic default generator", () => {
  const first = createScope({ random: makeTestRandom() }).run(drawNext);
  const second = createScope({ random: makeTestRandom() }).run(drawNext);
  expect(second).toEqual(first);
});

test("a scope with no random option reads the system source", () => {
  const [n] = createScope().run(drawNext);
  const [id] = createScope().run(drawUuid);
  const [id2] = createScope().run(drawUuid);
  expect(n >= 0 && n < 1).toBe(true);
  expect(id).toMatch(V4);
  expect(id).not.toBe(id2);
});

test("the system source uses the native randomUUID when the page has it", () => {
  const native = "00000000-0000-4000-8000-000000000000";
  Object.defineProperty(crypto, "randomUUID", { value: () => native, configurable: true });
  try {
    expect(createScope().run(drawUuid)).toEqual([native, native, native]);
  } finally {
    Reflect.deleteProperty(crypto, "randomUUID");
  }
});

test("the system source still makes v4 ids where randomUUID is missing (plain-http browser pages)", () => {
  Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
  try {
    const ids = createScope().run(drawUuid);
    for (const id of ids) expect(id).toMatch(V4);
    expect(new Set(ids).size).toBe(ids.length);
  } finally {
    Reflect.deleteProperty(crypto, "randomUUID");
  }
  expect(typeof crypto.randomUUID).toBe("function");
});

test("a child session inherits the parent scope's injected random", async () => {
  const scope = createScope({ random: makeTestRandom({ seed: 7 }) });
  const inChild = await scope.session((child) => child.run(drawNext));
  const standalone = createScope({ random: makeTestRandom({ seed: 7 }) }).run(drawNext);
  expect(inChild).toEqual(standalone);
  await scope.close();
});
