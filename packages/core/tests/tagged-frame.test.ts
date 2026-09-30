import { expect, test } from "vite-plus/test";
import {
  createScope,
  data,
  extension,
  namespace,
  operation,
  originOf,
  resource,
  tag,
} from "../src/index.ts";

const zone = tag({ label: "frame-zone", default: "root" });
const tags = [zone("call")];

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("the first defer keeps reverse order and the run's end", async () => {
  const events: string[] = [];
  const root = createScope();
  const op = operation({
    label: "op",
    depends: { zone },
    run: ({ zone }, { defer }) => {
      events.push(zone);
      defer((end) => {
        events.push(`first:${end.status}`);
      });
      defer((end) => {
        events.push(`last:${end.status}`);
      });
      return 7;
    },
  });
  expect(root.run(op, { tags })).toBe(7);
  expect(events).toEqual(["call", "last:success", "first:success"]);
  await root.close();
});

test("the first async defer keeps the tagged call pending", async () => {
  const gate = deferred();
  const events: string[] = [];
  const root = createScope();
  const op = operation({
    label: "op",
    run: (_deps, { defer }) => {
      defer(async () => {
        await gate.promise;
        events.push("cleaned");
      });
      return 7;
    },
  });
  const flight = root.run(op, { tags });
  expect(Promise.resolve(flight)).toBe(flight);
  gate.resolve();
  expect(await flight).toBe(7);
  expect(events).toEqual(["cleaned"]);
  await root.close();
});

test("the first signal read joins the parent's forced close", async () => {
  const root = createScope();
  const op = operation({
    label: "op",
    run: (_deps, ctx) =>
      new Promise<never>((_resolve, reject) => {
        const signal = ctx.signal;
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
  });
  const flight = root.settle(op, { tags });
  await root.close();
  expect((await flight).status).toBe("cancelled");
});

test("a parent close inside an untouched tagged body sees that body", async () => {
  const root = createScope();
  let closing: ReturnType<typeof root.close> | undefined;
  const op = operation({
    label: "op",
    run: () => {
      closing = root.close();
      return 7;
    },
  });
  expect((await root.settle(op, { tags })).status).toBe("cancelled");
  expect((await closing)?.status).toBe("cancelled");
});

for (const named of [false, true]) {
  test(`the first write stays in the tagged session: named=${named}`, async () => {
    const root = createScope();
    const cell = data({ initial: 1 });
    const ns = named ? namespace() : undefined;
    const op = operation({
      label: "op",
      depends: { cell: cell.controller, zone },
      run: ({ cell, zone }) => {
        const before = cell.get();
        cell.set(9);
        return [before, cell.get(), zone];
      },
    });
    expect(await root.run(op, { tags, ns })).toEqual([1, 9, "call"]);
    expect(root.controller(cell, ns ? { ns } : undefined).get()).toBe(1);
    await root.close();
  });

  test(`the first watcher sees a parent write before tagged close: named=${named}`, async () => {
    const root = createScope();
    const cell = data({ initial: 1 });
    const ns = named ? namespace() : undefined;
    const events: number[] = [];
    const op = operation({
      label: "op",
      depends: { cell: cell.controller },
      run: ({ cell }) => {
        cell.watch((value) => events.push(value));
      },
    });
    const flight = root.run(op, { tags, ns });
    root.controller(cell, ns ? { ns } : undefined).set(2);
    await flight;
    root.controller(cell, ns ? { ns } : undefined).set(3);
    expect(events).toEqual([2]);
    await root.close();
  });
}

test("the first resource build sees inherited namespaces and the call's tags", async () => {
  const events: string[] = [];
  const root = createScope({ ns: namespace({ tags: [zone("namespace")] }) });
  const cell = data({ initial: 0 });
  root.controller(cell).set(3);
  const value = resource({
    label: "value",
    target: "session",
    depends: { zones: zone.all, cell },
    factory: ({ zones, cell }, { defer }) => {
      defer((end) => {
        events.push(end.status);
      });
      return { zones, cell };
    },
  });
  const inner = operation({ label: "inner", depends: { value }, run: ({ value }) => value });
  const outer = operation({ label: "outer", depends: { inner }, run: ({ inner }) => inner.run() });
  expect(await root.run(outer, { tags })).toEqual({ zones: ["call", "namespace"], cell: 3 });
  expect(events).toEqual(["success"]);
  await root.close();
});

test("the first nested tagged build owns its resource and both tag levels", async () => {
  const events: string[] = [];
  const root = createScope();
  const value = resource({
    label: "value",
    target: "session",
    depends: { zones: zone.all },
    factory: ({ zones }, { defer }) => {
      defer((end) => {
        events.push(end.status);
      });
      return zones;
    },
  });
  const inner = operation({ label: "inner", depends: { value }, run: ({ value }) => value });
  const outer = operation({
    label: "outer",
    depends: { inner },
    run: ({ inner }) => inner.run({ tags: [zone("inner")] }),
  });
  expect(await root.run(outer, { tags })).toEqual(["inner", "call"]);
  expect(events).toEqual(["success"]);
  await root.close();
});

test("the first dropped subflow is joined by tagged close", async () => {
  const gate = deferred();
  const events: string[] = [];
  const root = createScope();
  const inner = operation({
    label: "inner",
    run: async () => {
      await gate.promise;
      events.push("finished");
    },
  });
  const outer = operation({
    label: "outer",
    depends: { inner },
    run: ({ inner }) => {
      void inner.run();
      return 7;
    },
  });
  const flight = root.run(outer, { tags });
  expect(Promise.resolve(flight)).toBe(flight);
  gate.resolve();
  expect(await flight).toBe(7);
  expect(events).toEqual(["finished"]);
  await root.close();
});

test("a first panic fails the tagged session and leaves the root open", async () => {
  const cause = new Error("first panic");
  const root = createScope();
  const op = operation({
    label: "panic",
    run: () => {
      throw cause;
    },
  });
  await expect(root.run(op, { tags })).rejects.toBe(cause);
  expect((await root.close({ graceful: true })).status).toBe("success");
});

test("the first nested panic keeps its caller in the error path", async () => {
  const cause = new Error("nested panic");
  const root = createScope();
  const inner = operation({
    label: "inner",
    run: () => {
      throw cause;
    },
  });
  const outer = operation({
    label: "outer",
    depends: { inner },
    run: ({ inner }) => inner.run({ tags: [zone("inner")] }),
  });
  await expect(root.run(outer, { tags })).rejects.toBe(cause);
  expect(originOf(cause)?.path).toEqual(["outer", "inner"]);
  await root.close();
});

test("session hooks read the first write after next and run hooks fire once", async () => {
  const cell = data({ initial: 1 });
  const events: string[] = [];
  const root = createScope({
    extensions: [
      extension({
        label: "observe-first-use",
        hooks: {
          run: (event) => {
            events.push("run");
            return event.next();
          },
          session: async (event) => {
            events.push(`before:${event.handle.resolve(zone)}`);
            const end = await event.next();
            events.push(`after:${event.handle.resolve(cell)}`);
            return end;
          },
        },
      }),
    ],
  });
  await root.ready;
  const op = operation({
    label: "op",
    depends: { cell: cell.controller },
    run: ({ cell }) => cell.set(9),
  });
  await root.run(op, { tags });
  expect(events).toEqual(["before:call", "run", "after:9"]);
  await root.close();
});
