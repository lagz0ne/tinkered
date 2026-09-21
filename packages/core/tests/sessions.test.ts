import { expect, test } from "vite-plus/test";
import { createScope, extension, isError, resource } from "../src/index.ts";

test("a session hook that throws before next still lets the body run and rethrows the hook error", async () => {
  const boom = new Error("sync-hook-boom");
  let ran = false;
  const bad = extension({
    label: "bad",
    session: () => {
      throw boom;
    },
  });
  const scope = createScope({ extensions: [bad] });
  await scope.ready;
  const thrown = await scope
    .session(() => {
      ran = true;
      return 1;
    })
    .then(
      () => undefined,
      (error: unknown) => error,
    );
  expect(ran).toBe(true);
  expect(thrown).toBe(boom);
  await scope.close();
});

test("two session hooks see each ordered end in turn", async () => {
  const order: string[] = [];
  const track = (label: string) =>
    extension({
      label,
      session: async (_handle, next) => {
        const ended = await next();
        order.push(`${label}:${ended.status}`);
        return ended;
      },
    });
  const scope = createScope({ extensions: [track("one"), track("two")] });
  await scope.ready;
  await scope.session(() => 7);
  expect(order).toEqual(["two:success", "one:success"]);
  await scope.close();
});

test("a body that rejects inside session fails the close with its cause", async () => {
  const cause = new Error("session-body-boom");
  const thrown = await createScope()
    .session(() => Promise.reject(cause))
    .then(
      () => undefined,
      (error: unknown) => error,
    );
  expect(thrown).toBe(cause);
});

test("a session body that throws sync rejects the session with its cause", async () => {
  const cause = new Error("sync-body-boom");
  const thrown = await createScope()
    .session((): number => {
      throw cause;
    })
    .then(
      () => undefined,
      (error: unknown) => error,
    );
  expect(thrown).toBe(cause);
});

test("a cancelled session rejects with its reason", async () => {
  const scope = createScope();
  const child = scope.createSession();
  const pending = child.close();
  const result = await pending;
  expect(result.status).toBe("cancelled");
  await scope.close();
});

test("a failing teardown inside session still reports the body failure", async () => {
  const bodyCause = new Error("body-fails");
  const cleanup = new Error("cleanup-fails");
  const leaky = resource({
    label: "leaky",
    target: "session",
    factory: (_deps, { defer }) => {
      defer(() => {
        throw cleanup;
      });
      return 1;
    },
  });
  const thrown = await createScope()
    .session((s) => {
      s.resolve(leaky);
      throw bodyCause;
    })
    .then(
      () => undefined,
      (error: unknown) => error,
    );
  if (!isError(thrown, "TeardownFailed")) throw thrown;
  expect(thrown.payload.causes).toContain(bodyCause);
  expect(thrown.payload.causes).toContain(cleanup);
});
