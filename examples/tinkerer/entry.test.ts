import { createScope } from "@tinker/core";
import { backend } from "@tinker/http";
import { expect, test } from "vite-plus/test";
import { a, b, coder, isError, readSettings, recorded } from "./index.ts";

test("two streamed replies keep separate conversation data without an account", async () => {
  const stop = new AbortController();
  const root = createScope({
    signal: stop.signal,
    tags: [
      coder.config({ model: "demo-model", baseUrl: "https://demo.invalid/v1" }),
      backend(recorded),
    ],
  });
  try {
    await root.ready;
    const session = root.createSession();
    const replies = [];
    for (const { name, ns } of [
      { name: "A", ns: a },
      { name: "B", ns: b },
    ]) {
      const reply = await session.run(coder.turn, { input: `Hello ${name}.`, ns });
      replies.push({ name, text: session.resolve(coder.text, { ns }), usage: reply.usage });
    }
    expect(replies).toEqual([
      { name: "A", text: "Hello from the demo.", usage: { input: 10, cached: 0, output: 5 } },
      { name: "B", text: "Hello from the demo.", usage: { input: 10, cached: 0, output: 5 } },
    ]);
    expect(session.resolve(coder.messages, { ns: a })).toEqual([
      { role: "system", content: "You are coder A." },
      { role: "user", content: "Hello A." },
      { role: "assistant", content: "Hello from the demo." },
    ]);
    expect(session.resolve(coder.messages, { ns: b })).toEqual([
      { role: "system", content: "You are coder B." },
      { role: "user", content: "Hello B." },
      { role: "assistant", content: "Hello from the demo." },
    ]);
  } finally {
    stop.abort();
    await root.closed;
  }
});

test("missing live settings fail before a request and report only field names", async () => {
  expect.assertions(2);
  let requests = 0;
  try {
    const { apiKey, baseUrl, model, prompt } = readSettings({ prompt: "Hello." });
    const stop = new AbortController();
    const root = createScope({
      signal: stop.signal,
      tags: [
        coder.config({ model, baseUrl, headers: { authorization: `Bearer ${apiKey}` } }),
        backend((request, signal) => {
          requests += 1;
          return recorded(request, signal);
        }),
      ],
    });
    try {
      await root.ready;
      await root.createSession().run(coder.turn, { input: prompt, ns: a });
    } finally {
      stop.abort();
      await root.closed;
    }
  } catch (error) {
    if (!isError(error, "InvalidSettings")) throw error;
    expect(error.payload.fields).toEqual(["apiKey", "baseUrl", "model"]);
    expect(requests).toBe(0);
  }
});
