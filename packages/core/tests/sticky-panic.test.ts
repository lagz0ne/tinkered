import { expect, test } from "vite-plus/test";
import { createScope, operation, resource, tag } from "../src/index.ts";

const zone = tag<string>({ label: "zone" });

function catching(sub: { run(): unknown }, cause: unknown): Promise<string> {
  return Promise.resolve()
    .then(() => sub.run())
    .then(
      () => "ran",
      (error: unknown) => {
        if (error !== cause) throw error;
        return "caught";
      },
    );
}

test("a panic caught with try/catch still fails its layer", async () => {
  const cause = new Error("bug");
  const inner = operation({
    label: "inner",
    run: async () => {
      throw cause;
    },
  });
  const outer = operation({
    label: "outer",
    depends: { inner },
    run: ({ inner }) => catching(inner, cause),
  });
  const root = createScope();
  const session = root.createSession();
  expect(await session.run(outer)).toBe("caught");
  expect(await session.close({ graceful: true })).toEqual({
    status: "failed",
    error: cause,
    origin: { label: "inner", path: ["inner"] },
    teardownErrors: undefined,
  });
  await root.close({ graceful: true });
});

test("a panic received through settle leaves its layer successful", async () => {
  const cause = new Error("bug");
  const inner = operation({
    label: "inner",
    run: async () => {
      throw cause;
    },
  });
  const outer = operation({
    label: "outer",
    depends: { inner },
    run: async ({ inner }) => (await inner.settle()).status,
  });
  const root = createScope();
  const session = root.createSession();
  expect(await session.run(outer)).toBe("failed");
  expect((await session.close({ graceful: true })).status).toBe("success");
  await root.close({ graceful: true });
});

test("settle recovers a panic that a nested subflow threw", async () => {
  const cause = new Error("deep bug");
  const leaf = operation({
    label: "leaf",
    run: () => {
      throw cause;
    },
  });
  const mid = operation({ label: "mid", depends: { leaf }, run: ({ leaf }) => leaf.run() });
  const scope = createScope();
  expect(scope.settle(mid)).toMatchObject({ status: "failed", kind: "panic", error: cause });
  expect((await scope.close({ graceful: true })).status).toBe("success");
});

test("settle recovers a panic carried as the cause of the error it receives", async () => {
  const cause = new Error("bug");
  const leaf = operation({
    label: "leaf",
    run: () => {
      throw cause;
    },
  });
  const mid = operation({
    label: "mid",
    depends: { leaf },
    run: ({ leaf }) => {
      try {
        return leaf.run();
      } catch (error) {
        throw new Error("wrapped", { cause: error });
      }
    },
  });
  const scope = createScope();
  expect(scope.settle(mid)).toMatchObject({ status: "failed", kind: "panic" });
  expect((await scope.close({ graceful: true })).status).toBe("success");
});

test("a panic swallowed inside a settled run still fails the layer", async () => {
  const cause = new Error("swallowed");
  const leaf = operation({
    label: "leaf",
    run: () => {
      throw cause;
    },
  });
  const mid = operation({
    label: "mid",
    depends: { leaf },
    run: ({ leaf }) => {
      try {
        leaf.run();
      } catch (error) {
        if (error !== cause) throw error;
      }
      return "swallowed";
    },
  });
  const scope = createScope();
  expect(scope.settle(mid)).toEqual({ status: "success", value: "swallowed" });
  expect(await scope.close({ graceful: true })).toMatchObject({ status: "failed", error: cause });
});

test("settle recovers only the panic it receives, not one swallowed earlier", async () => {
  const swallowed = new Error("swallowed");
  const received = new Error("received");
  const leaf = operation({
    label: "leaf",
    run: () => {
      throw swallowed;
    },
  });
  const scope = createScope();
  const kept = scope.run({
    depends: { leaf },
    run: ({ leaf }) => {
      try {
        leaf.run();
      } catch (error) {
        if (error !== swallowed) throw error;
      }
      return "kept";
    },
  });
  expect(kept).toBe("kept");
  const settled = scope.settle({
    run: () => {
      throw received;
    },
  });
  expect(settled).toMatchObject({ status: "failed", error: received });
  expect(await scope.close({ graceful: true })).toMatchObject({
    status: "failed",
    error: swallowed,
  });
});

