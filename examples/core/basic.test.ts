import { createScope } from "@tinkered/core";
import { makeTestClock } from "@tinkered/core/testing";
import { expect, test } from "vite-plus/test";

import { basic } from "./index";

test("a child session changes its own count without changing the root's count", async () => {
  const app = basic({ region: "eu" });
  const root = await createScope({ capsules: [app] }).ready;
  await root.run(app.setCount, { input: 21 });

  const inChild = await root.session(async (child) => {
    await child.run(app.setCount, { input: 100 });
    return child.run(app.doubled);
  });

  expect(inChild).toBe(200);
  expect(await root.run(app.doubled)).toBe(42);
  await root.close();
});

test("the install's config reaches its operations", async () => {
  const app = basic({ region: "eu" });
  const root = await createScope({ capsules: [app] }).ready;
  await root.run(app.setCount, { input: 21 });

  expect(await root.run(app.where)).toBe("eu:21");
  await root.close();
});

test("the count goes out as a read view: get and watch, no set", async () => {
  const app = basic({ region: "eu" });
  const root = await createScope({ capsules: [app] }).ready;
  const count = root.resolve(app.count);

  expect(count.get()).toBe(0);
  expect("set" in count).toBe(false);
  await root.close();
});

test("reading the store again keeps its rows", async () => {
  const app = basic({ region: "eu" });
  const root = await createScope({ capsules: [app] }).ready;
  root.resolve(app.store).add("first");

  expect(root.resolve(app.store).size()).toBe(1);
  await root.close();
});

test("stamp reads the clock supplied by the root", async () => {
  const app = basic({ region: "eu" });
  const root = await createScope({ clock: makeTestClock({ now: 7 }), capsules: [app] }).ready;

  expect(await root.run(app.stamp)).toBe(7);
  await root.close();
});
