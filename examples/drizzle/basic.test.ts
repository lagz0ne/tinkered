import { expect, test } from "vite-plus/test";
import { tour } from "./index.ts";

test("the tour reads the name committed by its session", async () => {
  expect(await tour()).toBe("ada");
});
