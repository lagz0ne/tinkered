import { expect, test } from "vite-plus/test";
import { isError, readTool, tinkerer } from "../src/index.ts";

test("isError is true only for a real Error carrying that kind", () => {
  let failure: unknown;
  try {
    tinkerer({ label: "twins", tools: [readTool, readTool] });
  } catch (error) {
    failure = error;
  }
  expect(isError(failure, "DuplicateTool")).toBe(true);
  expect(isError(failure, "StreamEnded")).toBe(false);
  expect(isError(new Error("x"), "EmptyPrompt")).toBe(false);
  expect(isError({ kind: "EmptyPrompt", payload: {} }, "EmptyPrompt")).toBe(false);
});
