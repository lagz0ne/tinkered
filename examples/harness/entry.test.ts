import { expect, test } from "vite-plus/test";
import { createScope } from "@tinker/core";
import { coder, firstAgent, secondAgent, relay, isError, readLaunch } from "./index.ts";

test("the example keeps each conversation and its text in its own namespace", async () => {
  const stop = new AbortController();
  const root = createScope({ signal: stop.signal });
  try {
    await root.ready;
    const session = root.createSession();
    const textA: string[] = [];
    const textB: string[] = [];
    session.controller(coder.text, { ns: firstAgent }).watch((next) => textA.push(next));
    session.controller(coder.text, { ns: secondAgent }).watch((next) => textB.push(next));
    expect(await session.run(relay)).toBe("Hi again");
    expect({
      text: session.resolve(coder.text, { ns: firstAgent }),
      id: session.resolve(coder.id, { ns: firstAgent }),
      chunks: textA,
      events: session.resolve(coder.events, { ns: firstAgent }),
    }).toEqual({ text: "Hello", id: "agent-a", chunks: ["Hello"], events: ["first"] });
    expect({
      text: session.resolve(coder.text, { ns: secondAgent }),
      id: session.resolve(coder.id, { ns: secondAgent }),
      chunks: textB,
      events: session.resolve(coder.events, { ns: secondAgent }),
    }).toEqual({
      text: "Hi again",
      id: "agent-b",
      chunks: ["Hi", "Hi again"],
      events: ["Hello"],
    });
  } finally {
    stop.abort();
    await root.closed;
  }
});

test("a lone task separator is not a service prompt", () => {
  expect.assertions(1);
  try {
    readLaunch({}, ["--"], "/work");
  } catch (error) {
    if (!isError(error, "InvalidSettings")) throw error;
    expect(error.payload).toEqual({ fields: ["githubToken", "cloudflareToken", "prompts"] });
  }
});
