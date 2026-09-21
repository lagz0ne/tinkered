import { expect, test } from "vite-plus/test";
import { createScope, extension, isError, operation, resource } from "../src/index.ts";

test("a session hook that throws before next still lets the body run and rethrows the hook error", async () => {
  const boom = new Error("sync-hook-boom");
  let ran = false;
  const bad = extension({
    label: "bad",
    session: () => {
      throw boom;
    },
  });
  const scope = createScope({ extensions: [bad] });
  await scope.ready;
  const thrown = await scope
    .session(() => {
      ran = true;
      return 1;
    })
    .then(
      () => undefined,
      (error: unknown) => error,
    );
  expect(ran).toBe(true);
  expect(thrown).toBe(boom);
  await scope.close();
});

test("two session hooks see each ordered end in turn", async () => {
  const order: string[] = [];
  const track = (label: string) =>
    extension({
      label,
      session: async (_handle, next) => {
        const ended = await next();
        order.push(`${label}:${ended.status}`);
        return ended;
      },
    });
  const scope = createScope({ extensions: [track("one"), track("two")] });
  await scope.ready;
  await scope.session(() => 7);
  expect(order).toEqual(["two:success", "one:success"]);
  await scope.close();
});

test("a body that rejects inside session fails the close with its cause", async () => {
  const cause = new Error("session-body-boom");
  const thrown = await createScope()
    .session(() => Promise.reject(cause))
    .then(
      () => undefined,
      (error: unknown) => error,
    );
  expect(thrown).toBe(cause);
});

test("a session body that throws sync rejects the session with its cause", async () => {
  const cause = new Error("sync-body-boom");
  const thrown = await createScope()
    .session((): number => {
      throw cause;
    })
    .then(
      () => undefined,
      (error: unknown) => error,
    );
  expect(thrown).toBe(cause);
});

test("a cancelled session rejects with its reason", async () => {
  const scope = createScope();
  const child = scope.createSession();
  const pending = child.close();
  const result = await pending;
  expect(result.status).toBe("cancelled");
  await scope.close();
});

test("a failing teardown inside session still reports the body failure", async () => {
  const bodyCause = new Error("body-fails");
  const cleanup = new Error("cleanup-fails");
  const leaky = resource({
    label: "leaky",
    target: "session",
    factory: (_deps, { defer }) => {
      defer(() => {
        throw cleanup;
      });
      return 1;
    },
  });
  const thrown = await createScope()
    .session((s) => {
      s.resolve(leaky);
      throw bodyCause;
    })
    .then(
      () => undefined,
      (error: unknown) => error,
    );
  if (!isError(thrown, "TeardownFailed")) throw thrown;
  expect(thrown.payload.causes).toEqual([bodyCause, cleanup]);
});

test("a close re-entered during a failing teardown reports the failure", async () => {
  const cause = new Error("owned-boom");
  let inner: unknown;
  const doomed = operation({ label: "doomed", run: () => Promise.reject(cause) });
  const scope = createScope();
  const failed = scope.run(doomed).then(
    () => undefined,
    (error: unknown) => error,
  );
  const probe = resource({
    label: "probe",
    factory: (_deps, { defer }) => {
      defer(() => {
        inner = scope.close();
      });
      return 1;
    },
  });
  scope.resolve(probe);
  await scope.settled().catch(() => undefined);
  await failed;
  const result = await scope.close();
  expect(result.status).toBe("failed");
  const innerResult = (await inner) as { status: string; error: unknown };
  expect(innerResult.status).toBe("failed");
  expect(innerResult.error).toBe(cause);
});

test("a close re-entered during a clean forced teardown reports cancelled", async () => {
  let inner: unknown;
  const probe = resource({
    label: "probe",
    factory: (_deps, { defer }) => {
      defer(() => {
        inner = scope.close();
      });
      return 1;
    },
  });
  const scope = createScope();
  scope.resolve(probe);
  const result = await scope.close();
  expect(result.status).toBe("cancelled");
  const innerResult = (await inner) as { status: string };
  expect(innerResult.status).toBe("cancelled");
});

test("a forced close with a cleanup still settles cancelled", async () => {
  const seen: string[] = [];
  const probe = resource({
    label: "probe",
    factory: (_deps, { defer }) => {
      defer((end) => void seen.push(end.status));
      return 1;
    },
  });
  const scope = createScope();
  scope.resolve(probe);
  const result = await scope.close();
  expect(result.status).toBe("cancelled");
  expect(seen).toEqual(["cancelled"]);
});

test("settled stays pending until an operation's async cleanup finishes", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const order: string[] = [];
  const op = operation({
    label: "op",
    run: (_deps, { defer }) => {
      defer(() => gate.then(() => void order.push("cleanup-done")));
      return 1;
    },
  });
  const scope = createScope();
  scope.run(op);
  let settled = false;
  const waiting = scope.settled().then(() => {
    settled = true;
  });
  for (let i = 0; i < 5; i++) await Promise.resolve();
  expect(settled).toBe(false);
  release();
  await waiting;
  expect(settled).toBe(true);
  expect(order).toEqual(["cleanup-done"]);
});

test("a wrapped session body that throws sync still drains cleanups then reports the cause", async () => {
  const cause = new Error("wrapped-sync-boom");
  const cleanup = new Error("wrapped-cleanup-boom");
  const seen: string[] = [];
  const spy = extension({
    label: "spy",
    session: async (_handle, next) => next(),
  });
  const leaky = resource({
    label: "leaky",
    target: "session",
    factory: (_deps, { defer }) => {
      defer(() => {
        throw cleanup;
      });
      defer((end) => void seen.push(end.status));
      return 1;
    },
  });
  const scope = createScope({ extensions: [spy] });
  await scope.ready;
  const thrown = await scope
    .session((s) => {
      s.resolve(leaky);
      throw cause;
    })
    .then(
      () => undefined,
      (error: unknown) => error,
    );
  if (!isError(thrown, "TeardownFailed")) throw thrown;
  expect(thrown.payload.causes).toEqual([cause, cleanup]);
  expect(seen).toEqual(["failed"]);
  await scope.close();
});

