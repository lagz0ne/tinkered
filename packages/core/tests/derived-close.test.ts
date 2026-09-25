import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test } from "vite-plus/test";
import { createScope, operation } from "../src/index.ts";

function managed(message: string): Error {
  return Object.assign(new Error(message), { kind: "Caught", payload: { message } });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

for (const graceful of [true, false]) {
  test(`${graceful ? "graceful" : "forced"} close does not join a never-ending then callback`, async () => {
    const { promise: gate, resolve: finish } = deferred<void>();
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
      run: async ({ sub }) => {
        void sub.run().then(() => new Promise<never>(() => undefined));
        return "x";
      },
    });
    const root = createScope();
    const session = root.createSession();
    expect(await session.run(outer)).toBe("x");
    const closing = session.close(graceful ? { graceful: true } : undefined);
    finish();
    expect((await closing).status).toBe(graceful ? "success" : "cancelled");
    await root.close({ graceful: true });
  });

  test(`${graceful ? "graceful" : "forced"} close reports an orphan without joining its never-ending catch callback`, async () => {
    const cause = new Error("sub failed");
    const { promise: gate, reject: fail } = deferred<never>();
    const sub = operation({ label: "sub", run: () => gate });
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
    const closing = session.close(graceful ? { graceful: true } : undefined);
    fail(cause);
    expect(await closing).toMatchObject({ status: "failed", error: cause });
    await root.close({ graceful: true });
  });
}

test("an awaited slow rejection handler receives a managed error while its gate is closed", async () => {
  const cause = managed("received");
  const { promise: inside, resolve: entered } = deferred<void>();
  const { promise: gate, resolve: release } = deferred<void>();
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
  release();
  expect(await running).toBe("caught");
  expect((await closing).status).toBe("success");
  await root.close({ graceful: true });
});

test("a caller awaiting finally can catch the original managed subflow error", async () => {
  const cause = managed("sub failed");
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
  expect((await session.close({ graceful: true })).status).toBe("success");
  await root.close({ graceful: true });
});

for (const owner of ["root", "session"]) {
  test(`a detached callback rejection after its ${owner} closes belongs to the host`, async () => {
    const entry = new URL("../src/index.ts", import.meta.url).href;
    const script = `
      import { createScope, operation } from ${JSON.stringify(entry)};
      const cause = new Error("host panic");
      const { promise: gate, reject: fail } = Promise.withResolvers();
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
      const scope = ${owner === "root" ? "root" : "root.createSession()"};
      if (scope.run(outer) !== "done") throw new Error("run did not return");
      const ended = await scope.close({ graceful: true });
      if (ended.status !== "success") throw new Error("scope did not close");
      fail(cause);
      await new Promise(setImmediate);
      if ((await root.close({ graceful: true })).status !== "success")
        throw new Error("callback failed the root");
    `;
    const { stdout } = await promisify(execFile)(process.execPath, [
      "--input-type=module",
      "-e",
      script,
    ]);
    expect(stdout.trim()).toBe(JSON.stringify({ count: 1, message: "host panic" }));
  });
}

test("an async subflow returns a native promise that Promise.resolve keeps", async () => {
  const sub = operation({ label: "sub", run: async () => 1 });
  const outer = operation({ label: "outer", depends: { sub }, run: ({ sub }) => sub.run() });
  const scope = createScope();
  const result = scope.run(outer);
  expect(Promise.resolve(result)).toBe(result);
  await result;
  await scope.close({ graceful: true });
});
