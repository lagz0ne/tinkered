import { expect, test } from "vite-plus/test";
import { createScope, data } from "../src/index";

test("a nested write keeps the outer cell's later watchers and children", async () => {
  const outer = data({ label: "outer", initial: 0 });
  const inner = data({ label: "inner", initial: 0 });
  const root = createScope();
  const first = root.createSession();
  const second = root.createSession();
  const seen: string[] = [];
  const innerController = root.controller(inner);
  innerController.watch((next, prev) => seen.push(`inner:${prev}:${next}`));
  root.controller(outer).watch((next) => innerController.set(next + 10));
  root.controller(outer).watch((next, prev) => seen.push(`root:${prev}:${next}`));
  first.controller(outer).watch((next) => innerController.set(next + 20));
  second.controller(outer).watch((next, prev) => seen.push(`child:${prev}:${next}`));
  root.controller(outer).set(1);
  expect(seen).toEqual(["inner:0:11", "root:0:1", "inner:11:21", "child:0:1"]);
  expect((await root.close({ graceful: true })).status).toBe("success");
});
