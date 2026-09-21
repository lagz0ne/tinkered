import { expect, test } from "vite-plus/test";
import { createScope, data, extension } from "../src/index.ts";

const asNumber = (v: unknown): number => {
  if (typeof v !== "number") throw new Error("not a number");
  return v;
};

test("a write chain skips an extension with no write hook", async () => {
  const cell = data({ initial: 0, parse: asNumber });
  const plain = extension({ label: "plain" });
  let seen: unknown = "unset";
  const spy = extension({
    label: "spy",
    write: (_cell, value, next) => {
      seen = value;
      next();
    },
  });
  const scope = createScope({ extensions: [plain, spy] });
  await scope.ready;
  scope.controller(cell).set(4);
  expect(seen).toBe(4);
  expect(scope.controller(cell).get()).toBe(4);
  await scope.close();
});

test("a write chain that skips still refuses when the writer denies", async () => {
  const cell = data({ initial: 1, parse: asNumber });
  const plain = extension({ label: "plain" });
  const deny = extension({ label: "deny", write: () => undefined });
  const scope = createScope({ extensions: [plain, deny] });
  await scope.ready;
  scope.controller(cell).set(2);
  expect(scope.controller(cell).get()).toBe(1);
  await scope.close();
});
