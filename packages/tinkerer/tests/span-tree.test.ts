import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import { createScope, type Observe } from "@tinker/core";
import { backend, HttpResponse, type HttpClient } from "@tinker/http";
import { tinkerer, tool } from "../src/index.ts";
import { operation } from "@tinker/core";

const answer = readFileSync(new URL("./fixtures/answer.sse", import.meta.url));
const ask = readFileSync(new URL("./fixtures/ask.sse", import.meta.url));

/** The span tree as indented `name` lines, in start order (ADR 0058). */
function shape(spans: readonly Observe.Span[]): string[] {
  const byId = new Map(spans.map((span) => [span.id, span]));
  const depth = (span: Observe.Span): number => {
    let n = 0;
    for (let at = span.parentId; at !== undefined; at = byId.get(at)?.parentId) n += 1;
    return n;
  };
  return [...spans]
    .sort((a, b) => a.id - b.id)
    .map((span) => `${"  ".repeat(depth(span))}${span.name}`);
}

/** A backend answering `bodies[n]` to the n-th request, then repeating the last. */
function scripted(bodies: (string | Uint8Array)[]): HttpClient.Backend {
  let n = 0;
  return async (request) => {
    const body = bodies[Math.min(n, bodies.length - 1)] ?? answer;
    n += 1;
    return HttpResponse.make(request, { status: 200, body });
  };
}

test("a turn's trace shows the step it took, with the http send beneath it", async () => {
  const coder = tinkerer({ label: "coder" });
  const scope = createScope({
    tags: [backend(scripted([answer])), coder.config({ model: "m", baseUrl: "https://api" })],
    observe: { history: 100 },
  });
  const session = scope.createSession();
  await session.run(coder.turn, { input: "hi" });
  expect(shape(scope.spans())).toEqual([
    "coder.turn",
    "  coder.http.step",
    "    http.send",
    "      http.attempt",
  ]);
  await scope.close();
});

test("a tool call appears in the trace as its own operation under the turn", async () => {
  const runs: string[] = [];
  const act = operation({
    label: "act",
    input: (raw: unknown) => raw as Record<string, unknown>,
    run: () => {
      runs.push("ran");
      return "did it";
    },
  });
  const coder = tinkerer({
    label: "coder",
    tools: [tool(act, { description: "acts", schema: {}, name: "read" })],
  });
  const scope = createScope({
    tags: [backend(scripted([ask, answer])), coder.config({ model: "m", baseUrl: "https://api" })],
    observe: { history: 100 },
  });
  const session = scope.createSession();
  await session.run(coder.turn, { input: "read it" });
  expect(runs).toEqual(["ran"]);
  expect(shape(scope.spans())).toEqual([
    "coder.turn",
    "  coder.http.step",
    "    http.send",
    "      http.attempt",
    "  act",
    "  coder.http.step",
    "    http.send",
    "      http.attempt",
  ]);
  await scope.close();
});