test("a caught panic after an earlier failure leaves the first failure as the layer's error", async () => {
  const first = new Error("build failed");
  const later = new Error("later bug");
  const broken = resource({
    label: "broken",
    factory: async () => {
      throw first;
    },
  });
  const scope = createScope();
  await expect(scope.resolve(broken)).rejects.toBe(first);
  expect(() =>
    scope.run({
      run: () => {
        throw later;
      },
    }),
  ).toThrow(later);
  expect(await scope.close({ graceful: true })).toMatchObject({ status: "failed", error: first });
});

test("a managed error caught with try/catch leaves its layer successful", async () => {
  const cause = Object.assign(new Error("missing"), { kind: "Missing", payload: { id: 7 } });
  const inner = operation({
    label: "inner",
    run: () => {
      throw cause;
    },
  });
  const outer = operation({
    label: "outer",
    depends: { inner },
    run: ({ inner }) => {
      try {
        inner.run();
      } catch (error) {
        if (error !== cause) throw error;
      }
      return "handled";
    },
  });
  const root = createScope();
  const session = root.createSession();
  expect(session.run(outer)).toBe("handled");
  expect((await session.close({ graceful: true })).status).toBe("success");
  await root.close({ graceful: true });
});

test("a caught panic in a session run fails that session and not its parent", async () => {
  const cause = new Error("session bug");
  const op = operation({
    label: "op",
    run: async () => {
      throw cause;
    },
  });
  const root = createScope();
  const session = root.createSession();
  await expect(session.run(op)).rejects.toBe(cause);
  expect(await session.close({ graceful: true })).toMatchObject({ status: "failed", error: cause });
  expect((await root.close({ graceful: true })).status).toBe("success");
});

test("a caught panic in an inline run fails the scope it ran in", async () => {
  const cause = new Error("inline bug");
  const scope = createScope();
  expect(() =>
    scope.run({
      label: "inline",
      run: () => {
        throw cause;
      },
    }),
  ).toThrow(cause);
  expect(await scope.close({ graceful: true })).toEqual({
    status: "failed",
    error: cause,
    origin: { label: "inline", path: ["inline"] },
    teardownErrors: undefined,
  });
});

test("a panic caught inside a tagged run fails the run's own session", async () => {
  const cause = new Error("tagged bug");
  const inner = operation({
    label: "inner",
    run: async () => {
      throw cause;
    },
  });
  const outer = operation({
    label: "outer",
    depends: { inner },
    run: ({ inner }) => catching(inner, cause),
  });
  const root = createScope();
  await expect(root.run(outer, { tags: zone("x") })).rejects.toBe(cause);
  expect((await root.close({ graceful: true })).status).toBe("success");
});

test("a tagged subflow's panic fails its caller's layer even when the caller catches it", async () => {
  const cause = new Error("tagged subflow bug");
  const inner = operation({
    label: "inner",
    run: async () => {
      throw cause;
    },
  });
  const outer = operation({
    label: "outer",
    depends: { inner },
    run: ({ inner }) =>
      inner.run({ tags: zone("x") }).then(
        () => "ran",
        (error: unknown) => {
          if (error !== cause) throw error;
          return "caught";
        },
      ),
  });
  const root = createScope();
  const session = root.createSession();
  expect(await session.run(outer)).toBe("caught");
  expect(await session.close({ graceful: true })).toMatchObject({ status: "failed", error: cause });
  await root.close({ graceful: true });
});

test("a forced close after a caught panic settles failed, not cancelled", async () => {
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
    depends: { inner },
    run: async ({ inner }, { signal }) => {
      await catching(inner, cause);
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        started();
      });
    },
  });
  const root = createScope();
  const session = root.createSession();
  const running = session.run(outer).then(
    () => false,
    () => true,
  );
  await ready;
  const closing = session.close();
  expect(await running).toBe(true);
  expect(await closing).toMatchObject({ status: "failed", error: cause });
  await root.close();
});
