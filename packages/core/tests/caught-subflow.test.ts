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

test("a subflow that fails after its caller returns still fails the session", async () => {
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
      sub.run().catch(() => undefined);
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
