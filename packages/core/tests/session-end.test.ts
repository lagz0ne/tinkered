import { expect, test } from "vite-plus/test";
import { createScope, data, isError, namespace, operation, tag } from "../src/index.ts";

/** A session that ended keeps main's end state: its signal reads aborted (ADR 0028). */
for (const tagged of [false, true]) {
  for (const asyncBody of [false, true]) {
    test(`a session that ended leaves its signal aborted: tagged=${tagged}, async=${asyncBody}`, async () => {
      const root = createScope();
      const zone = tag<string>({ label: "zone" });
      const op = operation({
        label: "save-context",
        run: (_deps, ctx) => (asyncBody ? Promise.resolve(() => ctx.signal) : () => ctx.signal),
      });
      const read = await (tagged
        ? root.run(op, { tags: [zone("x")] })
        : root.session((s) => s.run(op)));
      expect(read().aborted).toBe(true);
      await root.close();
    });
  }
}

test("a throwing then getter rejects the session and closes it", async () => {
  const root = createScope();
  const cause = new Error("getter-failure");
  let flight: Promise<unknown> | undefined;
  let cleaned = false;
  expect(() => {
    flight = root.session((s) => {
      s.onClose(() => {
        cleaned = true;
      });
      return {
        get then(): never {
          throw cause;
        },
      };
    });
  }).not.toThrow();
  await expect(flight).rejects.toBe(cause);
  expect(cleaned).toBe(true);
  await root.close();
});

test("a then getter is read once: the body value is the first read's", async () => {
  const root = createScope();
  let reads = 0;
  const value = await root.session((): unknown => ({
    get then() {
      const n = ++reads;
      return (resolve: (v: number) => void) => resolve(n);
    },
  }));
  expect(value).toBe(1);
  await root.close();
});

test("a then getter usable once still succeeds", async () => {
  const root = createScope();
  let reads = 0;
  const value = await root.session((): unknown => ({
    get then() {
      if (++reads > 1) throw new Error("second-read");
      return (resolve: (v: number) => void) => resolve(1);
    },
  }));
  expect(value).toBe(1);
  await root.close();
});

for (const named of [false, true]) {
  test(`a watcher registered by the body sees an immediate parent write: ns=${named}`, async () => {
    const root = createScope();
    const cell = data({ label: "cell", initial: 0 });
    const options = named ? { ns: namespace() } : undefined;
    const seen: [unknown, unknown][] = [];
    const flight = root.session((s) => {
      s.controller(cell, options).watch((v, p) => {
        seen.push([v, p]);
      });
    });
    root.controller(cell, options).set(1);
    await flight;
    expect(seen).toEqual([[1, 0]]);
    await root.close();
  });
}

/** The rule since 2026-09-29: a session's handle closes when its body ends, like a database
 * transaction callback. A handle the body leaked is disposed once the body returned. */
function disposed(fn: () => unknown): boolean {
  try {
    fn();
  } catch (error) {
    if (!isError(error, "Disposed")) throw error;
    return true;
  }
  return false;
}

test("a leaked handle is disposed once the body returned: onClose raises Disposed", async () => {
  const root = createScope();
  let child: ReturnType<typeof root.createSession> | undefined;
  let cleaned = false;
  const flight = root.session((s) => {
    child = s;
  });
  expect(
    disposed(() =>
      child!.onClose(() => {
        cleaned = true;
      }),
    ),
  ).toBe(true);
  await flight;
  expect(cleaned).toBe(false);
  await root.close();
});

test("a leaked handle is disposed once the body returned: resolve raises Disposed", async () => {
  const root = createScope();
  const cell = data({ label: "cell", initial: 0 });
  let child: ReturnType<typeof root.createSession> | undefined;
  const flight = root.session((s) => {
    child = s;
    s.controller(cell).set(9);
  });
  expect(disposed(() => child!.resolve(cell))).toBe(true);
  await flight;
  await root.close();
});

test("close({ withData: true }) keeps the data inside the body, and gets none after it", async () => {
  const root = createScope();
  const cell = data({ label: "cell", initial: 0 });
  /** Graceful: a forced close of its own session inside the body settles it cancelled, on main
   * as here. */
  const inside = await root.session((s) => {
    s.controller(cell).set(9);
    return s.close({ graceful: true, withData: true });
  });
  expect(inside.status).toBe("success");
  expect(inside.data?.get(cell)).toEqual({ present: true, value: 9 });
  let child: ReturnType<typeof root.createSession> | undefined;
  const flight = root.session((s) => {
    child = s;
    s.controller(cell).set(9);
  });
  const after = await child!.close({ withData: true });
  await flight;
  expect(after.status).toBe("success");
  expect(after.data).toBeUndefined();
  await root.close();
});

test("a parent's forced close requested inside a sync body cancels the session", async () => {
  const root = createScope();
  let closing: ReturnType<typeof root.close> | undefined;
  const flight = root.session(() => {
    closing = root.close();
    return 7;
  });
  const end = await closing!;
  await expect(flight).rejects.toBe((end as { reason: unknown }).reason);
});

test("a late close of a session that ended in place gets a Result of its own", async () => {
  const root = createScope();
  let first: ReturnType<typeof root.createSession> | undefined;
  let second: ReturnType<typeof root.createSession> | undefined;
  await root.session((s) => {
    first = s;
  });
  await root.session((s) => {
    second = s;
  });
  const a = await first!.close();
  const b = await second!.close();
  expect(a).toEqual({ status: "success", teardownErrors: undefined });
  expect(b).toEqual(a);
  expect(b).not.toBe(a);
  (a as { status: string }).status = "changed";
  expect((await second!.close()).status).toBe("success");
  await root.close();
});
