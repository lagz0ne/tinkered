import { expect, test } from "vite-plus/test";
import { createScope, data, isError, operation, tag } from "../src/index";

const zone = tag({ label: "lifetime-zone", default: "root" });
const tags = [zone("call")];

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("catching a subflow panic still fails its tagged session", async () => {
  const cause = new Error("caught panic");
  const inner = operation({
    label: "panic",
    run: () => {
      throw cause;
    },
  });
  const outer = operation({
    label: "catcher",
    depends: { inner },
    run: ({ inner }) => {
      try {
        inner.run();
      } catch (error) {
        if (error !== cause) throw error;
      }
      return 7;
    },
  });
  const root = createScope();
  await expect(root.run(outer, { tags })).rejects.toBe(cause);
  await root.close();
});

test("a sync cleanup error fails an otherwise empty tagged call", async () => {
  const cause = new Error("cleanup failed");
  const op = operation({
    label: "cleanup",
    run: (_deps, { defer }) => {
      defer(() => {
        throw cause;
      });
      return 7;
    },
  });
  const root = createScope();
  try {
    await root.run(op, { tags });
    expect.unreachable();
  } catch (error) {
    if (!isError(error, "TeardownFailed")) throw error;
    expect(error.payload.causes).toEqual([cause]);
  }
  await root.close();
});

test("a data controller from an idle tagged call refuses a late write", async () => {
  const cell = data({ initial: 0 });
  const op = operation({
    label: "lend",
    depends: { cell: cell.controller },
    run: ({ cell }) => cell,
  });
  const root = createScope();
  const held = await root.run(op, { tags });
  try {
    held.set(1);
    expect.unreachable();
  } catch (error) {
    if (!isError(error, "Disposed")) throw error;
  }
  await root.close();
});

test("a nested tagged watcher sees a root write before the nested body returns", async () => {
  const cell = data({ initial: 0 });
  const seen: number[] = [];
  const root = createScope();
  const inner = operation({
    label: "watch",
    depends: { cell: cell.controller },
    run: ({ cell: controller }) => {
      controller.watch((value) => seen.push(value));
      root.controller(cell).set(1);
    },
  });
  const outer = operation({
    label: "outer",
    depends: { inner },
    run: ({ inner }) => inner.run({ tags }),
  });
  await root.run(outer, { tags });
  expect(seen).toEqual([1]);
  await root.close();
});

test("a later tagged sibling does not detach a live watcher", async () => {
  const cell = data({ initial: 0 });
  const gate = deferred();
  const seen: number[] = [];
  const root = createScope();
  const watch = operation({
    label: "watch",
    depends: { cell: cell.controller },
    run: ({ cell: controller }) => {
      controller.watch((value) => seen.push(value));
      return gate.promise;
    },
  });
  const touch = operation({ label: "touch", run: (_deps, ctx) => ctx.signal.aborted });
  const first = root.run(watch, { tags });
  const second = root.run(touch, { tags });
  root.controller(cell).set(1);
  gate.resolve();
  await Promise.all([first, second]);
  expect(seen).toEqual([1]);
  await root.close();
});

test("a tagged call started by its parent's abort sees cancelled cleanup", async () => {
  const root = createScope();
  const parent = root.createSession();
  const seen: string[] = [];
  let late: Promise<unknown> | undefined;
  const child = operation({
    label: "late",
    run: (_deps, { defer }) => {
      defer((end) => {
        seen.push(end.status);
      });
      return 7;
    },
  });
  const listen = operation({
    label: "listen",
    run: (_deps, { signal }) => {
      signal.addEventListener(
        "abort",
        () => {
          late = Promise.resolve(parent.settle(child, { tags }));
        },
        { once: true },
      );
    },
  });
  parent.run(listen);
  await root.close();
  await late;
  expect(seen).toEqual(["cancelled"]);
});

test("an ancestor collects a late tagged failure after that child has detached", async () => {
  const root = createScope();
  const blocker = root.createSession();
  const parent = root.createSession();
  const entered = deferred();
  const gate = deferred();
  blocker.onClose(() => {
    entered.resolve();
    return gate.promise;
  });
  const cause = new Error("late child failure");
  const child = operation({
    label: "late",
    run: () => {
      throw cause;
    },
  });
  const closing = root.close({ graceful: true });
  await entered.promise;
  await Promise.resolve(parent.run(child, { tags })).catch((error) => error);
  gate.resolve();
  expect(await closing).toMatchObject({ status: "failed", error: cause });
});

test("adopting a body's late then method keeps its tagged controller writable", async () => {
  const cell = data({ initial: 0 });
  const root = createScope();
  const op = operation({
    label: "adopt",
    depends: { cell: cell.controller },
    run: ({ cell: controller }) => {
      let reads = 0;
      return {
        get then(): unknown {
          reads++;
          if (reads === 1) return undefined;
          return (resolve: (value: number) => void) => {
            controller.set(7);
            resolve(controller.get());
          };
        },
      };
    },
  });
  await expect(Promise.resolve(root.run(op, { tags }))).resolves.toBe(7);
  await root.close();
});

test("a forced parent close reaches a body adopted after its run returned", async () => {
  const root = createScope();
  const gate = deferred();
  const op = operation({
    label: "adopt",
    run: () => {
      let reads = 0;
      return {
        get then(): unknown {
          reads++;
          if (reads === 1) return undefined;
          return (resolve: (value: number) => void) => gate.promise.then(() => resolve(7));
        },
      };
    },
  });
  const flight = root.settle(op, { tags });
  const closing = root.close();
  gate.resolve();
  expect((await flight).status).toBe("cancelled");
  await closing;
});

test("a tagged session adopts a callable made thenable by run cleanup", async () => {
  const root = createScope();
  const op = operation({
    label: "callable",
    run: (_deps, { defer }) => {
      const result: (() => number) & { then: unknown } = Object.assign(() => 0, {
        then: undefined,
      });
      defer(() => {
        result.then = (resolve: (value: number) => void) => resolve(7);
      });
      return result;
    },
  });
  expect(await root.run(op, { tags })).toBe(7);
  await root.close();
});
