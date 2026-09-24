import { expect, test } from "vite-plus/test";
import { createScope, operation } from "../src/index.ts";

const hostTimer = globalThis.setTimeout;

function bounded<T>(work: Promise<T>): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_resolve, reject) => {
      hostTimer(() => reject(new Error("close did not settle")), 150);
    }),
  ]);
}

for (const graceful of [true, false]) {
  test(`${graceful ? "graceful" : "forced"} close does not join a never-ending then callback`, async () => {
    const sub = operation({
      label: "sub",
      run: async () => {
        await new Promise<void>((resolve) => hostTimer(resolve, 2));
        return 1;
      },
    });
    const outer = operation({
      label: "outer",
      depends: { sub },
      run: async ({ sub }) => {
        void sub.run().then(() => new Promise<never>(() => undefined));
        return "x";
      },
    });
    const root = createScope();
    const session = root.createSession();
    expect(await session.run(outer)).toBe("x");
    const result = await bounded(session.close(graceful ? { graceful: true } : undefined));
    expect(result.status).toBe(graceful ? "success" : "cancelled");
    await root.close({ graceful: true });
  });

  test(`${graceful ? "graceful" : "forced"} close does not join a never-ending catch callback`, async () => {
    const cause = new Error("sub failed");
    const sub = operation({
      label: "sub",
      run: async () => {
        await new Promise<void>((resolve) => hostTimer(resolve, 2));
        throw cause;
      },
    });
    const outer = operation({
      label: "outer",
      depends: { sub },
      run: async ({ sub }) => {
        void sub.run().catch(() => new Promise<never>(() => undefined));
        return "x";
      },
    });
    const root = createScope();
    const session = root.createSession();
    expect(await session.run(outer)).toBe("x");
    expect(await bounded(session.close(graceful ? { graceful: true } : undefined))).toMatchObject({
      status: "failed",
      error: cause,
    });
    await root.close({ graceful: true });
  });
}

test("two fulfillment-only handlers pass the original subflow failure on", async () => {
  const cause = new Error("sub failed");
  const sub = operation({
    label: "sub",
    run: async () => {
      throw cause;
    },
  });
  const outer = operation({
    label: "outer",
    depends: { sub },
    run: ({ sub }) => {
      void sub
        .run()
        .then(() => undefined)
        .then(() => undefined);
      return "x";
    },
  });
  const root = createScope();
  const session = root.createSession();
  expect(session.run(outer)).toBe("x");
  expect(await bounded(session.close({ graceful: true }))).toMatchObject({
    status: "failed",
    error: cause,
  });
  await root.close({ graceful: true });
});

test("a catch that rethrows the subflow error still fails the session", async () => {
  const cause = new Error("sub failed");
  const sub = operation({
    label: "sub",
    run: async () => {
      throw cause;
    },
  });
  const outer = operation({
    label: "outer",
    depends: { sub },
    run: ({ sub }) => {
      void sub.run().catch((error: unknown) => {
        throw error;
      });
      return "x";
    },
  });
  const root = createScope();
  const session = root.createSession();
  expect(session.run(outer)).toBe("x");
  expect(await bounded(session.close({ graceful: true }))).toMatchObject({
    status: "failed",
    error: cause,
  });
  await root.close({ graceful: true });
});

test("an error thrown by a fulfillment handler fails the session with that error", async () => {
  const cause = new Error("handler failed");
  const sub = operation({ label: "sub", run: async () => 1 });
  const outer = operation({
    label: "outer",
    depends: { sub },
    run: ({ sub }) => {
      void sub.run().then(() => {
        throw cause;
      });
      return "x";
    },
  });
  const root = createScope();
  const session = root.createSession();
  expect(session.run(outer)).toBe("x");
  expect(await bounded(session.close({ graceful: true }))).toMatchObject({
    status: "failed",
    error: cause,
  });
  await root.close({ graceful: true });
});

test("a caller awaiting finally can catch the original subflow error", async () => {
  const cause = new Error("sub failed");
  const sub = operation({
    label: "sub",
    run: async () => {
      throw cause;
    },
  });
  const outer = operation({
    label: "outer",
    depends: { sub },
    run: async ({ sub }) => {
      try {
        await sub.run().finally(() => undefined);
      } catch (error) {
        if (error !== cause) throw error;
      }
      return "caught";
    },
  });
  const root = createScope();
  const session = root.createSession();
  expect(await session.run(outer)).toBe("caught");
  expect((await bounded(session.close({ graceful: true }))).status).toBe("success");
  await root.close({ graceful: true });
});

test("a derived rejection after its session closes fails its still-open root", async () => {
  const cause = new Error("late callback");
  let reject!: (cause: Error) => void;
  const gate = new Promise<never>((_resolve, fail) => {
    reject = fail;
  });
  const sub = operation({ label: "sub", run: async () => 1 });
  const outer = operation({
    label: "outer",
    depends: { sub },
    run: ({ sub }) => {
      void sub.run().then(() => gate);
      return "x";
    },
  });
  const root = createScope();
  const session = root.createSession();
  expect(session.run(outer)).toBe("x");
  expect((await bounded(session.close({ graceful: true }))).status).toBe("success");
  reject(cause);
  await new Promise<void>((resolve) => hostTimer(resolve, 10));
  expect(await root.close({ graceful: true })).toMatchObject({ status: "failed", error: cause });
});
