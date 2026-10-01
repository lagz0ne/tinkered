import { expect, test } from "vite-plus/test";
import { tour } from "./index.ts";

test("the tour reads the name committed by its session", async () => {
  expect(await tour()).toBe("ada");
});

test("each tour starts with a fresh database", async () => {
  await tour();
  expect(await tour()).toBe("ada");
});
