import { expect, test } from "vite-plus/test";
import { createScope, data, extension, operation } from "../src/index";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("a call signal stops a run hook before it can start the body", async () => {
  const stop = new AbortController();
  const gate = deferred();
  const reason = new Error("steer");
  const events: string[] = [];
  const scope = createScope({
    extensions: [
      extension({
        label: "gate",
        hooks: {
          run: async (event) => {
            await gate.promise;
            return event.next();
          },
        },
      }),
    ],
  });
  const work = operation({ label: "work", run: () => events.push("body") });
  const running = scope.settle(work, { signal: stop.signal });
  stop.abort(reason);
  gate.resolve();
  expect(await running).toEqual({ status: "cancelled", reason });
  expect(events).toEqual([]);
  expect(await scope.close({ graceful: true })).toMatchObject({ status: "success" });
});

test("a call signal stops a session hook before it can start the body", async () => {
  const stop = new AbortController();
  const gate = deferred();
  const reason = new Error("steer");
  const events: string[] = [];
  const scope = createScope({
    extensions: [
      extension({
        label: "gate",
        hooks: {
          session: async (event) => {
            await gate.promise;
            return event.next();
          },
        },
      }),
    ],
  });
  const work = operation({ label: "work", run: () => events.push("body") });
  const running = scope.settle(work, { signal: stop.signal });
  stop.abort(reason);
  gate.resolve();
  expect(await running).toEqual({ status: "cancelled", reason });
  expect(events).toEqual([]);
  expect(await scope.close({ graceful: true })).toMatchObject({ status: "success" });
});

test("a signalled run keeps hook access alive through graceful close", async () => {
  const stop = new AbortController();
  const gate = deferred();
  const value = data({ initial: "ready" });
  const scope = createScope({
    extensions: [
      extension({
        label: "gate",
        hooks: {
          run: async (event) => {
            await gate.promise;
            expect(event.resolve(value)).toBe("ready");
            return event.next();
          },
        },
      }),
    ],
  });
  const running = scope.settle({ run: () => "done" }, { signal: stop.signal });
  const closing = scope.close({ graceful: true });
  gate.resolve();
  expect(await running).toEqual({ status: "success", value: "done" });
  expect(await closing).toMatchObject({ status: "success" });
});

test("a write hook shares the call signal with its active body", async () => {
  const stop = new AbortController();
  const reason = new Error("stop in write hook");
  const count = data({ initial: 0 });
  const scope = createScope({
    extensions: [
      extension({
        label: "stop-write",
        hooks: {
          write: (event) => {
            stop.abort(reason);
            event.signal.throwIfAborted();
            event.next();
          },
        },
      }),
    ],
  });
  const result = await scope.settle(
    {
      depends: { count: count.controller },
      run: ({ count }) => count.set(1),
    },
    { signal: stop.signal },
  );
  expect(result).toEqual({ status: "cancelled", reason });
  expect(scope.resolve(count)).toBe(0);
  expect(await scope.close({ graceful: true })).toMatchObject({ status: "success" });
});
