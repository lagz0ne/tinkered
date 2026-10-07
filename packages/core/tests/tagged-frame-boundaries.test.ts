import { expect, test } from "vite-plus/test";
import { createScope, data, isError, operation, resource, tag } from "../src/index";

/** A tagged call runs on a frame: its child session attaches to the parent only when the run
 * needs a lifetime. Each test sits at one boundary and checks the outcome ADR 0038, 0067, 0071
 * and 0072 promise there. */
const zone = tag<string>({ label: "zone", default: "base" });
const tags = [zone("x")];
const isNative = (out: unknown): boolean => out instanceof Promise && Promise.resolve(out) === out;

test("a run that touches nothing comes back as a value, and its tag was visible", () => {
  const op = operation({ label: "read", depends: { zone }, run: ({ zone }) => zone });
  expect(createScope().run(op, { tags })).toBe("x");
});

test("an op-level defer runs before the value comes back and needs no session", () => {
  const seen: string[] = [];
  const op = operation({
    label: "defer",
    run: (_deps, ctx) => {
      ctx.defer((end) => {
        seen.push(end.status);
      });
      return 1;
    },
  });
  expect(createScope().run(op, { tags })).toBe(1);
  expect(seen).toEqual(["success"]);
});

test("a write through a data-controller dep stays in the run's session", () => {
  const cell = data({ label: "cell", initial: 0 });
  const op = operation({
    label: "write",
    depends: { c: cell.controller },
    run: ({ c }) => {
      c.set(9);
      return c.get();
    },
  });
  const scope = createScope();
  expect(scope.run(op, { tags })).toBe(9);
  expect(scope.resolve(cell)).toBe(0);
});

test("a session resource built during the run lives in the run's session and is cleaned when it ends", async () => {
  const seen: string[] = [];
  let builds = 0;
  const flow = resource({
    label: "flow",
    target: "session",
    depends: { zone },
    factory: ({ zone }, { defer }) => {
      builds++;
      defer((end) => {
        seen.push(end.status);
      });
      return `f:${zone}`;
    },
  });
  const op = operation({ label: "use", depends: { flow }, run: ({ flow }) => flow });
  const scope = createScope();
  const out = scope.run(op, { tags });
  expect(isNative(out)).toBe(true);
  expect(await out).toBe("f:x");
  expect(seen).toEqual(["success"]);
  expect(builds).toBe(1);
  expect(await scope.run(op, { tags })).toBe("f:x");
  expect(builds).toBe(2);
});

test("a watcher registered by the run keeps the session on the full path", async () => {
  const cell = data({ label: "cell", initial: 0 });
  const op = operation({
    label: "watch",
    depends: { c: cell.controller },
    run: ({ c }) => {
      c.watch(() => undefined);
      return 1;
    },
  });
  const out = createScope().run(op, { tags });
  expect(isNative(out)).toBe(true);
  expect(await out).toBe(1);
});

test("a first signal read attaches the session; the signal reads aborted once the run ended", async () => {
  let signal: AbortSignal | undefined;
  const op = operation({
    label: "signal",
    run: (_deps, ctx) => {
      signal = ctx.signal;
      return 1;
    },
  });
  const out = createScope().run(op, { tags });
  expect(isNative(out)).toBe(true);
  expect(await out).toBe(1);
  expect(signal!.aborted).toBe(true);
});

test("a signal read only after the run ended is aborted too", () => {
  let saved: { readonly signal: AbortSignal } | undefined;
  const op = operation({
    label: "late",
    run: (_deps, ctx) => {
      saved = ctx;
      return 1;
    },
  });
  expect(createScope().run(op, { tags })).toBe(1);
  expect(saved!.signal.aborted).toBe(true);
});

test("a panic in a sync tagged body fails the run's own session, not its parent", async () => {
  const cause = new Error("bug");
  const op = operation({
    label: "boom",
    run: () => {
      throw cause;
    },
  });
  const root = createScope();
  const out = root.run(op, { tags });
  expect(isNative(out)).toBe(true);
  await expect(out).rejects.toBe(cause);
  expect((await root.close({ graceful: true })).status).toBe("success");
});

test("a parent's forced close requested inside a sync tagged body cancels the run", async () => {
  const root = createScope();
  let closing: ReturnType<typeof root.close> | undefined;
  const op = operation({
    label: "closer",
    run: () => {
      closing = root.close();
      return 7;
    },
  });
  const out = root.run(op, { tags });
  expect(isNative(out)).toBe(true);
  const end = await closing!;
  expect(end.status).toBe("cancelled");
  try {
    await out;
    expect.unreachable();
  } catch (error) {
    expect(error).toBe((end as { reason: unknown }).reason);
  }
});

test("a tagged subflow inside a tagged run: the inner waits (a body is running), the outer waits for it", async () => {
  const inner = operation({ label: "inner", depends: { zone }, run: ({ zone }) => zone });
  const outer = operation({
    label: "outer",
    depends: { inner },
    run: ({ inner }) => {
      const out = inner.run({ tags: [zone("in")] });
      return isNative(out) ? out : Promise.reject(new Error("expected a promise"));
    },
  });
  const out = createScope().run(outer, { tags });
  expect(isNative(out)).toBe(true);
  expect(await out).toBe("in");
});

test("a managed error raised by the run rejects the call and leaves the parent healthy", async () => {
  const required = tag<string>({ label: "required" });
  const op = operation({ label: "needs", depends: { required }, run: ({ required }) => required });
  const root = createScope();
  const out = root.run(op, { tags });
  expect(isNative(out)).toBe(true);
  try {
    await out;
    expect.unreachable();
  } catch (error) {
    if (!isError(error, "MissingTag")) throw error;
  }
  expect((await root.close({ graceful: true })).status).toBe("success");
});

test("a parent close requested while a tagged call's body is being adopted waits for the call", async () => {
  const root = createScope();
  const order: string[] = [];
  let closing: Promise<unknown> | undefined;
  const op = operation({
    label: "then-getter",
    run: () => ({
      get then(): unknown {
        closing ??= root.close().then(() => order.push("parent-ended"));
        return null;
      },
    }),
  });
  const out = root.run(op, { tags });
  expect(isNative(out)).toBe(true);
  await (out as Promise<unknown>).then(
    () => order.push("call-ended"),
    () => order.push("call-ended"),
  );
  await closing;
  expect(order).toEqual(["call-ended", "parent-ended"]);
});
