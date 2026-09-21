import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import { createScope } from "@tinker/core";
import { backend, HttpResponse, type HttpClient, type HttpRequest } from "@tinker/http";
import { isError, tinkerer, type Tinkerer } from "../src/index.ts";

const answer = readFileSync(new URL("./fixtures/answer.sse", import.meta.url));

const replyText =
  "In `README.md`:\n\n```md\n# tinkered\n\nA tiny engine. Scope, session, operation, resource, data cell.\n```";

/** A closure backend that records every request it sees and answers `answer` at 200. */
function recording(
  seen: HttpRequest.Record[],
  body: string | Uint8Array = answer,
): HttpClient.Backend {
  return async (request) => {
    seen.push(request);
    return HttpResponse.make(request, { status: 200, body });
  };
}

const coder = tinkerer({ label: "coder" });

const scopeConfig = (seen: HttpRequest.Record[]) =>
  createScope({
    tags: [
      backend(recording(seen)),
      coder.config({
        model: "muse-spark-1.3-contributor",
        baseUrl: "https://api",
        headers: { authorization: "Bearer x" },
        system: "be brief",
      }),
    ],
  });

function readBody(seen: HttpRequest.Record[]): Record<string, unknown> {
  const body = seen[0]?.body;
  if (body === undefined || body.kind !== "text") throw new Error("tinkerer: expected a JSON body");
  return JSON.parse(body.text) as Record<string, unknown>;
}

test("a turn streams the reply into text and delivers the final assistant message", async () => {
  const scope = scopeConfig([]);
  const session = scope.createSession();
  const watched: string[] = [];
  session.controller(coder.text).watch((next) => watched.push(next));
  const reply = await session.run(coder.turn, { input: "hi" });
  expect(reply.message).toEqual({ role: "assistant", content: replyText });
  expect(reply.finish).toBe("stop");
  const deltas = watched.filter((value) => value.length > 0);
  expect(deltas.length).toBeGreaterThanOrEqual(2);
  expect(deltas[deltas.length - 1]).toBe(replyText);
  await scope.close();
});

test("a turn sends the transcript with the system prompt first and the wire fields the config names", async () => {
  const seen: HttpRequest.Record[] = [];
  const scope = scopeConfig(seen);
  const session = scope.createSession();
  await session.run(coder.turn, { input: "hi" });
  expect(seen).toHaveLength(1);
  const request = seen[0];
  if (request === undefined) throw new Error("tinkerer: expected one request");
  expect(request.url).toBe("https://api/chat/completions");
  expect(request.headers["authorization"]).toBe("Bearer x");
  const body = readBody(seen);
  expect(body["model"]).toBe("muse-spark-1.3-contributor");
  expect(body["stream"]).toBe(true);
  const messages = body["messages"] as readonly Tinkerer.Message[];
  expect(messages[0]).toEqual({ role: "system", content: "be brief" });
  expect(messages[1]).toEqual({ role: "user", content: "hi" });
  await scope.close();
});

test("a second turn in the same session continues the transcript", async () => {
  const seen: HttpRequest.Record[] = [];
  const scope = scopeConfig(seen);
  const session = scope.createSession();
  await session.run(coder.turn, { input: "hi" });
  await session.run(coder.turn, { input: "again" });
  const transcript = session.resolve(coder.messages);
  expect(transcript).toHaveLength(5);
  expect(transcript.map((message) => message.role)).toEqual([
    "system",
    "user",
    "assistant",
    "user",
    "assistant",
  ]);
  const second = seen[1]?.body;
  if (second === undefined || second.kind !== "text")
    throw new Error("tinkerer: expected a JSON body");
  const carried = JSON.parse(second.text) as { messages: readonly Tinkerer.Message[] };
  expect(carried.messages).toHaveLength(4);
  await scope.close();
});

test("usage lands from the last chunk and status ends done", async () => {
  const scope = scopeConfig([]);
  const session = scope.createSession();
  const states: string[] = [];
  session.controller(coder.status).watch((next) => states.push(next));
  await session.run(coder.turn, { input: "hi" });
  expect(session.resolve(coder.usage)).toEqual({ input: 646, cached: 0, output: 194 });
  expect(states).toEqual(["running", "done"]);
  await scope.close();
});

test("a stream with no finish reason fails the turn with StreamEnded and status failed", async () => {
  const seen: HttpRequest.Record[] = [];
  const scope = createScope({
    tags: [
      backend(recording(seen, 'data: {"choices":[{"delta":{"content":"x"}}]}\n\ndata: [DONE]\n\n')),
      coder.config({ model: "muse-spark-1.3-contributor", baseUrl: "https://api" }),
    ],
  });
  const session = scope.createSession();
  const failure = await session.run(coder.turn, { input: "hi" }).then(
    () => null,
    (error: unknown) => error,
  );
  if (!isError(failure, "StreamEnded")) throw failure;
  expect(session.resolve(coder.status)).toBe("failed");
  await scope.close();
});

test("a nearer config binding wins per key", async () => {
  const seen: HttpRequest.Record[] = [];
  const scope = scopeConfig(seen);
  const session = scope.createSession();
  await session.run(coder.turn, { input: "hi", tags: [coder.config({ model: "other" })] });
  const body = readBody(seen);
  expect(body["model"]).toBe("other");
  const request = seen[0];
  if (request === undefined) throw new Error("tinkerer: expected one request");
  expect(request.url).toBe("https://api/chat/completions");
  await scope.close();
});

test("a missing model fails the turn with MissingConfig before any request", async () => {
  const seen: HttpRequest.Record[] = [];
  const scope = createScope({
    tags: [backend(recording(seen)), coder.config({ baseUrl: "https://api" })],
  });
  const session = scope.createSession();
  const failure = await session.run(coder.turn, { input: "hi" }).then(
    () => null,
    (error: unknown) => error,
  );
  if (!isError(failure, "MissingConfig")) throw failure;
  expect(failure.payload).toEqual({ label: "coder", key: "model" });
  expect(seen).toHaveLength(0);
  await scope.close();
});
