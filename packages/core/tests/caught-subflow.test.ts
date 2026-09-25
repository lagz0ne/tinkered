import { expect, test } from "vite-plus/test";
import { createScope, operation, tag, type Observe } from "../src/index.ts";

for (const kind of ["scope", "session"] as const) {
  for (const tagged of [false, true]) {
    test(`${kind} ${tagged ? "tagged" : "untagged"} run resolves when its caller catches a failed subflow`, async () => {
      const zone = tag<string>({ label: "zone" });
      const cause = new Error("inner boom");
      const inner = operation({
        label: "inner",
        run: async () => {
          throw cause;
        },
      });
      const outer = operation({
        label: "outer",
        depends: { sub: inner },
        run: async ({ sub }) => {
          try {
            await sub.run();
          } catch (error) {
            if (error !== cause) throw error;
          }
          return "caught";
        },
      });
      const root = createScope();
      const scope = kind === "scope" ? root : root.createSession();
      expect(await scope.run(outer, tagged ? { tags: [zone("x")] } : undefined)).toBe("caught");
      expect((await scope.close({ graceful: true })).status).toBe("success");
      if (kind === "session") await root.close({ graceful: true });
    });
  }
}

test("a graceful parent close keeps success when a running tagged subflow is caught", async () => {
  const zone = tag<string>({ label: "zone" });
  const cause = new Error("tagged boom");
  let started!: () => void;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const inner = operation({
    label: "inner",
    run: async () => {
      started();
      await gate;
      throw cause;
    },
  });
  const outer = operation({
    label: "outer",
    depends: { sub: inner },
    run: async ({ sub }) => {
      try {
        await sub.run({ tags: [zone("x")] });
      } catch (error) {
        if (error !== cause) throw error;
      }
      return "caught";
    },
  });
  const root = createScope();
  const session = root.createSession();
  const running = session.run(outer);
  await ready;
  const closing = session.close({ graceful: true });
  release();
  expect(await running).toBe("caught");
  expect((await closing).status).toBe("success");
  await root.close({ graceful: true });
});

test("a subflow failure that escapes its caller fails the session", async () => {
  const cause = new Error("inner boom");
  const inner = operation({
    label: "inner",
    run: async () => {
      throw cause;
    },
  });
  const outer = operation({
    label: "outer",
    depends: { sub: inner },
    run: async ({ sub }) => sub.run(),
  });
  const root = createScope();
  const session = root.createSession();
  await expect(session.run(outer)).rejects.toBe(cause);
  expect(await session.close({ graceful: true })).toEqual({
    status: "failed",
    error: cause,
    teardownErrors: undefined,
  });
  await root.close({ graceful: true });
});

test("an unreceived subflow that fails after its caller returns fails the session", async () => {
  const cause = new Error("late boom");
  let fail!: (error: Error) => void;
  const gate = new Promise<never>((_resolve, reject) => {
    fail = reject;
  });
  const inner = operation({ label: "inner", run: () => gate });
  const outer = operation({
    label: "outer",
    depends: { sub: inner },
    run: ({ sub }) => {
      void sub.run();
      return "returned";
    },
  });
  const root = createScope();
  const session = root.createSession();
  expect(session.run(outer)).toBe("returned");
  const closing = session.close({ graceful: true });
  fail(cause);
  expect(await closing).toEqual({ status: "failed", error: cause, teardownErrors: undefined });
  await root.close({ graceful: true });
});

test("a subflow failure while its caller runs stays with that caller", async () => {
  const cause = new Error("panic");
  let fail!: (error: Error) => void;
  let finish!: () => void;
  const innerGate = new Promise<never>((_resolve, reject) => {
    fail = reject;
  });
  const outerGate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const inner = operation({ label: "inner", run: () => innerGate });
  const outer = operation({
    label: "outer",
    depends: { sub: inner },
    run: async ({ sub }) => {
      void sub.run();
      await outerGate;
      return "done";
    },
  });
  const spans: Observe.Span[] = [];
  const root = createScope({ observe: { export: (span) => void spans.push(span) } });
  const session = root.createSession();
  const running = session.run(outer);
  const closing = session.close({ graceful: true });
  fail(cause);
  await new Promise<void>((resolve) => setImmediate(resolve));
  finish();
  expect(await running).toBe("done");
  expect((await closing).status).toBe("success");
  expect(spans.find((span) => span.name === "inner")).toMatchObject({
    status: "failed",
    error: cause,
  });
  await root.close({ graceful: true });
});

