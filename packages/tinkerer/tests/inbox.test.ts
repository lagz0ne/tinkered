import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import { createScope, namespace } from "@tinker/core";
import { backend, HttpResponse, type HttpClient, type HttpRequest } from "@tinker/http";
import { queue, steer, tinkerer } from "../src/index.ts";

const answer = readFileSync(new URL("./fixtures/answer.sse", import.meta.url));
const enc = new TextEncoder();

const replyText =
  "In `README.md`:\n\n```md\n# tinkered\n\nA tiny engine. Scope, session, operation, resource, data cell.\n```";

/** A backend that answers `bodies[n]` to the n-th request, then repeats the last. */
function scripted(
  seen: HttpRequest.Record[],
  bodies: (string | Uint8Array | ReadableStream<Uint8Array>)[],
): HttpClient.Backend {
  return async (request) => {
    seen.push(request);
    return HttpResponse.make(request, {
      status: 200,
      body: bodies[Math.min(seen.length - 1, bodies.length - 1)] ?? answer,
    });
  };
}

/** The user/assistant/tool roles of a request body's messages. */
function roles(seen: HttpRequest.Record[], index: number): { role: string; content: unknown }[] {
  const body = seen[index]?.body;
  if (body === undefined || body.kind !== "text") throw new Error("expected a JSON body");
  const parsed = JSON.parse(body.text) as { messages: { role: string; content: unknown }[] };
  return parsed.messages;
}

const coder = tinkerer({ label: "coder" });

function scope(
  seen: HttpRequest.Record[],
  bodies: (string | Uint8Array | ReadableStream<Uint8Array>)[],
) {
  return createScope({
    tags: [backend(scripted(seen, bodies)), coder.config({ model: "m", baseUrl: "https://api" })],
  });
}

test("a queued entry continues the turn when the model would stop", async () => {
  const seen: HttpRequest.Record[] = [];
  const s = scope(seen, [answer, answer]);
  const session = s.createSession();
  session.controller(coder.inbox).update((list) => [...list, queue("and again")]);
  const reply = await session.run(coder.turn, { input: "first" });
  expect(reply.message.content).toBe(replyText);
  expect(seen).toHaveLength(2);
  expect(session.resolve(coder.messages).map((message) => message.role)).toEqual([
    "user",
    "assistant",
    "user",
    "assistant",
  ]);
  expect(roles(seen, 1).map((message) => message.content)).toEqual([
    "first",
    replyText,
    "and again",
  ]);
  expect(session.resolve(coder.inbox)).toHaveLength(0);
  await s.close();
});

test("a steer pushed before the turn is injected first and the queue still runs", async () => {
  const seen: HttpRequest.Record[] = [];
  const s = scope(seen, [answer, answer]);
  const session = s.createSession();
  session.controller(coder.inbox).update((list) => [...list, steer("now"), queue("more")]);
  const reply = await session.run(coder.turn, { input: "first" });
  expect(reply.message.content).toBe(replyText);
  expect(seen).toHaveLength(2);
  expect(session.resolve(coder.messages).map((message) => message.content)).toEqual([
    "first",
    "now",
    replyText,
    "more",
    replyText,
  ]);
  await s.close();
});

test("a queued entry patches the settings the next step reads", async () => {
  const seen: HttpRequest.Record[] = [];
  const s = scope(seen, [answer, answer]);
  const session = s.createSession();
  session
    .controller(coder.inbox)
    .update((list) => [...list, queue("go on", { options: { reasoning_effort: "high" } })]);
  await session.run(coder.turn, { input: "first" });
  const body = JSON.parse(seen[1]?.body?.kind === "text" ? seen[1].body.text : "{}") as Record<
    string,
    unknown
  >;
  expect(body["reasoning_effort"]).toBe("high");
  expect(session.resolve(coder.settings)?.options.reasoning_effort).toBe("high");
  await s.close();
});

test("no pending entry ends the turn after one step", async () => {
  const seen: HttpRequest.Record[] = [];
  const s = scope(seen, [answer]);
  const reply = await s.createSession().run(coder.turn, { input: "hi" });
  expect(reply.finish).toBe("stop");
  expect(seen).toHaveLength(1);
  await s.close();
});

/** A stream that emits a partial delta, then waits for `open()` before one more (empty) event
 * so a test can push a steer between the two and see the fold break at the second event. */
function gatedPartial(): { body: ReadableStream<Uint8Array>; open: () => void } {
  let open: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n'));
      await gate;
      controller.enqueue(enc.encode('data: {"choices":[{"delta":{}}]}\n\n'));
      controller.close();
    },
  });
  return { body, open };
}

