import { expect, test } from "vite-plus/test";
import { createScope, data, namespace } from "../src/index.ts";

test("a child named watcher sees a parent's named write", async () => {
  const a = namespace();
  const cell = data({ label: "child-watch", initial: 0 });
  const root = createScope();
  await root.ready;
  const child = root.createSession();
  const seen: number[] = [];
  child.controller(cell, { ns: a }).watch((next) => seen.push(next));

  root.controller(cell, { ns: a }).set(5);

  expect(seen).toEqual([5]);
  await root.close({ graceful: true });
});

test("a grandchild named watcher sees a root named write", async () => {
  const a = namespace();
  const cell = data({ label: "grandchild-watch", initial: 0 });
  const root = createScope();
  await root.ready;
  const grandchild = root.createSession().createSession();
  const seen: number[] = [];
  grandchild.controller(cell, { ns: a }).watch((next) => seen.push(next));

  root.controller(cell, { ns: a }).set(5);

  expect(seen).toEqual([5]);
  await root.close({ graceful: true });
});

test("a child's own named entry shields its watcher from a parent's write", async () => {
  const a = namespace();
  const cell = data({ label: "shadow-watch", initial: 0 });
  const root = createScope();
  await root.ready;
  const child = root.createSession();
  child.controller(cell, { ns: a }).set(2);
  const seen: number[] = [];
  child.controller(cell, { ns: a }).watch((next) => seen.push(next));

  root.controller(cell, { ns: a }).set(5);

  expect(seen).toEqual([]);
  await root.close({ graceful: true });
});

test("a child's named entry skips comparisons in its subtree on a parent write", async () => {
  const a = namespace();
  let comparisons = 0;
  const cell = data({
    label: "shadowed-subtree-watch",
    initial: 0,
    eq: (left, right) => {
      comparisons++;
      return left === right;
    },
  });
  const root = createScope();
  await root.ready;
  const child = root.createSession();
  child.controller(cell, { ns: a }).set(2);
  const grandchild = child.createSession();
  for (let i = 0; i < 5; i++) grandchild.controller(cell, { ns: a }).watch(() => undefined);
  comparisons = 0;

  root.controller(cell, { ns: a }).set(5);

  expect(comparisons).toBe(1);
  await root.close({ graceful: true });
});

test("a child's fallback chain sees its parent's write until the child shadows it", async () => {
  const a = namespace();
  const b = namespace();
  const cell = data({ label: "chain-shadow-watch", initial: 0 });
  const root = createScope();
  await root.ready;
  const child = root.createSession();
  const seen: number[] = [];
  child.controller(cell, { ns: [b, a] }).watch((next) => seen.push(next));

  root.controller(cell, { ns: a }).set(5);
  child.controller(cell, { ns: b }).set(3);
  root.controller(cell, { ns: a }).set(6);

  expect(seen).toEqual([5, 3]);
  await root.close({ graceful: true });
});

test("releasing a parent's named entry notifies a child watcher of its fallback", async () => {
  const a = namespace();
  const cell = data({ label: "released-child-watch", initial: 0 });
  const root = createScope();
  await root.ready;
  root.controller(cell, { ns: a }).set(5);
  const child = root.createSession();
  const seen: number[] = [];
  child.controller(cell, { ns: a }).watch((next) => seen.push(next));

  root.releaseNs(cell, a);

  expect(seen).toEqual([0]);
  await root.close({ graceful: true });
});