test("an awaited subflow catch leaves the session successful", async () => {
  const cause = new Error("received");
  const inner = operation({
    label: "inner",
    run: async () => {
      throw cause;
    },
  });
  const outer = operation({
    label: "outer",
    depends: { sub: inner },
    run: async ({ sub }) => {
      await sub.run().catch((error: unknown) => {
        if (error !== cause) throw error;
      });
      return "done";
    },
  });
  const root = createScope();
  const session = root.createSession();
  expect(await session.run(outer)).toBe("done");
  expect((await session.close({ graceful: true })).status).toBe("success");
  await root.close({ graceful: true });
});

test("catch after finally receives the subflow error", async () => {
  const cause = new Error("finally received");
  const inner = operation({
    label: "inner",
    run: async () => {
      throw cause;
    },
  });
  const outer = operation({
    label: "outer",
    depends: { sub: inner },
    run: async ({ sub }) => {
      await sub
        .run()
        .finally(() => undefined)
        .catch((error: unknown) => {
          if (error !== cause) throw error;
        });
      return "done";
    },
  });
  const root = createScope();
  const session = root.createSession();
  expect(await session.run(outer)).toBe("done");
  expect((await session.close({ graceful: true })).status).toBe("success");
  await root.close({ graceful: true });
});

test("a then rejection handler receives the subflow error", async () => {
  const cause = new Error("then received");
  const inner = operation({
    label: "inner",
    run: async () => {
      throw cause;
    },
  });
  const outer = operation({
    label: "outer",
    depends: { sub: inner },
    run: async ({ sub }) => {
      await sub.run().then(
        () => undefined,
        (error: unknown) => {
          if (error !== cause) throw error;
        },
      );
      return "done";
    },
  });
  const root = createScope();
  const session = root.createSession();
  expect(await session.run(outer)).toBe("done");
  expect((await session.close({ graceful: true })).status).toBe("success");
  await root.close({ graceful: true });
});

test("an awaited catch after fulfillment-only then receives the subflow error", async () => {
  const cause = new Error("chained received");
  const inner = operation({
    label: "inner",
    run: async () => {
      throw cause;
    },
  });
  const outer = operation({
    label: "outer",
    depends: { sub: inner },
    run: async ({ sub }) => {
      await sub
        .run()
        .then(() => undefined)
        .catch((error: unknown) => {
          if (error !== cause) throw error;
        });
      return "done";
    },
  });
  const root = createScope();
  const session = root.createSession();
  expect(await session.run(outer)).toBe("done");
  expect((await session.close({ graceful: true })).status).toBe("success");
  await root.close({ graceful: true });
});

test("a subflow failure caught in an operation defer does not fail the session", async () => {
  const cause = new Error("deferred");
  const inner = operation({
    label: "inner",
    run: async () => {
      throw cause;
    },
  });
  const outer = operation({
    label: "outer",
    depends: { sub: inner },
    run: ({ sub }, { defer }) => {
      defer(async () => {
        try {
          await sub.run();
        } catch (error) {
          if (error !== cause) throw error;
        }
      });
      return "done";
    },
  });
  const root = createScope();
  const session = root.createSession();
  expect(session.run(outer)).toBe("done");
  expect((await session.close({ graceful: true })).status).toBe("success");
  await root.close({ graceful: true });
});

test("a returned subflow result received by an outer caller does not fail the session", async () => {
  const cause = new Error("returned");
  const inner = operation({
    label: "inner",
    run: async () => {
      throw cause;
    },
  });
  const mid = operation({ label: "mid", depends: { sub: inner }, run: ({ sub }) => sub.run() });
  const outer = operation({
    label: "outer",
    depends: { mid },
    run: async ({ mid }) => {
      try {
        await mid.run();
      } catch (error) {
        if (error !== cause) throw error;
      }
      return "caught";
    },
  });
  const root = createScope();
  const session = root.createSession();
  expect(await session.run(outer)).toBe("caught");
  expect((await session.close({ graceful: true })).status).toBe("success");
  await root.close({ graceful: true });
});

