import { expect, test } from "vite-plus/test";
import { createScope, data, extension, operation, resource, tag } from "../src/index.ts";

/** ADR 0072: a tagged call comes back as a value when its child session ended in place, and as
 * a native promise when the session must wait. One test per case on the wait list. */
const zone = tag<string>({ label: "zone", default: "base" });
const tags = [zone("x")];
const isNative = (out: unknown): boolean => out instanceof Promise && Promise.resolve(out) === out;

test("wait: a promise body", async () => {
  const op = operation({ label: "later", run: async () => 7 });
  const out = createScope().run(op, { tags });
  expect(isNative(out)).toBe(true);
  expect(await out).toBe(7);
});

test("wait: a defer registered by a session resource of the run", async () => {
  const seen: string[] = [];
  const flow = resource({
    label: "flow",
    target: "session",
    factory: (_deps, { defer }) => {
      defer((end) => {
        seen.push(end.status);
      });
      return "f";
    },
  });
  const op = operation({ label: "use", depends: { flow }, run: ({ flow }) => flow });
  const out = createScope().run(op, { tags });
  expect(isNative(out)).toBe(true);
  expect(await out).toBe("f");
  expect(seen).toEqual(["success"]);
});

test("wait: a session resource built for the run, even with no cleanup", async () => {
  let builds = 0;
  const flow = resource({ label: "flow", target: "session", factory: () => `f${++builds}` });
  const op = operation({ label: "use", depends: { flow }, run: ({ flow }) => flow });
  const scope = createScope();
  const out = scope.run(op, { tags });
  expect(isNative(out)).toBe(true);
  expect(await out).toBe("f1");
  expect(await scope.run(op, { tags })).toBe("f2");
});

test("wait: a child session opened by the body", async () => {
  const scope = createScope();
  let grand: ReturnType<typeof scope.createSession> | undefined;
  const out = scope.session((s) => {
    grand = s.createSession();
    return 1;
  });
  expect(isNative(out)).toBe(true);
  expect(await out).toBe(1);
  expect(() => grand!.run({ run: () => 1 })).toThrow("Disposed");
});

test("wait: pending work the body did not await", async () => {
  let settled = false;
  const inner = operation({
    label: "inner",
    run: async () => {
      await Promise.resolve();
      settled = true;
    },
  });
  const op = operation({
    label: "fire",
    depends: { inner },
    run: ({ inner }) => {
      void inner.run();
      return 1;
    },
  });
  const out = createScope().run(op, { tags });
  expect(isNative(out)).toBe(true);
  expect(await out).toBe(1);
  expect(settled).toBe(true);
});

test("wait: a signal handed out, aborted once the run ended", async () => {
  let signal: AbortSignal | undefined;
  const op = operation({
    label: "sig",
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

test("wait: a failure rejects through a promise", async () => {
  const cause = new Error("boom");
  const op = operation({
    label: "bad",
    run: () => {
      throw cause;
    },
  });
  const out = createScope().run(op, { tags });
  expect(isNative(out)).toBe(true);
  await expect(out).rejects.toBe(cause);
});

test("wait: a session hook wraps the tagged call once", async () => {
  let seen = 0;
  const scope = createScope({
    extensions: [
      extension({
        label: "hook",
        session: async (_s, next) => {
          seen++;
          return next();
        },
      }),
    ],
  });
  await scope.ready;
  const op = operation({ label: "one", run: () => 1 });
  const out = scope.run(op, { tags });
  expect(isNative(out)).toBe(true);
  expect(await out).toBe(1);
  expect(seen).toBe(1);
  await scope.close();
});

test("wait: a tagged subflow called before its caller's first await; a value after it", async () => {
  const inner = operation({ label: "inner", run: () => 42 });
  const before = operation({
    label: "before",
    depends: { inner },
    run: ({ inner }) => {
      const out = inner.run({ tags });
      return isNative(out) ? "promise" : `value ${out as number}`;
    },
  });
  const after = operation({
    label: "after",
    depends: { inner },
    run: async ({ inner }) => {
      await Promise.resolve();
      const out = inner.run({ tags });
      return isNative(out) ? "promise" : `value ${out as number}`;
    },
  });
  expect(createScope().run(before)).toBe("promise");
  expect(await createScope().run(after)).toBe("value 42");
});

test("in place: a sync body on an idle session comes back as a value, and reads its tag", () => {
  const op = operation({ label: "read", depends: { zone }, run: ({ zone }) => zone });
  const cell = data({ label: "cell", initial: 1 });
  const readCell = operation({ label: "cell", depends: { cell }, run: ({ cell }) => cell + 1 });
  expect(createScope().run(op, { tags })).toBe("x");
  expect(createScope().run(readCell, { tags })).toBe(2);
});
