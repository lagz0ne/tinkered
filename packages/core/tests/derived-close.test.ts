import { execFile } from "node:child_process";
import { promisify } from "node:util";
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
    expect((await bounded(session.close(graceful ? { graceful: true } : undefined))).status).toBe(
      graceful ? "success" : "cancelled",
    );
    await root.close({ graceful: true });
  });
}

test("an awaited slow rejection handler receives the error while its gate is closed", async () => {
  const cause = new Error("received");
  let entered!: () => void;
  let release!: () => void;
  const inside = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
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
      await sub.run().catch(async (error: unknown) => {
        if (error !== cause) throw error;
        entered();
        await gate;
      });
      return "caught";
    },
  });
  const root = createScope();
  const session = root.createSession();
  const running = session.run(outer);
  await inside;
  const closing = session.close({ graceful: true });
  await new Promise<void>((resolve) => hostTimer(resolve, 10));
  release();
  expect(await bounded(running)).toBe("caught");
  expect((await bounded(closing)).status).toBe("success");
  await root.close({ graceful: true });
});

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

test("close waits for a handed-off success to report its failed callback", async () => {
  const cause = new Error("callback panic");
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const sub = operation({
    label: "sub",
    run: async () => {
      await gate;
      return 1;
    },
  });
  const outer = operation({
    label: "outer",
    depends: { sub },
    run: ({ sub }) => {
      void sub.run().then(() => {
        throw cause;
      });
      return "done";
    },
  });
  const root = createScope();
  const session = root.createSession();
  expect(session.run(outer)).toBe("done");
  const closing = session.close({ graceful: true });
  finish();
  expect(await bounded(closing)).toMatchObject({ status: "failed", error: cause });
  await root.close({ graceful: true });
});

test("a derived rejection after the root closes reaches the host once", async () => {
  const script = `
    import { createScope, operation } from "@tinker/core";
    const cause = new Error("host panic");
    let rejectGate;
    const gate = new Promise((_resolve, reject) => { rejectGate = reject; });
    const sub = operation({ label: "sub", run: async () => 1 });
    const outer = operation({
      label: "outer",
      depends: { sub },
      run: ({ sub }) => {
        void sub.run().then(() => gate);
        return "done";
      },
    });
    let count = 0;
    process.on("unhandledRejection", (error) => {
      console.log(JSON.stringify({ count: ++count, message: error.message }));
    });
    const root = createScope();
    if (root.run(outer) !== "done") throw new Error("run did not return");
    const ended = await root.close({ graceful: true });
    if (ended.status !== "success") throw new Error("root did not close");
    rejectGate(cause);
  `;
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ["--input-type=module", "-e", script],
    {
      cwd: new URL("..", import.meta.url),
    },
  );
  expect(stdout.trim()).toBe(JSON.stringify({ count: 1, message: "host panic" }));
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
