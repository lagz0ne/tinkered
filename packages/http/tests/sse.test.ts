import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import { createScope } from "@tinker/core";
import {
  backend,
  httpClient,
  HttpRequest,
  HttpResponse,
  isError as isHttpError,
  type HttpClient,
} from "../src/index.ts";

const chat = httpClient({ label: "chat" });

/** Drain an `sse()` reader into an array. */
async function readEvents(
  response: HttpResponse.Handle,
): Promise<readonly HttpResponse.SseEvent[]> {
  const events: HttpResponse.SseEvent[] = [];
  for await (const event of response.sse()) events.push(event);
  return events;
}

test("sse() yields one event per blank-line block with data lines joined by newline", async () => {
  const request = HttpRequest.get("/x");
  const events = await readEvents(
    HttpResponse.make(request, { status: 200, body: "data: a\ndata: b\n\ndata: c\n\n" }),
  );
  expect(events).toEqual([{ data: "a\nb" }, { data: "c" }]);
});

test("sse() carries event and id and skips comment lines", async () => {
  const request = HttpRequest.get("/x");
  const events = await readEvents(
    HttpResponse.make(request, {
      status: 200,
      body: ": hi\nevent: tick\nid: 7\ndata: x\n\n",
    }),
  );
  expect(events).toEqual([{ data: "x", event: "tick", id: "7" }]);
});

test("sse() joins an event split across chunks", async () => {
  const request = HttpRequest.get("/x");
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode("data: hel"));
      controller.enqueue(encoder.encode("lo\n\n"));
      controller.close();
    },
  });
  const events = await readEvents(HttpResponse.make(request, { status: 200, body }));
  expect(events).toEqual([{ data: "hello" }]);
});

test("sse() keeps a CRLF split across chunks as one line end", async () => {
  const request = HttpRequest.get("/x");
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode("data: a\r"));
      controller.enqueue(encoder.encode("\ndata: b\r\n\r\n"));
      controller.close();
    },
  });
  const events = await readEvents(HttpResponse.make(request, { status: 200, body }));
  expect(events).toEqual([{ data: "a\nb" }]);
});

test("sse() on a bodiless response raises NoBody", async () => {
  const request = HttpRequest.get("/x");
  const response = HttpResponse.make(request, { status: 204 });
  try {
    await readEvents(response);
    expect.unreachable();
  } catch (error) {
    if (!isHttpError(error, "NoBody")) throw error;
    expect(error.payload.status).toBe(204);
  }
});

test("an endpoint reader may return sse() and the operation delivers the recorded stream", async () => {
  const recorded = readFileSync(new URL("./fixtures/chat-completions.sse", import.meta.url));
  const stream = chat.operation({
    label: "stream",
    request: () => HttpRequest.post("https://api/chat", { body: HttpRequest.bodyText("{}") }),
    response: (res) => res.sse(),
  });
  const fake: HttpClient.Backend = async (request) =>
    HttpResponse.make(request, { status: 200, body: recorded });
  const scope = createScope({ tags: [backend(fake)] });
  const iterable = await scope.run(stream);
  const events: HttpResponse.SseEvent[] = [];
  for await (const event of iterable) events.push(event);
  expect(events.length).toBe(7);
  expect(events[events.length - 1]?.data).toBe("[DONE]");
  const text = events
    .slice(0, -1)
    .map((event) => {
      const chunk = JSON.parse(event.data) as {
        choices: readonly [{ delta?: { content?: string } }];
      };
      return chunk.choices[0]?.delta?.content ?? "";
    })
    .join("");
  expect(text).toBe(
    "In `README.md`:\n\n```md\n# tinkered\n\nA tiny engine. Scope, session, operation, resource, data cell.\n```",
  );
  await scope.close();
});
