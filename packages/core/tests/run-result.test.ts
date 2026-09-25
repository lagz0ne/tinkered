import { expect, expectTypeOf, test } from "vite-plus/test";
import {
  createScope,
  extension,
  makeTestClock,
  namespace,
  operation,
  originOf,
  resource,
  tag,
  type RunResult,
} from "../src/index.ts";

const zone = tag({ label: "zone", default: "home" });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

test("settle returns an async operation's success value", async () => {
  const value = { count: 1 };
  const op = operation({ label: "value", run: async () => value });
  const scope = createScope();
  const result = await scope.settle(op);
  if (result.status !== "success") throw result;
  expect(result.value).toBe(value);
  await scope.close();
});

test("settle classifies a registry-shaped Error as an error", async () => {
  const error = Object.assign(new Error("missing"), { kind: "Missing", payload: { id: 7 } });
  const op = operation({
    label: "managed",
    run: async () => {
      throw error;
    },
  });
  const scope = createScope();
  expect(await scope.controller(op).settle()).toEqual({
    status: "failed",
    error,
    kind: "error",
    origin: { label: "managed", path: ["managed"] },
  });
  await scope.close();
});

test("settle classifies a plain Error as a panic", async () => {
  const error = new Error("bug");
  const op = operation({
    label: "bug",
    run: async () => {
      throw error;
    },
  });
  const scope = createScope();
  expect(await scope.settle(op)).toEqual({
    status: "failed",
    error,
    kind: "panic",
    origin: { label: "bug", path: ["bug"] },
  });
  await scope.close();
});

const notManaged: [string, object][] = [
  ["a non-Error object with a kind and a payload", { kind: "Missing", payload: {} }],
  ["an Error with a kind but no payload", Object.assign(new Error("half"), { kind: "Missing" })],
  [
    "an Error whose kind is not a string",
    Object.assign(new Error("odd"), { kind: 7, payload: {} }),
  ],
];
for (const [shape, error] of notManaged) {
  test(`settle classifies ${shape} as a panic`, async () => {
    const op = operation({
      label: "shape",
      run: () => {
        throw error;
      },
    });
    const scope = createScope();
    expect(scope.settle(op)).toMatchObject({ status: "failed", kind: "panic" });
    await scope.close();
  });
}

test("settle returns a primitive panic without an origin", async () => {
  const op = operation({
    label: "primitive",
    run: () => {
      throw 7;
    },
  });
  const scope = createScope();
  expect(scope.settle(op)).toEqual({ status: "failed", error: 7, kind: "panic" });
  await scope.close();
});

test("settle returns the value when an operation returns under a forced close", async () => {
  const { promise, resolve } = deferred<number>();
  const op = operation({ label: "ignores", run: () => promise });
  const scope = createScope();
  const running = scope.settle(op);
  const closing = scope.close();
  resolve(1);
  expect((await closing).status).toBe("cancelled");
  expect(await running).toEqual({ status: "success", value: 1 });
});

test("settle returns what run returns when a body answers its abort with a value", async () => {
  const serve = operation({
    label: "serve",
    run: (_deps, { signal }) =>
      new Promise<number>((resolve) =>
        signal.addEventListener("abort", () => resolve(0), { once: true }),
      ),
  });
  const a = createScope();
  const ran = a.run(serve);
  void a.close();
  const b = createScope();
  const settled = b.settle(serve);
  void b.close();
  expect(await ran).toBe(0);
  expect(await settled).toEqual({ status: "success", value: 0 });
});