test("three session hooks nest in registration order", async () => {
  const order: string[] = [];
  const hook = (label: string) =>
    extension({
      label,
      session: async (_handle, next) => {
        order.push(`${label}:before`);
        const ended = await next();
        order.push(`${label}:after`);
        return ended;
      },
    });
  const scope = createScope({ extensions: [hook("a"), hook("b"), hook("c")] });
  await scope.ready;
  await scope.session(() => 1);
  expect(order).toEqual(["a:before", "b:before", "c:before", "c:after", "b:after", "a:after"]);
  await scope.close();
});

test("a close hook sees the settled end", async () => {
  const seen: unknown[] = [];
  const ext = extension({
    label: "spy",
    close: async (_opts, next) => {
      const result = await next();
      seen.push(result.status);
      return result;
    },
  });
  const scope = createScope({ extensions: [ext] });
  await scope.ready;
  await scope.close({ graceful: true });
  expect(seen).toEqual(["success"]);
});

test("a graceful close through hooks settles success", async () => {
  const ext = extension({
    label: "pass",
    close: (_opts, next) => next(),
  });
  const scope = createScope({ extensions: [ext] });
  await scope.ready;
  const result = await scope.close({ graceful: true });
  expect(result.status).toBe("success");
});

test("a failing body with a failing cleanup reports both causes", async () => {
  const bodyCause = new Error("body-boom");
  const cleanup = new Error("cleanup-boom");
  const spy = extension({
    label: "spy",
    session: async (_handle, next) => next(),
  });
  const leaky = resource({
    label: "leaky",
    target: "session",
    factory: (_deps, { defer }) => {
      defer(() => {
        throw cleanup;
      });
      return 1;
    },
  });
  const scope = createScope({ extensions: [spy] });
  await scope.ready;
  const thrown = await scope
    .session((s) => {
      s.resolve(leaky);
      throw bodyCause;
    })
    .then(
      () => undefined,
      (error: unknown) => error,
    );
  if (!isError(thrown, "TeardownFailed")) throw thrown;
  expect(thrown.payload.causes).toEqual([bodyCause, cleanup]);
  await scope.close();
});

test("a session that ends cancelled rejects with its reason", async () => {
  const spy = extension({
    label: "spy",
    session: async (_handle, next) => next(),
  });
  const scope = createScope({ extensions: [spy] });
  await scope.ready;
  const child = scope.createSession();
  const result = await child.close();
  expect(result.status).toBe("cancelled");
  await scope.close();
});

test("session hooks wrap sessions nested two deep", async () => {
  const order: string[] = [];
  const spy = extension({
    label: "spy",
    session: async (_handle, next) => {
      order.push("before");
      const ended = await next();
      order.push("after");
      return ended;
    },
  });
  const scope = createScope({ extensions: [spy] });
  await scope.ready;
  await scope.session((s) => s.session(() => 1));
  expect(order).toEqual(["before", "before", "after", "after"]);
  await scope.close();
});

test("a close re-entered from an async cleanup is still acknowledged", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let inner: unknown;
  const probe = resource({
    label: "probe",
    factory: (_deps, { defer }) => {
      defer(() =>
        gate.then(() => {
          inner = scope.close();
        }),
      );
      return 1;
    },
  });
  const scope = createScope();
  scope.resolve(probe);
  const closing = scope.close();
  for (let i = 0; i < 5; i++) await Promise.resolve();
  release();
  const result = await closing;
  expect(result.status).toBe("cancelled");
  const innerResult = (await inner) as { status: string };
  expect(innerResult.status).toBe("cancelled");
});

test("an operation that finishes after abort still sees cancelled", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let end: string | undefined;
  const op = operation({
    label: "op",
    run: (_deps, { defer }) => {
      defer((e) => {
        end = e.status;
      });
      return gate.then(() => 1);
    },
  });
  const scope = createScope();
  const running = scope.run(op) as Promise<unknown>;
  const closing = scope.close();
  release();
  expect(await running).toBe(1);
  const result = await closing;
  expect(result.status).toBe("cancelled");
  expect(end).toBe("cancelled");
});

test("a cleanup that closes another scope sees its real result", async () => {
  const order: string[] = [];
  const other = createScope();
  const probe = resource({
    label: "probe",
    factory: (_deps, { defer }) => {
      defer(() => void order.push("other-clean"));
      return 1;
    },
  });
  other.resolve(probe);
  let seen: string | undefined;
  const scope = createScope();
  scope.onClose(async () => {
    seen = (await other.close()).status;
  });
  const result = await scope.close();
  expect(result.status).toBe("cancelled");
  expect(order).toEqual(["other-clean"]);
  expect(seen).toBe("cancelled");
});

test("a wrapped session cut by a forced close rejects", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const spy = extension({
    label: "spy",
    session: async (_handle, next) => next(),
  });
  const scope = createScope({ extensions: [spy] });
  await scope.ready;
  const running = scope.session(() => gate);
  const closing = scope.close();
  release();
  let rejected = false;
  let value: unknown = "unset";
  await running.then(
    () => undefined,
    (error: unknown) => {
      rejected = true;
      value = error;
    },
  );
  expect(rejected).toBe(true);
  expect(value).toBeDefined();
  await closing;
});
