import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { expect, test } from "vite-plus/test";
import { createScope, data, extension } from "../src/index";

setFlagsFromString("--expose-gc");
const gc = runInNewContext("gc") as () => void;

const initial: number[] = [];
const cell = data({ label: "retained", initial });

/** Write a large value through a controller, and keep only a weak reference to it. */
function writeLarge(controller: { set(value: number[]): void }): WeakRef<number[]> {
  const value = Array.from({ length: 200_000 }, () => 1);
  controller.set(value);
  return new WeakRef(value);
}

/** Force collection a few times. Each yield ends the job, so pending weak targets are released. */
async function collect(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    gc();
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Documented retention (core/held-controller-pins-value): a held controller pins its last write
 * after close, on every close path. The write sits in the node's `cell`, and in its `prev` when a
 * watcher was added. Freeing it on fast close needs a walk over the nodes, which costs the
 * lifecycle row. The closed read still returns the initial value. */
test("a closed root keeps the last write of a controller that is still held", async () => {
  const root = createScope();
  const held = root.controller(cell);

  const written = writeLarge(held);
  await root.close();
  await collect();

  expect(written.deref() !== undefined).toBe(true);
  expect(held.get()).toBe(initial);
});

test("a root closed fast with a watcher keeps the last write of a controller that is still held", async () => {
  const root = createScope();
  const held = root.controller(cell);
  held.watch(() => undefined);

  const written = writeLarge(held);
  await root.close();
  await collect();

  expect(written.deref() !== undefined).toBe(true);
  expect(held.get()).toBe(initial);
});

/** Slow close: an `onClose` hook makes the root take `startClose` and `finishLayer`, not `fastClose`. */
test("a root closed slowly with an onClose hook keeps the last write of a controller that is still held", async () => {
  const root = createScope();
  const held = root.controller(cell);
  root.onClose(() => undefined);

  const written = writeLarge(held);
  await root.close();
  await collect();

  expect(written.deref() !== undefined).toBe(true);
  expect(held.get()).toBe(initial);
});

/** Swept session: the parent's `onClose` makes the parent close slowly and sweep the child. An idle
 * child would still fast-close, so the child keeps an `onClose` hook too: it takes `finishLayer`. */
test("a session swept by a root closed slowly keeps the last write of a controller that is still held", async () => {
  const root = createScope();
  const session = root.createSession();
  const held = session.controller(cell);
  session.onClose(() => undefined);
  root.onClose(() => undefined);

  const written = writeLarge(held);
  await root.close();
  await collect();

  expect(written.deref() !== undefined).toBe(true);
  expect(held.get()).toBe(initial);
});

test("a fast-closed session keeps the last write of a controller that is still held", async () => {
  const root = createScope();
  const session = root.createSession();
  const held = session.controller(cell);

  const written = writeLarge(held);
  await session.close();
  await collect();

  expect(written.deref() !== undefined).toBe(true);
  expect(held.get()).toBe(initial);
  await root.close();
});

test("a session closed under a session hook keeps the last write of a controller that is still held", async () => {
  const reader = extension({
    label: "reader",
    hooks: {
      session: async (event) => event.next(),
    },
  });

  const root = createScope({ extensions: [reader] });
  const session = root.createSession();
  const held = session.controller(cell);

  const written = writeLarge(held);
  await session.close();
  await collect();

  expect(written.deref() !== undefined).toBe(true);
  expect(held.get()).toBe(initial);
  await root.close();
});

test("with no held controller, a closed root frees its last write", async () => {
  const root = createScope();
  const written = writeLarge(root.controller(cell));
  await root.close();
  await collect();
  expect(written.deref() === undefined).toBe(true);
});
