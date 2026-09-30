import { expect, test } from "vite-plus/test";
import { demoTour, isError, runServices } from "./index.ts";

test("the demo keeps each conversation and its text in its own namespace", async () => {
  expect(await demoTour()).toBe(
    "Hi again;Hello;Hi again;agent-a;agent-b;Hello;Hi|Hi again;first|Hello",
  );
});

test("a lone task separator is not a service prompt", async () => {
  expect.assertions(1);
  try {
    await runServices({}, ["--"], "/work", { write: () => undefined, error: () => undefined });
  } catch (error) {
    if (!isError(error, "InvalidSettings")) throw error;
    expect(error.payload).toEqual({ fields: ["githubToken", "cloudflareToken", "prompts"] });
  }
});
