import { expect, test } from "vite-plus/test";
import { createScope, data } from "../src/index";

test("a deep watch stops on unsubscribe and close while a sibling keeps watching", async () => {
  const count = data({ label: "count", initial: 0 });
  const root = createScope();
  const leaf = root.createSession().createSession().createSession().createSession();
  const sibling = root.createSession();
  const deepSeen: number[] = [];
  const siblingSeen: number[] = [];
  const ctl = root.controller(count);
  sibling.controller(count).watch((next) => siblingSeen.push(next));
  const stop = leaf.controller(count).watch((next) => deepSeen.push(next));
  ctl.set(1);
  stop();
  stop();
  ctl.set(2);
  const stopAgain = leaf.controller(count).watch((next) => deepSeen.push(next));
  ctl.set(3);
  expect((await leaf.close({ graceful: true })).status).toBe("success");
  stopAgain();
  ctl.set(4);
  expect(deepSeen).toEqual([1, 3]);
  expect(siblingSeen).toEqual([1, 2, 3, 4]);
  expect((await root.close({ graceful: true })).status).toBe("success");
});
