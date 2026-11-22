// Replays the bug 3 paths of the ScopeLife model (docs/states/scope-life), one step per
// model action. Each test asserts ADR 0165 decision 2: the first cause that ends the start
// wins; `ready` rejects with it, and `settled` names it.
import { makeTestClock } from "@tinkered/core/testing";
import { expect, test } from "vite-plus/test";

import { capsule, createScope } from "@/index";

const turns = async (n = 20): Promise<void> => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

/** Capsule `name`: its start waits on a gate (the "before next()" work), awaits next(), then
 * opens its port. Its close hook closes the port, and waits for `hold` when one is given. */
function listener(name: string, log: string[], open: Set<string>, hold?: Promise<void>) {
  let release!: () => void;
  let fail!: (error: unknown) => void;
  const gate = new Promise<void>((resolve, reject) => {
    release = resolve;
    fail = reject;
  });
  const unit = capsule({
    label: name,
    hooks: {
      async start({ next }) {
        log.push(`${name} starts`);
        await gate;
        await next();
        open.add(name);
        log.push(`${name} listens`);
      },
      async close({ next, options }) {
        open.delete(name);
        log.push(`${name} close hook (graceful: ${options.graceful === true})`);
        if (hold) await hold;
        return next();
      },
    },
  });
  return { unit, release, fail };
}

test("FirstCauseRejectsReady + SignalClosedCancelled path: a start error after the stop signal", async () => {
  const log: string[] = [];
  const open = new Set<string>();
  const stop = new AbortController();
  const c1 = listener("capsule 1", log, open);
  const c2 = listener("capsule 2", log, open);
  const sigint = new Error("SIGINT");
  const startBug = new Error("start bug");

  // 1. the scope starts
  const scope = createScope({ signal: stop.signal, capsules: [c1.unit, c2.unit] });
  const ready = scope.ready.then(
    () => "resolved",
    (error: unknown) => error,
  );
  await turns();
  // 2. the stop signal fires
  stop.abort(sigint);
  await turns();
  // 3. a start hook throws (capsule 1, before its next())
  c1.fail(startBug);
  // 4, 5. the close hooks run; 6. the scope closes
  const closed = await scope.closed;
  const readyGot = await ready;

  const settled = await scope.settled;

  expect(log).toContain("capsule 2 close hook (graceful: false)");
  expect(open.size).toBe(0);
  // ADR 0165 decision 2: the signal came first, so the later start error is dropped.
  expect({ ready: readyGot, closed: closed.status, settled }).toEqual({
    ready: sigint,
    closed: "cancelled",
    settled: { status: "cancelled", reason: sigint },
  });
});

test("SignalForcesClose path: the app calls close({ graceful }) after the stop signal", async () => {
  const log: string[] = [];
  const open = new Set<string>();
  const stop = new AbortController();
  const c1 = listener("capsule 1", log, open);
  const c2 = listener("capsule 2", log, open);
  const sigint = new Error("SIGINT");

  // 1. the scope starts
  const scope = createScope({ signal: stop.signal, capsules: [c1.unit, c2.unit] });
  const ready = scope.ready.then(
    () => "resolved",
    (error: unknown) => error,
  );
  await turns();
  // 2. the stop signal fires
  stop.abort(sigint);
  await turns();
  // 3. the app calls close({ graceful: true })
  const closing = scope.close({ graceful: true });
  // 4, 5. the close hooks run; 6. the scope closes
  const result = await closing;
  const closed = await scope.closed;
  const readyGot = await ready;
  const settled = await scope.settled;
  c1.release();
  await turns();

  expect(result).toBe(closed);
  expect(open.size).toBe(0);
  // ADR 0134 decision 2: the close is forced and the close hooks run. ADR 0165 decision 2:
  // the signal came first, so ready and settled name the signal, not the close.
  expect({
    hooks: log.filter((line) => line.includes("close hook")),
    ready: readyGot,
    closed: closed.status,
    settled,
  }).toEqual({
    hooks: ["capsule 2 close hook (graceful: false)", "capsule 1 close hook (graceful: false)"],
    ready: sigint,
    closed: "cancelled",
    settled: { status: "cancelled", reason: sigint },
  });
});

