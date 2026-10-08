import { expect, test } from "vite-plus/test";
import { createScope, data } from "../src/index";

const first = data({ label: "first", initial: 1 });
const second = data({ label: "second", initial: 2 });

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
