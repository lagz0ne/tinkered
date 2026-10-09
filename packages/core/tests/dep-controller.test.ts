import { expect, test } from "vite-plus/test";
import { createScope, data, isError, operation } from "../src/index";

test("cell controller deps keep writes and watches across runs", async () => {
  const count = data({ label: "count", initial: 0 });
  const seen: number[] = [];
  const root = createScope();
  const listen = operation({
    label: "listen",
    depends: { count: count.controller },
    run: ({ count }) => count.watch((next) => seen.push(next)),
  });
  const increment = operation({
    label: "increment",
    depends: { count: count.controller },
    run: ({ count }) => count.update((previous) => previous + 1),
  });
  const unwatch = root.run(listen);
  root.run(increment);
  root.run(increment);
  unwatch();
  root.run(increment);
  expect(seen).toEqual([1, 2]);
  expect((await root.close({ graceful: true })).status).toBe("success");
});

test("a retained cell controller refuses to call its update function after close", async () => {
  const count = data({ label: "count", initial: 0 });
  const root = createScope();
  const getController = operation({
    label: "get controller",
    depends: { count: count.controller },
    run: ({ count }) => count,
  });
  const controller = root.run(getController);
  let updates = 0;
  expect((await root.close({ graceful: true })).status).toBe("success");
  try {
    controller.update(() => {
      updates++;
      return 1;
    });
    expect.unreachable("a closed scope must refuse an update");
  } catch (error) {
    if (!isError(error, "Disposed")) throw error;
    expect(error.payload.reason).toBe("scope is closed");
  }
  expect(updates).toBe(0);
});
