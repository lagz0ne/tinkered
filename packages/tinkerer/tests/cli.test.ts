import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import { createScope } from "@tinker/core";
import { backend, HttpResponse, type HttpClient } from "@tinker/http";
import { cli } from "@tinker/cli";
import { askCommand, tinkerer } from "../src/index.ts";

const answer = readFileSync(new URL("./fixtures/answer.sse", import.meta.url));

const replyText =
  "In `README.md`:\n\n```md\n# tinkered\n\nA tiny engine. Scope, session, operation, resource, data cell.\n```";

const fake: HttpClient.Backend = async (request) =>
  HttpResponse.make(request, { status: 200, body: answer });

const coder = tinkerer({ label: "coder" });

test("ask runs one turn and prints the answer with exit code 0", async () => {
  const ext = cli({ name: "tinkerer", version: "0.0.0", commands: [askCommand(coder)] });
  const scope = createScope({
    tags: [backend(fake), coder.config({ model: "m", baseUrl: "https://api" })],
    extensions: [ext],
  });
  await scope.ready;
  const result = await scope.resolve(ext)(["ask", "read", "the", "readme"], {
    stdout: () => undefined,
    stderr: () => undefined,
  });
  expect(result.code).toBe(0);
  expect(result.stdout).toContain(replyText);
  await scope.close();
});

test("ask with no prompt exits with a usage code", async () => {
  const ext = cli({ name: "tinkerer", version: "0.0.0", commands: [askCommand(coder)] });
  const scope = createScope({
    tags: [backend(fake), coder.config({ model: "m", baseUrl: "https://api" })],
    extensions: [ext],
  });
  await scope.ready;
  const result = await scope.resolve(ext)(["ask"], {
    stdout: () => undefined,
    stderr: () => undefined,
  });
  expect(result.code).toBe(2);
  await scope.close();
});

test("an unknown command exits with a usage code", async () => {
  const ext = cli({ name: "tinkerer", version: "0.0.0", commands: [askCommand(coder)] });
  const scope = createScope({
    tags: [backend(fake), coder.config({ model: "m", baseUrl: "https://api" })],
    extensions: [ext],
  });
  await scope.ready;
  const result = await scope.resolve(ext)(["nope"], {
    stdout: () => undefined,
    stderr: () => undefined,
  });
  expect(result.code).toBe(2);
  await scope.close();
});
