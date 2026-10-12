import { expect, test } from "vite-plus/test";
import { createScope, data, isError } from "../src/index";

const first = data({ label: "first", initial: 1 });
const second = data({ label: "second", initial: 2 });

test("a repeat controller read gives back the same controller, even after another target", async () => {
  const root = createScope();
  const one = root.controller(first);
  const two = root.controller(second);

  expect(one).not.toBe(two);
  expect(root.controller(first)).toBe(one);
  expect(root.controller(first)).toBe(one);
  expect(root.controller(second)).toBe(two);

  one.set(10);
  expect(root.controller(first).get()).toBe(10);
  expect((await root.close({ graceful: true })).status).toBe("success");
});

test("a session's repeat controller read stays apart from its root's", async () => {
  const root = createScope();
  const child = root.createSession();
  const up = root.controller(first);
  const down = child.controller(first);

  expect(down).not.toBe(up);
  expect(child.controller(first)).toBe(down);
  expect(root.controller(first)).toBe(up);
  expect((await child.close({ graceful: true })).status).toBe("success");
  expect((await root.close({ graceful: true })).status).toBe("success");
});

test("a controller read after close throws Disposed", async () => {
  const root = createScope();
  expect(root.controller(first)).toBe(root.controller(first));
  expect((await root.close({ graceful: true })).status).toBe("success");
  try {
    root.controller(first);
    expect.unreachable("a closed scope must refuse a controller read");
  } catch (error) {
    if (!isError(error, "Disposed")) throw error;
  }
});

test("scope and both session forms share their verbs on one prototype", async () => {
  const root = createScope();
  const child = root.createSession();
  const prototype = Object.getPrototypeOf(root);
  const verbs = [
    "controller",
    "resolve",
    "run",
    "settle",
    "createSession",
    "session",
    "release",
    "releaseNs",
    "spans",
    "onClose",
    "settled",
    "close",
  ];
  for (const verb of verbs) {
    expect(Object.hasOwn(prototype, verb)).toBe(true);
    expect(Object.hasOwn(root, verb)).toBe(false);
  }

  expect(Object.getPrototypeOf(child)).toBe(prototype);
  await root.session((scope) => {
    expect(Object.getPrototypeOf(scope)).toBe(prototype);
  });
  expect((await root.close({ graceful: true })).status).toBe("success");
});

test("release passed to forEach resets cells and keeps one function after first read", async () => {
  const root = createScope();
  root.controller(first).set(10);
  root.controller(second).set(20);

  expect(Object.values(root).filter((value) => typeof value === "function")).toHaveLength(0);
  const release = root.release;
  [first, second].forEach(release);

  expect([root.resolve(first), root.resolve(second)]).toEqual([1, 2]);
  expect(root.release).toBe(release);
  expect(Object.values(root).filter((value) => typeof value === "function")).toHaveLength(1);
  expect((await root.close({ graceful: true })).status).toBe("success");
});

test("opening and closing scopes makes no own verb functions", async () => {
  const root = createScope();
  const child = root.createSession();

  expect(Object.values(root).filter((value) => typeof value === "function")).toHaveLength(0);
  expect(Object.values(child).filter((value) => typeof value === "function")).toHaveLength(0);
  await root.session((scope) => {
    expect(Object.values(scope).filter((value) => typeof value === "function")).toHaveLength(0);
  });

  expect((await child.close({ graceful: true })).status).toBe("success");
  expect((await root.close({ graceful: true })).status).toBe("success");
  expect(Object.values(root).filter((value) => typeof value === "function")).toHaveLength(0);
  expect(Object.values(child).filter((value) => typeof value === "function")).toHaveLength(0);
});

test("a saved spans list keeps its entries when later runs replace the history", async () => {
  const root = createScope({ observe: { history: 1 } });
  root.run({ label: "first", run: () => 1 });
  const spans = root.spans();
  root.run({ label: "second", run: () => 2 });

  expect(spans.map((span) => span.name)).toEqual(["first"]);
  expect((await root.close({ graceful: true })).status).toBe("success");
});