test("Promise.all receives both subflow errors when its caller catches them", async () => {
  const cause = new Error("all");
  const a = operation({
    label: "a",
    run: async () => {
      throw cause;
    },
  });
  const b = operation({
    label: "b",
    run: async () => {
      throw cause;
    },
  });
  const outer = operation({
    label: "outer",
    depends: { a, b },
    run: async ({ a, b }) => {
      try {
        await Promise.all([a.run(), b.run()]);
      } catch (error) {
        if (error !== cause) throw error;
      }
      return "caught";
    },
  });
  const root = createScope();
  const session = root.createSession();
  expect(await session.run(outer)).toBe("caught");
  expect((await session.close({ graceful: true })).status).toBe("success");
  await root.close({ graceful: true });
});

test("a handler attached by a later timer cannot undo an unreceived failure", async () => {
  const cause = new Error("late handler");
  let fail!: (error: Error) => void;
  let returned!: Promise<never>;
  const gate = new Promise<never>((_resolve, reject) => {
    fail = reject;
  });
  const inner = operation({ label: "inner", run: () => gate });
  const outer = operation({
    label: "outer",
    depends: { sub: inner },
    run: ({ sub }) => {
      returned = sub.run();
      return "done";
    },
  });
  const root = createScope();
  const session = root.createSession();
  expect(session.run(outer)).toBe("done");
  const closing = session.close({ graceful: true });
  fail(cause);
  await Promise.resolve();
  const later = new Promise<void>((resolve) =>
    setTimeout(() => {
      returned.catch(() => undefined);
      resolve();
    }, 0),
  );
  expect((await closing).status).toBe("failed");
  await later;
  await root.close({ graceful: true });
});

test("a caught subflow closes its own span failed and its caller span ok", async () => {
  const cause = new Error("inner boom");
  const inner = operation({
    label: "inner",
    run: async () => {
      throw cause;
    },
  });
  const outer = operation({
    label: "outer",
    depends: { sub: inner },
    run: async ({ sub }) => {
      try {
        await sub.run();
      } catch (error) {
        if (error !== cause) throw error;
      }
      return "caught";
    },
  });
  const spans: Observe.Span[] = [];
  const scope = createScope({ observe: { export: (span) => void spans.push(span) } });
  expect(await scope.run(outer)).toBe("caught");
  expect(spans.map((span) => [span.name, span.status])).toEqual([
    ["inner", "failed"],
    ["outer", "ok"],
  ]);
  expect(spans.find((span) => span.name === "inner")?.error).toBe(cause);
  await scope.close({ graceful: true });
});

test("a forced close after a caught real subflow failure cancels the session", async () => {
  const cause = new Error("real");
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const inner = operation({
    label: "inner",
    run: async () => {
      throw cause;
    },
  });
  const outer = operation({
    label: "outer",
    depends: { sub: inner },
    run: async ({ sub }, { signal }) => {
      try {
        await sub.run();
      } catch (error) {
        if (error !== cause) throw error;
      }
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        started();
      });
    },
  });
  const root = createScope();
  const session = root.createSession();
  const running = session.run(outer);
  await ready;
  const interrupted = running.then(
    () => false,
    () => true,
  );
  const closing = session.close();
  expect(await interrupted).toBe(true);
  expect((await closing).status).toBe("cancelled");
  await root.close();
});

test("a controller subflow caught by its caller leaves the session successful", async () => {
  const cause = new Error("controller child");
  const inner = operation({
    label: "inner",
    run: async () => {
      throw cause;
    },
  });
  const outer = operation({
    label: "outer",
    depends: { sub: inner.controller },
    run: async ({ sub }) => {
      try {
        await sub.run();
      } catch (error) {
        if (error !== cause) throw error;
      }
      return "caught";
    },
  });
  const root = createScope();
  const session = root.createSession();
  expect(await session.run(outer)).toBe("caught");
  expect((await session.close({ graceful: true })).status).toBe("success");
  await root.close({ graceful: true });
});

