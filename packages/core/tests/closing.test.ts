import { expect, test } from "vite-plus/test";
import {
  createScope,
  data,
  extension,
  operation,
  resource,
  type Resource,
  type Scope,
} from "../src/index";

function waiting(ctx: Resource.Ctx) {
  let finish = (): void => undefined;
  const wait = new Promise<void>((resolve) => {
    finish = resolve;
  });
  ctx.closing.addEventListener("abort", () => finish(), { once: true });
  return { wait, finish };
}

const rootWait = resource({
  label: "root-wait",
  factory: (_deps, ctx) => waiting(ctx),
});
const sessionWait = resource({
  label: "session-wait",
  target: "session",
  factory: (_deps, ctx) => waiting(ctx),
});
const waitAtRoot = operation({
  label: "wait-at-root",
  depends: { owned: rootWait },
  run: ({ owned }) => owned.wait,
});
const waitAtSession = operation({
  label: "wait-at-session",
  depends: { owned: sessionWait },
  run: ({ owned }) => owned.wait,
});

const sessionClosing = resource({
  label: "session-closing",
  target: "session",
  factory: (_deps, ctx) => ctx.closing,
});

test("an idle session close aborts its resource and session hook closing signals", async () => {
  let hookClosing: AbortSignal | undefined;
  const piece = extension({
    label: "idle-session",
    hooks: {
      session: (event) => {
        hookClosing = event.closing;
        return event.next();
      },
    },
  });
  const scope = createScope({ extensions: [piece] });
  await scope.ready;
  const session = scope.createSession();
  const closing = session.resolve(sessionClosing);
  expect(closing.aborted).toBe(false);
  expect(hookClosing?.aborted).toBe(false);
  await session.close({ graceful: true });
  expect(closing.aborted).toBe(true);
  expect(hookClosing?.aborted).toBe(true);
  await scope.close();
});

test("a close hook's first closing read is already aborted", async () => {
  let aborted: boolean | undefined;
  const piece = extension({
    label: "first-read-in-close",
    hooks: {
      close: (event) => {
        aborted = event.closing.aborted;
        return event.next();
      },
    },
  });
  const scope = createScope({ extensions: [piece] });
  await scope.ready;
  const ended = scope.close({ graceful: true });
  expect(aborted).toBe(true);
  await ended;
});

test("closed settles when a session cleanup makes the first root close", async () => {
  const calls: string[] = [];
  const piece = extension({
    label: "reentrant-first-close",
    hooks: {
      close: (event) => {
        calls.push("close hook");
        return event.next();
      },
    },
  });
  const root = createScope({ signal: new AbortController().signal, extensions: [piece] });
  await root.ready;
  const session = root.createSession();
  session.onClose(() => root.close({ graceful: true }).then(() => undefined));
  await session.close();
  let result: Scope.Result | undefined;
  const closed = root.closed.then((ended) => {
    result = ended;
    return ended;
  });
  await expect.poll(() => result?.status).toBe("success");
  expect((await closed).status).toBe("success");
  expect(calls).toEqual([]);
});

test("a root without a stop signal closes from a session cleanup", async () => {
  const piece = extension({ label: "reentrant-without-stop" });
  const root = createScope({ extensions: [piece] });
  await root.ready;
  const session = root.createSession();
  session.onClose(() => root.close({ graceful: true }).then(() => undefined));
  await session.close();
  expect((await root.close({ graceful: true })).status).toBe("success");
});

test("a graceful root close ends a resource-owned wait before draining work", async () => {
  const scope = createScope();
  const owned = scope.resolve(rootWait);
  const running = scope.run(waitAtRoot);
  let ended = false;
  const closing = scope.close({ graceful: true }).then((result) => {
    ended = true;
    return result;
  });
  try {
    await expect.poll(() => ended).toBe(true);
    expect((await closing).status).toBe("success");
  } finally {
    owned.finish();
    await running;
    await closing;
  }
});

test("a graceful session close ends a resource-owned wait before draining work", async () => {
  const scope = createScope();
  const session = scope.createSession();
  const owned = session.resolve(sessionWait);
  const running = session.run(waitAtSession);
  let ended = false;
  const closing = session.close({ graceful: true }).then((result) => {
    ended = true;
    return result;
  });
  try {
    await expect.poll(() => ended).toBe(true);
    expect((await closing).status).toBe("success");
  } finally {
    owned.finish();
    await running;
    await closing;
    await scope.close();
  }
});