test("chart state 'failed, StartTimeout, after the stop signal': the start times out after the signal", async () => {
  const clock = makeTestClock();
  const log: string[] = [];
  const open = new Set<string>();
  const stop = new AbortController();
  const c1 = listener("capsule 1", log, open);
  const c2 = listener("capsule 2", log, open);
  const sigint = new Error("SIGINT");

  // 1. the scope starts
  const scope = createScope({
    clock,
    startTimeout: 50,
    signal: stop.signal,
    capsules: [c1.unit, c2.unit],
  });
  const ready = scope.ready.then(
    () => "resolved",
    (error: unknown) => error,
  );
  await turns();
  // 2. the stop signal fires (capsule 1 is still in its work before next())
  stop.abort(sigint);
  await turns();
  // 3. the start times out
  clock.advance(50);
  // 4, 5. the close hooks run; 6. the scope closes
  const closed = await scope.closed;
  const readyGot = await ready;
  const settled = await scope.settled;

  expect(open.size).toBe(0);
  // ADR 0165 decision 2: the signal came first, so the later timeout is dropped.
  expect({ ready: readyGot, closed: closed.status, settled }).toEqual({
    ready: sigint,
    closed: "cancelled",
    settled: { status: "cancelled", reason: sigint },
  });
});

test("FirstErrorWins path: a start error before the stop signal fails the start", async () => {
  const log: string[] = [];
  const open = new Set<string>();
  const stop = new AbortController();
  const c1 = listener("capsule 1", log, open);
  const c2 = listener("capsule 2", log, open);
  const sigint = new Error("SIGINT");
  const startBug = new Error("start bug");

  // 1. the scope starts
  const scope = createScope({ signal: stop.signal, capsules: [c1.unit, c2.unit] });
  const ready = scope.ready.then(
    () => "resolved",
    (error: unknown) => error,
  );
  await turns();
  // 2. a start hook throws (capsule 1, before its next())
  c1.fail(startBug);
  await turns();
  // 3. the stop signal fires
  stop.abort(sigint);
  // 4, 5. the close hooks run; 6. the scope closes
  const closed = await scope.closed;
  const readyGot = await ready;
  const settled = await scope.settled;

  expect(open.size).toBe(0);
  // ADR 0165 decision 2: the start error came first, so the later signal is dropped.
  expect({ ready: readyGot, closed: closed.status, settled }).toEqual({
    ready: startBug,
    closed: "failed",
    settled: { status: "failed", error: startBug },
  });
});

test("ClosedFollowsFirstCause path: a start error after close() leaves closed cancelled", async () => {
  const log: string[] = [];
  const open = new Set<string>();
  let releaseClose!: () => void;
  const held = new Promise<void>((resolve) => (releaseClose = resolve));
  const c1 = listener("capsule 1", log, open, held);
  const c2 = listener("capsule 2", log, open);
  const startBug = new Error("start bug");

  // 1. the scope starts
  const scope = createScope({
    signal: new AbortController().signal,
    capsules: [c1.unit, c2.unit],
  });
  const ready = scope.ready.then(
    () => "resolved",
    (error: unknown) => error,
  );
  await turns();
  // 2. the app calls close()
  const closing = scope.close();
  // 3, 4. the close hooks run (capsule 1's waits)
  await turns();
  // 5. a start hook throws (capsule 1, before its next())
  c1.fail(startBug);
  await turns();
  // 6. the scope closes
  releaseClose();
  const closed = await closing;
  const readyGot = await ready;
  const settled = await scope.settled;

  expect(open.size).toBe(0);
  // ADR 0165 decision 2, amended: the close came first, so the later start error is dropped.
  expect({ closed, settled }).toEqual({
    closed: { status: "cancelled", reason: readyGot },
    settled: { status: "cancelled", reason: readyGot },
  });
});

test("control: the stop signal alone during start follows ADR 0134 decision 2", async () => {
  const log: string[] = [];
  const open = new Set<string>();
  const stop = new AbortController();
  const c1 = listener("capsule 1", log, open);
  const c2 = listener("capsule 2", log, open);
  const sigint = new Error("SIGINT");

  const scope = createScope({ signal: stop.signal, capsules: [c1.unit, c2.unit] });
  const ready = scope.ready.then(
    () => "resolved",
    (error: unknown) => error,
  );
  await turns();
  stop.abort(sigint);
  await turns();
  c1.release();
  const closed = await scope.closed;

  expect(await ready).toBe(sigint);
  expect(closed.status).toBe("cancelled");
  expect(log).toEqual([
    "capsule 1 starts",
    "capsule 2 close hook (graceful: false)",
    "capsule 1 close hook (graceful: false)",
  ]);
  expect(open.size).toBe(0);
});
