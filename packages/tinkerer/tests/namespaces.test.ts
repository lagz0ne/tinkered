import { expect, test } from "vite-plus/test";
import { createScope, namespace } from "@tinker/core";
import { backend, HttpResponse, type HttpClient, type HttpRequest } from "@tinker/http";
import { tinkerer, type Tinkerer } from "../src/index.ts";

const coder = tinkerer();

function requestBody(request: HttpRequest.Record): {
  model: string;
  messages: readonly Tinkerer.Message[];
} {
  if (request.body.kind !== "text") throw new Error("expected a JSON request");
  return JSON.parse(request.body.text) as {
    model: string;
    messages: readonly Tinkerer.Message[];
  };
}

test("two coders share one frame but keep their history, config and state apart", async () => {
  const requests: HttpRequest.Record[] = [];
  const fake: HttpClient.Backend = async (request) => {
    requests.push(request);
    const model = requestBody(request).model;
    const count = model === "a-model" ? 1 : 2;
    const reply = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: model }, finish_reason: "stop" }] })}`,
      `data: ${JSON.stringify({ usage: { prompt_tokens: count, completion_tokens: count } })}`,
      "data: [DONE]",
    ].join("\n\n");
    return HttpResponse.make(request, { status: 200, body: `${reply}\n\n` });
  };
  const a = namespace({ tags: [coder.config({ model: "a-model", baseUrl: "https://a" })] });
  const b = namespace({ tags: [coder.config({ model: "b-model", baseUrl: "https://b" })] });
  const scope = createScope({ tags: [backend(fake)] });
  const session = scope.createSession();
  await session.run(coder.turn, { input: "one", ns: a });
  await session.run(coder.turn, { input: "two", ns: b });
  await session.run(coder.turn, { input: "three", ns: a });
  expect(requests.map((request) => [request.url, requestBody(request).model])).toEqual([
    ["https://a/chat/completions", "a-model"],
    ["https://b/chat/completions", "b-model"],
    ["https://a/chat/completions", "a-model"],
  ]);
  expect(requests.map((request) => requestBody(request).messages.length)).toEqual([1, 1, 3]);
  expect(session.resolve(coder.messages, { ns: a }).map((message) => message.content)).toEqual([
    "one",
    "a-model",
    "three",
    "a-model",
  ]);
  expect(session.resolve(coder.messages, { ns: b }).map((message) => message.content)).toEqual([
    "two",
    "b-model",
  ]);
  expect(session.resolve(coder.usage, { ns: a }).input).toBe(1);
  expect(session.resolve(coder.usage, { ns: b }).input).toBe(2);
  expect(session.resolve(coder.text, { ns: b })).toBe("b-model");
  expect(session.resolve(coder.status, { ns: a })).toBe("done");
  expect(session.resolve(coder.settings, { ns: b })?.options.model).toBe("b-model");
  await scope.close();
});
