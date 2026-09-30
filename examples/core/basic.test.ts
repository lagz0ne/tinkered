import { expect, test } from "vite-plus/test";
import { tour } from "./index.ts";

test("the tour keeps its result before closing the scope", async () => {
  expect(await tour()).toBe(286);
});