test("a steer interrupts the step in flight, keeps the partial text, and re-enters as a user message", async () => {
  const seen: HttpRequest.Record[] = [];
  const first = gatedPartial();
  const s = scope(seen, [first.body, answer]);
  const session = s.createSession();
  const reached = new Promise<void>((resolve) => {
    session.controller(coder.text).watch((next) => {
      if (next === "Partial") resolve();
    });
  });
  const running = session.run(coder.turn, { input: "start" });
  await reached;
  session.controller(coder.inbox).update((list) => [...list, steer("switch tack")]);
  first.open();
  const reply = await running;
  expect(reply.message.content).toBe(replyText);
  expect(seen).toHaveLength(2);
  expect(session.resolve(coder.messages)).toEqual([
    { role: "user", content: "start" },
    { role: "assistant", content: "Partial" },
    { role: "user", content: "switch tack" },
    { role: "assistant", content: replyText },
  ]);
  expect(session.resolve(coder.inbox)).toHaveLength(0);
  await s.close();
});

/** One SSE body: a no-content delta, then `late` text, then a stop. A steer pushed before the
 * second event must drop the events after the first and keep no partial text. */
const emptyThenLate = [
  'data: {"choices":[{"delta":{}}]}\n\n',
  'data: {"choices":[{"delta":{"content":"late"}}]}\n\n',
  'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
  "data: [DONE]\n\n",
].join("");

test("a steer with no text in flight ends the stream early and adds no assistant message", async () => {
  const seen: HttpRequest.Record[] = [];
  let pushSteer: (() => void) | undefined;
  const fake: HttpClient.Backend = async (request) => {
    seen.push(request);
    if (seen.length === 1) pushSteer?.();
    return HttpResponse.make(request, {
      status: 200,
      body: seen.length === 1 ? emptyThenLate : answer,
    });
  };
  const s = createScope({
    tags: [backend(fake), coder.config({ model: "m", baseUrl: "https://api" })],
  });
  const session = s.createSession();
  pushSteer = () =>
    session.controller(coder.inbox).update((list) => [...list, steer("switch tack")]);
  const reply = await session.run(coder.turn, { input: "start" });
  expect(reply.message.content).toBe(replyText);
  expect(seen).toHaveLength(2);
  expect(session.resolve(coder.messages)).toEqual([
    { role: "user", content: "start" },
    { role: "user", content: "switch tack" },
    { role: "assistant", content: replyText },
  ]);
  expect(session.resolve(coder.inbox)).toHaveLength(0);
  await s.close();
});

test("a steer for one coder does not interrupt the other coder", async () => {
  const first = gatedPartial();
  const a = namespace({ tags: [coder.config({ model: "a", baseUrl: "https://a" })] });
  const b = namespace({ tags: [coder.config({ model: "b", baseUrl: "https://b" })] });
  let aCalls = 0;
  const seen: HttpRequest.Record[] = [];
  const fake: HttpClient.Backend = async (request) => {
    seen.push(request);
    if (request.url === "https://a/chat/completions" && aCalls++ === 0)
      return HttpResponse.make(request, { status: 200, body: first.body });
    return HttpResponse.make(request, { status: 200, body: answer });
  };
  const s = createScope({ tags: [backend(fake)] });
  const session = s.createSession();
  const reached = new Promise<void>((resolve) => {
    session.controller(coder.text, { ns: a }).watch((next) => {
      if (next === "Partial") resolve();
    });
  });
  const running = session.run(coder.turn, { input: "start A", ns: a });
  await reached;
  session.controller(coder.inbox, { ns: a }).update((list) => [...list, steer("only A")]);
  await session.run(coder.turn, { input: "start B", ns: b });
  expect(session.resolve(coder.messages, { ns: b }).map((message) => message.content)).toEqual([
    "start B",
    replyText,
  ]);
  expect(session.resolve(coder.inbox, { ns: a })).toEqual([steer("only A")]);
  first.open();
  await running;
  expect(session.resolve(coder.messages, { ns: a }).map((message) => message.content)).toEqual([
    "start A",
    "Partial",
    "only A",
    replyText,
  ]);
  expect(session.resolve(coder.inbox, { ns: b })).toEqual([]);
  expect(seen.map((request) => request.url)).toEqual([
    "https://a/chat/completions",
    "https://b/chat/completions",
    "https://a/chat/completions",
  ]);
  await s.close();
});

test("a steer carrying a mode patches the settings before the next step", async () => {
  const seen: HttpRequest.Record[] = [];
  const first = gatedPartial();
  const s = scope(seen, [first.body, answer]);
  const session = s.createSession();
  const reached = new Promise<void>((resolve) => {
    session.controller(coder.text).watch((next) => {
      if (next === "Partial") resolve();
    });
  });
  const running = session.run(coder.turn, { input: "start" });
  await reached;
  session
    .controller(coder.inbox)
    .update((list) => [...list, steer("open up", { mode: "full-access" })]);
  first.open();
  await running;
  expect(session.resolve(coder.settings)?.mode).toBe("full-access");
  await s.close();
});
