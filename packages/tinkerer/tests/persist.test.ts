import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { createScope, namespace } from "@tinker/core";
import { backend, HttpResponse, type HttpClient, type HttpRequest } from "@tinker/http";
import { persist, restore, tinkerer, type Tinkerer } from "../src/index.ts";

const answer = readFileSync(new URL("./fixtures/answer.sse", import.meta.url));

const replyText =
  "In `README.md`:\n\n```md\n# tinkered\n\nA tiny engine. Scope, session, operation, resource, data cell.\n```";

function recording(seen: HttpRequest.Record[]): HttpClient.Backend {
  return async (request) => {
    seen.push(request);
    return HttpResponse.make(request, { status: 200, body: answer });
  };
}

const coder = tinkerer({ label: "coder" });

function tempFile(): string {
  return join(mkdtempSync(join(tmpdir(), "tinkerer-persist-")), "chat.jsonl");
}

function lines(file: string): Tinkerer.Message[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Tinkerer.Message);
}

test("a turn's messages are appended to the file one JSON line each", async () => {
  const file = tempFile();
  const scope = createScope({
    tags: [
      backend(recording([])),
      coder.config({ model: "m", baseUrl: "https://api", system: "be brief" }),
    ],
    extensions: [persist({ frame: coder, file })],
  });
  await scope.createSession().run(coder.turn, { input: "hi" });
  expect(lines(file)).toEqual([
    { role: "system", content: "be brief" },
    { role: "user", content: "hi" },
    { role: "assistant", content: replyText },
  ]);
  await scope.close();
});

test("a session seeds its messages from an existing file and appends only what is new", async () => {
  const file = tempFile();
  writeFileSync(file, `${JSON.stringify({ role: "user", content: "earlier" })}\n`);
  const scope = createScope({
    tags: [backend(recording([])), coder.config({ model: "m", baseUrl: "https://api" })],
    extensions: [persist({ frame: coder, file })],
  });
  const session = scope.createSession();
  await session.run(coder.turn, { input: "next" });
  expect(session.resolve(coder.messages)[0]).toEqual({ role: "user", content: "earlier" });
  expect(lines(file).map((message) => message.content)).toEqual(["earlier", "next", replyText]);
  await scope.close();
});

test("one frame writes each namespace to its own file and restores only that coder", async () => {
  const one = tempFile();
  const two = tempFile();
  writeFileSync(one, `${JSON.stringify({ role: "user", content: "earlier A" })}\n`);
  const a = namespace({ tags: [coder.config({ model: "a", baseUrl: "https://api" })] });
  const b = namespace({ tags: [coder.config({ model: "b", baseUrl: "https://api" })] });
  const scope = createScope({
    tags: [backend(recording([]))],
    extensions: [
      persist({ frame: coder, ns: a, file: one }),
      persist({ frame: coder, ns: b, file: two }),
    ],
  });
  const session = scope.createSession();
  await session.run(coder.turn, { input: "next A", ns: a });
  await session.run(coder.turn, { input: "first B", ns: b });
  expect(lines(one).map((message) => message.content)).toEqual(["earlier A", "next A", replyText]);
  expect(lines(two).map((message) => message.content)).toEqual(["first B", replyText]);
  await scope.close();
});

test("restore reads a JSONL file into messages and a missing file into an empty transcript", () => {
  const file = tempFile();
  writeFileSync(
    file,
    `${JSON.stringify({ role: "user", content: "a" })}\n${JSON.stringify({ role: "assistant", content: "b" })}\n`,
  );
  expect(restore(file)).toEqual([
    { role: "user", content: "a" },
    { role: "assistant", content: "b" },
  ]);
  expect(restore(join(tmpdir(), "tinkerer-no-such-file.jsonl"))).toEqual([]);
});

test("two files under one scope keep two transcripts apart", async () => {
  const one = tempFile();
  const two = tempFile();
  const scope = createScope({
    tags: [backend(recording([])), coder.config({ model: "m", baseUrl: "https://api" })],
    extensions: [persist({ frame: coder, file: one })],
  });
  await scope.createSession().run(coder.turn, { input: "first" });
  await scope.close();
  const scope2 = createScope({
    tags: [backend(recording([])), coder.config({ model: "m", baseUrl: "https://api" })],
    extensions: [persist({ frame: coder, file: two })],
  });
  await scope2.createSession().run(coder.turn, { input: "second" });
  await scope2.close();
  expect(lines(one).map((message) => message.content)).toEqual(["first", replyText]);
  expect(lines(two).map((message) => message.content)).toEqual(["second", replyText]);
});

test("a session with a missing file keeps the messages it inherited", async () => {
  const file = tempFile();
  const scope = createScope({
    tags: [backend(recording([])), coder.config({ model: "m", baseUrl: "https://api" })],
    extensions: [persist({ frame: coder, file })],
  });
  scope.controller(coder.messages).set([{ role: "user", content: "kept" }]);
  const session = scope.createSession();
  expect(session.resolve(coder.messages)).toEqual([{ role: "user", content: "kept" }]);
  await scope.close();
});
