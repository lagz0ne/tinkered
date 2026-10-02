import { expect, test } from "vite-plus/test";
import * as core from "../src/index.ts";

test("the main entry keeps test helpers in the testing entry", () => {
  expect(
    Object.keys(core).filter(
      (name) => name === "makeTestClock" || name === "makeTestRandom" || name === "preset",
    ),
  ).toEqual([]);
});