function gate() {
  let release = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

const layerSignals = resource({
  label: "layer-signals",
  target: "session",
  factory: (_deps, ctx) => {
    const owned = { closing: ctx.closing, signal: ctx.signal, ctx, cleaned: false, work: gate() };
    ctx.defer(() => {
      owned.cleaned = true;
    });
    return owned;
  },
});

const finishingWork = operation({
  label: "finishing-work",
  depends: { owned: layerSignals },
  run: async ({ owned }) => {
    await owned.work.promise;
    return owned.signal.aborted;
  },
});

test("graceful closing fires now while work and resource cleanup still wait", async () => {
  const scope = createScope();
  const session = scope.createSession();
  const owned = session.resolve(layerSignals);
  const running = session.run(finishingWork);
  const closing = session.close({ graceful: true });
  expect(owned.closing.aborted).toBe(true);
  expect(owned.signal.aborted).toBe(false);
  expect(owned.cleaned).toBe(false);
  owned.work.release();
  expect(await running).toBe(false);
  expect((await closing).status).toBe("success");
  expect(owned.cleaned).toBe(true);
  await scope.close();
});

test("a parent's closing fires in its child before a close hook waits", async () => {
  const before = gate();
  const resume = gate();
  let rootClosing: AbortSignal | undefined;
  const piece = extension({
    label: "hold-close",
    hooks: {
      start: (event) => {
        rootClosing = event.closing;
        return event.next();
      },
      close: async (event) => {
        expect(event.scope).toBe(scope);
        expect(event.closing).toBe(rootClosing);
        expect(event.closing.aborted).toBe(true);
        before.release();
        await resume.promise;
        return event.next();
      },
    },
  });
  const scope = createScope({ extensions: [piece] });
  await scope.ready;
  const child = scope.createSession();
  const owned = child.resolve(layerSignals);
  const closing = scope.close({ graceful: true });
  await before.promise;
  expect(owned.closing.aborted).toBe(true);
  expect(owned.signal.aborted).toBe(false);
  expect(owned.ctx.closing).toBe(owned.closing);
  resume.release();
  expect((await closing).status).toBe("success");
});

test("the first closing read after a parent starts closing is already aborted", async () => {
  const resume = gate();
  let childEvent: Scope.ExtensionEvents["session"] | undefined;
  const piece = extension({
    label: "late-closing-read",
    hooks: {
      session: (event) => {
        childEvent = event;
        return event.next();
      },
      close: async (event) => {
        expect(childEvent?.closing.aborted).toBe(true);
        await resume.promise;
        return event.next();
      },
    },
  });
  const scope = createScope({ extensions: [piece] });
  await scope.ready;
  scope.createSession();
  const closing = scope.close({ graceful: true });
  resume.release();
  expect((await closing).teardownErrors).toBeUndefined();
});

test("closing one session leaves its parent and sibling closing signals live", async () => {
  const scope = createScope();
  const parent = scope.resolve(rootWait);
  const first = scope.createSession();
  const second = scope.createSession();
  const firstSignals = first.resolve(layerSignals);
  const secondSignals = second.resolve(layerSignals);
  await first.close({ graceful: true });
  expect(firstSignals.closing.aborted).toBe(true);
  expect(secondSignals.closing.aborted).toBe(false);
  expect(await Promise.race([parent.wait, Promise.resolve("live")])).toBe("live");
  await scope.close({ graceful: true });
  expect(secondSignals.closing.aborted).toBe(true);
  await parent.wait;
});

test("forced close still stops work through the work signal and rolls back", async () => {
  const scope = createScope();
  const session = scope.createSession();
  const owned = session.resolve(layerSignals);
  const running = session.settle({
    label: "wait-for-force",
    run: (_deps, ctx) =>
      new Promise<void>((_resolve, reject) => {
        ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason), { once: true });
      }),
  });
  const closing = session.close();
  expect(owned.closing.aborted).toBe(true);
  expect((await running).status).toBe("cancelled");
  expect((await closing).status).toBe("cancelled");
  expect(owned.signal.aborted).toBe(true);
  await scope.close();
});

test("a closing signal first read after close is aborted", async () => {
  const scope = createScope();
  let ctx: Resource.Ctx | undefined;
  const capture = resource({
    label: "unread-closing",
    factory: (_deps, context) => {
      ctx = context;
      return 1;
    },
  });
  scope.resolve(capture);
  await scope.close({ graceful: true });
  expect(ctx?.closing.aborted).toBe(true);
});

test("a graceful parent close ends a wait inside a running session body", async () => {
  const scope = createScope();
  const entered = gate();
  const running = scope.session(async (session) => {
    const value = session.run(waitAtSession);
    entered.release();
    await value;
    return 7;
  });
  await entered.promise;
  const closing = scope.close({ graceful: true });
  expect(await running).toBe(7);
  expect((await closing).status).toBe("success");
});

test("run, resolve, and write hooks read their owner's closing signal", async () => {
  const signals: AbortSignal[] = [];
  const counts = data({ label: "hook-count", initial: 0 });
  const piece = extension({
    label: "hook-closing",
    hooks: {
      start: (event) => {
        signals.push(event.closing);
        return event.next();
      },
      resolve: (event) => {
        signals.push(event.closing);
        return event.next();
      },
      run: (event) => {
        signals.push(event.closing);
        return event.next();
      },
      write: (event) => {
        signals.push(event.closing);
        return event.next();
      },
    },
  });
  const scope = createScope({ extensions: [piece] });
  await scope.ready;
  scope.resolve(counts);
  scope.controller(counts).set(1);
  scope.run({ label: "hook-read", run: () => 1 });
  expect(signals).toHaveLength(4);
  for (const signal of signals) {
    expect(signal).toBe(signals.at(0));
    expect(signal.aborted).toBe(false);
  }
  await scope.close({ graceful: true });
  for (const signal of signals) expect(signal.aborted).toBe(true);
});
