import { expect, test } from "vite-plus/test";
import { demoTour, isError, tour } from "./index.ts";

test("the demo returns two streamed replies without an account", async () => {
  expect(await demoTour()).toEqual([
    { name: "A", text: "Hello from the demo.", usage: { input: 10, cached: 0, output: 5 } },
    { name: "B", text: "Hello from the demo.", usage: { input: 10, cached: 0, output: 5 } },
  ]);
});

test("missing live settings fail before a request and report only field names", async () => {
  expect.assertions(1);
  try {
    await tour({ prompt: "Hello." });
  } catch (error) {
    if (!isError(error, "InvalidSettings")) throw error;
    expect(error.payload.fields).toEqual(["apiKey", "baseUrl", "model"]);
  }
});