test("settle reports cancellation when a body rejects with its abort reason", async () => {
  const op = operation({
    label: "rethrows",
    run: (_deps, { signal }) =>
      new Promise<never>((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
      ),
  });
  const scope = createScope();
  const running = scope.settle(op);
  const ended = await scope.close();
  if (ended.status !== "cancelled") throw ended;
  expect(await running).toEqual({ status: "cancelled", reason: ended.reason });
});

test("settle mirrors run for a sync operation under a forced close", async () => {
  const aborted = operation({ label: "aborted", run: (_deps, { signal }) => signal.aborted });
  const rethrows = operation({
    label: "rethrows",
    run: (_deps, { signal }) => {
      throw signal.reason;
    },
  });
  const scope = createScope();
  const gate = deferred<void>();
  const results: unknown[] = [];
  const inside = scope.session(async (session) => {
    await gate.promise;
    results.push(session.settle(aborted), session.settle(rethrows));
  });
  const closing = scope.close();
  gate.resolve();
  await inside.catch(() => undefined);
  const ended = await closing;
  if (ended.status !== "cancelled") throw ended;
  expect(results).toEqual([
    { status: "success", value: true },
    { status: "cancelled", reason: ended.reason },
  ]);
});

test("settle reports a cancel reason from another scope as a failure", async () => {
  const other = createScope();
  const wait = operation({
    label: "wait",
    run: (_deps, { signal }) =>
      new Promise<never>((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
      ),
  });
  const waiting = other.run(wait);
  void other.close();
  const reason = await waiting.catch((error: unknown) => error);
  const scope = createScope();
  const op = operation({
    label: "relays",
    run: () => {
      throw reason;
    },
  });
  const result = scope.settle(op);
  expect(result).toMatchObject({ status: "failed", error: reason });
  await scope.close();
});

test("settle reports cancellation when a forced close aborts its operation", async () => {
  const op = operation({
    label: "wait",
    run: async (_deps, { clock, signal }) => clock.sleep(100, signal),
  });
  const scope = createScope({ clock: makeTestClock() });
  const running = scope.settle(op);
  const ended = await scope.close();
  if (ended.status !== "cancelled") throw ended;
  expect(await running).toEqual({ status: "cancelled", reason: ended.reason });
});

test("settle returns a sync Result for an untagged sync operation", async () => {
  const op = operation({ label: "sync", input: Number, run: (_deps, { input }) => input + 1 });
  const scope = createScope();
  const result = scope.controller(op).settle({ rawInput: "2" });
  expectTypeOf(result).toEqualTypeOf<RunResult<number>>();
  expect(result).toEqual({ status: "success", value: 3 });
  await scope.close();
});

test("settle returns a promise for a tagged sync operation", async () => {
  const op = operation({ label: "tagged", depends: { zone }, run: ({ zone }) => zone });
  const scope = createScope();
  const result = scope.controller(op).settle({ tags: zone("away") });
  expectTypeOf(result).toEqualTypeOf<Promise<RunResult<string>>>();
  expect(Promise.resolve(result)).toBe(result);
  expect(await result).toEqual({ status: "success", value: "away" });
  await scope.close();
});

test("scope settle accepts a typed inline call without making it async", async () => {
  const scope = createScope();
  const result = scope.settle({ run: (_deps, { input }) => input + 1 }, { input: 2 });
  expectTypeOf(result).toEqualTypeOf<RunResult<number>>();
  expect(result).toEqual({ status: "success", value: 3 });
  await scope.close();
});

test("scope settle runs a tagged inline config asynchronously", async () => {
  const scope = createScope();
  const result = scope.settle(
    { depends: { zone }, run: ({ zone }, { input }) => `${zone}:${input}` },
    { input: 2, tags: zone("away") },
  );
  expectTypeOf(result).toEqualTypeOf<Promise<RunResult<string>>>();
  expect(Promise.resolve(result)).toBe(result);
  expect(await result).toEqual({ status: "success", value: "away:2" });
  await scope.close();
});

test("settle recovers a root operation's panic without failing the layer", async () => {
  const op = operation({
    label: "recover",
    run: async () => {
      throw new Error("panic");
    },
  });
  const scope = createScope();
  await scope.settle(op);
  expect((await scope.close({ graceful: true })).status).toBe("success");
});

for (const edge of [false, true]) {
  test(`settle recovers through a ${edge ? "controller edge" : "bare operation dependency"}`, async () => {
    const error = new Error("inner");
    const inner = operation({
      label: "inner",
      run: async () => {
        throw error;
      },
    });
    const outer = operation({
      label: "outer",
      depends: { inner: edge ? inner.controller : inner },
      run: async ({ inner }) => inner.settle(),
    });
    const scope = createScope();
    expect(await scope.run(outer)).toEqual({
      status: "failed",
      error,
      kind: "panic",
      origin: { label: "inner", path: ["inner"] },
    });
    expect((await scope.close({ graceful: true })).status).toBe("success");
  });
}

test("a settle call remains recovered when its caller finishes first", async () => {
  const { promise, reject } = deferred<never>();
  const inner = operation({ label: "inner", run: () => promise });
  let settled!: Promise<RunResult<never>>;
  const outer = operation({
    label: "outer",
    depends: { inner },
    run: ({ inner }) => {
      settled = inner.settle();
      return "done";
    },
  });
  const scope = createScope();
  scope.run(outer);
  const closing = scope.close({ graceful: true });
  reject(new Error("late"));
  await settled;
  expect((await closing).status).toBe("success");
});

test("a tagged settle failure does not bubble through a graceful parent close", async () => {
  const { promise, reject } = deferred<never>();
  const op = operation({ label: "tagged", run: () => promise });
  const scope = createScope();
  const running = scope.settle(op, { tags: zone("away") });
  const closing = scope.close({ graceful: true });
  reject(new Error("tagged"));
  await running;
  expect((await closing).status).toBe("success");
});

test("settle returns a closed-scope error rather than throwing", async () => {
  const scope = createScope();
  await scope.close();
  const result = scope.settle({ run: () => 1 });
  expect(result).toMatchObject({ status: "failed", kind: "error", error: { kind: "Disposed" } });
});

test("a sync throw gets the innermost run's origin", async () => {
  const error = new Error("sync");
  const inner = operation({
    label: "inner",
    run: () => {
      throw error;
    },
  });
  const outer = operation({ label: "outer", depends: { inner }, run: ({ inner }) => inner.run() });
  const scope = createScope();
  expect(() => scope.run(outer)).toThrow(error);
  expect(originOf(error)).toEqual({ label: "inner", path: ["outer", "inner"] });
  await scope.close();
});

test("an async rejection gets the innermost run's origin", async () => {
  const error = new Error("async");
  const inner = operation({
    label: "inner",
    run: async () => {
      throw error;
    },
  });
  const outer = operation({
    label: "outer",
    depends: { inner },
    run: async ({ inner }) => inner.run(),
  });
  const scope = createScope();
  await expect(scope.run(outer)).rejects.toBe(error);
  expect(originOf(error)).toEqual({ label: "inner", path: ["outer", "inner"] });
  await scope.close();
});

test("three failed runs build a root-first origin path", async () => {
  const error = new Error("deep");
  const inner = operation({
    label: "inner",
    run: () => {
      throw error;
    },
  });
  const middle = operation({
    label: "middle",
    depends: { inner },
    run: ({ inner }) => inner.run(),
  });
  const outer = operation({
    label: "outer",
    depends: { middle },
    run: ({ middle }) => middle.run(),
  });
  const scope = createScope();
  scope.settle(outer);
  expect(originOf(error)?.path).toEqual(["outer", "middle", "inner"]);
  await scope.close();
});

test("originOf follows cause chains to a stamped error", async () => {
  const error = new Error("inner");
  const op = operation({
    label: "inner",
    run: () => {
      throw error;
    },
  });
  const scope = createScope();
  scope.settle(op);
  const wrapper = new Error("outer", { cause: new Error("middle", { cause: error }) });
  expect(originOf(wrapper)).toEqual({ label: "inner", path: ["inner"] });
  await scope.close();
});

test("rethrowing an already-stamped error keeps its first origin", async () => {
  const error = new Error("shared");
  const first = operation({
    label: "first",
    run: () => {
      throw error;
    },
  });
  const second = operation({
    label: "second",
    run: () => {
      throw error;
    },
  });
  const scope = createScope();
  scope.settle(first);
  scope.settle(second);
  expect(originOf(error)).toEqual({ label: "first", path: ["first"] });
  await scope.close();
});

test("a sentinel error thrown on every settle keeps a one-run path", async () => {
  const sentinel = new Error("not ready");
  const op = operation({
    label: "poll",
    run: async () => {
      throw sentinel;
    },
  });
  const scope = createScope();
  for (let i = 0; i < 5; i++) await scope.settle(op);
  expect(originOf(sentinel)).toEqual({ label: "poll", path: ["poll"] });
  await scope.close();
});

for (const via of ["tagged", "namespaced"] as const) {
  test(`a sentinel thrown by a ${via} root run five times keeps a one-run path`, async () => {
    const sentinel = new Error("not ready");
    const top = operation({
      label: "top",
      run: () => {
        throw sentinel;
      },
    });
    const scope = createScope();
    const ns = namespace();
    const runTop = (): unknown =>
      via === "tagged" ? scope.run(top, { tags: zone("away") }) : scope.run(top, { ns });
    for (let i = 0; i < 5; i++) {
      try {
        await runTop();
      } catch (error) {
        if (error !== sentinel) throw error;
      }
    }
    expect(originOf(sentinel)).toEqual({ label: "top", path: ["top"] });
    await scope.close();
  });
}

test("a tagged subflow keeps its caller in the path", async () => {
  const error = new Error("tagged");
  const inner = operation({
    label: "inner",
    run: () => {
      throw error;
    },
  });
  const outer = operation({
    label: "outer",
    depends: { inner },
    run: ({ inner }) => inner.run({ tags: zone("away") }),
  });
  const scope = createScope();
  await expect(scope.run(outer)).rejects.toBe(error);
  expect(originOf(error)).toEqual({ label: "inner", path: ["outer", "inner"] });
  await scope.close();
});

test("a sibling rethrow does not extend the first path", async () => {
  const error = new Error("shared");
  const a = operation({
    label: "a",
    run: () => {
      throw error;
    },
  });
  const b = operation({ label: "b", depends: { a }, run: ({ a }) => a.run() });
  const scope = createScope();
  scope.settle(b);
  scope.settle(b);
  expect(originOf(error)).toEqual({ label: "a", path: ["b", "a"] });
  await scope.close();
});

test("an observed origin carries the failed run's span id", async () => {
  const error = new Error("observed");
  const op = operation({
    label: "observed",
    run: () => {
      throw error;
    },
  });
  const scope = createScope({ observe: { history: 1 } });
  scope.settle(op);
  expect(originOf(error)).toEqual({
    label: "observed",
    span: scope.spans()[0].id,
    path: ["observed"],
  });
  await scope.close();
});

test("an unobserved origin has no span id", async () => {
  const error = new Error("unobserved");
  const op = operation({
    label: "unobserved",
    run: () => {
      throw error;
    },
  });
  const scope = createScope();
  scope.settle(op);
  expect(originOf(error)).toEqual({ label: "unobserved", path: ["unobserved"] });
  await scope.close();
});

test("destructured operation raise sets kind, payload, and message at the throw site", async () => {
  const payload = { id: 7 };
  const op = operation({
    label: "raise",
    run: (_deps, { raise }) => {
      try {
        raise("Missing", payload);
      } catch (error) {
        return error;
      }
    },
  });
  const scope = createScope();
  const error = scope.run(op);
  expect(error).toMatchObject({ kind: "Missing", payload, message: "Missing" });
  expect(originOf(error)).toEqual({ label: "raise", path: ["raise"] });
  await scope.close();
});

test("resource raise stamps the resource ctx before a run receives it", async () => {
  const res = resource({
    label: "resource",
    factory:
      (_deps, { raise }) =>
      () =>
        raise("Missing", { id: 7 }),
  });
  const op = operation({ label: "caller", depends: { res }, run: ({ res }) => res() });
  const scope = createScope({ observe: { history: 2 } });
  const result = scope.settle(op);
  if (result.status !== "failed") throw result;
  expect(result.origin).toEqual({
    label: "resource",
    span: scope.spans().find((span) => span.name === "resource")?.id,
    path: ["caller", "resource"],
  });
  await scope.close();
});

test("an escaping operation raise adds its own run label only once", async () => {
  const inner = operation({ label: "inner", run: (_deps, { raise }) => raise("Missing", {}) });
  const outer = operation({ label: "outer", depends: { inner }, run: ({ inner }) => inner.run() });
  const scope = createScope();
  const result = scope.settle(outer);
  if (result.status !== "failed") throw result;
  expect(result.origin).toEqual({ label: "inner", path: ["outer", "inner"] });
  await scope.close();
});

test("an empty ctx raise gets its origin from the run it reaches", async () => {
  const res = resource({
    label: "empty",
    factory:
      (...[_deps, { raise }]) =>
      () =>
        raise("Empty", {}),
  });
  const op = operation({ label: "caller", depends: { res }, run: ({ res }) => res() });
  const scope = createScope();
  expect(scope.settle(op)).toMatchObject({
    kind: "error",
    origin: { label: "caller", path: ["caller"] },
  });
  await scope.close();
});

test("extension raise stamps the start ctx", async () => {
  const scope = createScope({
    extensions: [
      extension({ label: "start", start: (_scope, { raise }) => raise("StartFailed", {}) }),
    ],
  });
  let error: unknown;
  try {
    await scope.ready;
  } catch (cause) {
    error = cause;
  }
  expect(originOf(error)).toEqual({ label: "start", path: ["start"] });
  await scope.close();
});

test("a failed session close carries its error's origin", async () => {
  const error = new Error("failed");
  const op = operation({
    label: "failure",
    run: async () => {
      throw error;
    },
  });
  const scope = createScope();
  const session = scope.createSession();
  await expect(session.run(op)).rejects.toBe(error);
  expect(await session.close({ graceful: true })).toEqual({
    status: "failed",
    error,
    origin: { label: "failure", path: ["failure"] },
    teardownErrors: undefined,
  });
  await scope.close();
});
