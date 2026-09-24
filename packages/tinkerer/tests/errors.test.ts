import { expect, test } from "vite-plus/test";
import { isError } from "../src/index.ts";

test("isError is true only for a real Error carrying that kind", () => {
  expect(isError(new Error("x"), "EmptyPrompt")).toBe(false);
  expect(isError({ kind: "EmptyPrompt", payload: {} }, "EmptyPrompt")).toBe(false);
  expect(isError({ kind: "EmptyPrompt" }, "StreamEnded")).toBe(false);
});