test("an unreceived controller subflow fails its session", async () => {
  const cause = new Error("controller panic");
  const inner = operation({
    label: "inner",
    run: async () => {
      throw cause;
    },
  });
  const outer = operation({
    label: "outer",
    depends: { sub: inner.controller },
    run: ({ sub }) => {
      void sub.run();
      return "done";
    },
  });
  const root = createScope();
  const session = root.createSession();
  expect(session.run(outer)).toBe("done");
  expect(await session.close({ graceful: true })).toMatchObject({ status: "failed", error: cause });
  await root.close({ graceful: true });
});

test("an unreceived tagged subflow fails its parent session", async () => {
  const zone = tag<string>({ label: "zone" });
  const cause = new Error("tagged panic");
  const inner = operation({
    label: "inner",
    run: async () => {
      throw cause;
    },
  });
  const outer = operation({
    label: "outer",
    depends: { sub: inner },
    run: ({ sub }) => {
      void sub.run({ tags: [zone("x")] });
      return "done";
    },
  });
  const root = createScope();
  const session = root.createSession();
  expect(session.run(outer)).toBe("done");
  expect(await session.close({ graceful: true })).toMatchObject({ status: "failed", error: cause });
  await root.close({ graceful: true });
});

test("a catch after its caller returns does not undo an orphan failure", async () => {
  const cause = new Error("handed off");
  let fail!: (error: Error) => void;
  const gate = new Promise<never>((_resolve, reject) => {
    fail = reject;
  });
  const inner = operation({ label: "inner", run: () => gate });
  const outer = operation({
    label: "outer",
    depends: { sub: inner },
    run: ({ sub }) => {
      sub
        .run()
        .then(() => undefined)
        .catch((error: unknown) => {
          if (error !== cause) throw error;
        });
      return "done";
    },
  });
  const root = createScope();
  const session = root.createSession();
  expect(session.run(outer)).toBe("done");
  const closing = session.close({ graceful: true });
  fail(cause);
  expect(await closing).toMatchObject({ status: "failed", error: cause });
  await root.close({ graceful: true });
});

test("an orphan reports the original failure once", async () => {
  const cause = new Error("one panic");
  const spans: Observe.Span[] = [];
  const inner = operation({
    label: "inner",
    run: async () => {
      throw cause;
    },
  });
  const outer = operation({
    label: "outer",
    depends: { sub: inner },
    run: ({ sub }) => {
      void sub.run();
      return "done";
    },
  });
  const root = createScope({ observe: { export: (span) => void spans.push(span) } });
  const session = root.createSession();
  expect(session.run(outer)).toBe("done");
  expect(await session.close({ graceful: true })).toMatchObject({ status: "failed", error: cause });
  expect(spans.filter((span) => span.status === "failed").map((span) => span.error)).toEqual([
    cause,
  ]);
  await root.close({ graceful: true });
});

test("an async subflow that succeeds exports an ok span", async () => {
  const inner = operation({ label: "inner", run: async () => "inner value" });
  const outer = operation({
    label: "outer",
    depends: { sub: inner },
    run: async ({ sub }) => sub.run(),
  });
  const spans: Observe.Span[] = [];
  const root = createScope({ observe: { export: (span) => void spans.push(span) } });
  expect(await root.run(outer)).toBe("inner value");
  expect(spans.find((span) => span.name === "inner")?.status).toBe("ok");
  await root.close({ graceful: true });
});

test("a caught failure two subflows deep does not fail the session", async () => {
  const cause = new Error("leaf boom");
  const leaf = operation({
    label: "leaf",
    run: async () => {
      throw cause;
    },
  });
  const mid = operation({
    label: "mid",
    depends: { leaf },
    run: async ({ leaf }) => {
      try {
        await leaf.run();
      } catch (error) {
        if (error !== cause) throw error;
      }
      return "caught";
    },
  });
  const outer = operation({ label: "outer", depends: { mid }, run: async ({ mid }) => mid.run() });
  const root = createScope();
  const session = root.createSession();
  expect(await session.run(outer)).toBe("caught");
  expect((await session.close({ graceful: true })).status).toBe("success");
  await root.close({ graceful: true });
});
