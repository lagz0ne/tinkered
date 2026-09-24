import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import { createScope, operation, type Observe } from "@tinker/core";
import { backend, HttpResponse, type HttpClient, type HttpRequest } from "@tinker/http";
import { tinkerer, tool, type Tinkerer } from "../src/index.ts";

const answer = readFileSync(new URL("./fixtures/answer.sse", import.meta.url));

/** A backend that answers `bodies[n]` to the n-th request, then repeats the last. */
function scripted(seen: HttpRequest.Record[], bodies: (string | Uint8Array)[]): HttpClient.Backend {
  return async (request) => {
    seen.push(request);
    return HttpResponse.make(request, {
      status: 200,
      body: bodies[Math.min(seen.length - 1, bodies.length - 1)] ?? answer,
    });
  };
}

/** One streamed reply asking for `calls`, each `{ name, args }`, then `[DONE]`. */
function askingFor(
  calls: readonly { name: string; args: string }[],
  finish = "tool_calls",
): string {
  const pieces = calls.map((call, index) =>
    JSON.stringify({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index,
                id: `call_${index}`,
                type: "function",
                function: { name: call.name, arguments: call.args },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    }),
  );
  const end = JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] });
  return [...pieces, end].map((data) => `data: ${data}\n\n`).join("") + "data: [DONE]\n\n";
}

/** The attributes of every log line whose message is `message`, in order. */
function lines(logs: readonly Observe.Log[], message: string): Record<string, unknown>[] {
  return logs.filter((entry) => entry.message === message).map((entry) => entry.attributes);
}

test("each executed tool call logs its name and whether it ran", async () => {
  const logs: Observe.Log[] = [];
  const ok = operation({
    label: "ok",
    input: (raw: unknown) => raw as Record<string, unknown>,
    run: () => "ran",
  });
  const boom = operation({
    label: "boom",
    input: (raw: unknown) => raw as Record<string, unknown>,
    run: () => Promise.reject(new Error("nope")),
  });
  const frame = tinkerer({
    label: "coder",
    tools: [
      tool(ok, { description: "ok", schema: {}, sequential: true }),
      tool(boom, { description: "boom", schema: {} }),
    ],
  });
  const seen: HttpRequest.Record[] = [];
  const scope = createScope({
    observe: { log: (entry) => logs.push(entry) },
    tags: [
      backend(
        scripted(seen, [
          askingFor([
            { name: "ok", args: "{}" },
            { name: "boom", args: "{}" },
          ]),
          answer,
        ]),
      ),
      frame.config({ model: "m", baseUrl: "https://api" }),
    ],
  });
  await scope.createSession().run(frame.turn, { input: "go" });
  expect(lines(logs, "tinkerer tool")).toEqual([
    { name: "ok", ok: true },
    { name: "boom", ok: false },
  ]);
  await scope.close();
});

test("a call that never runs logs ok false for each reason", async () => {
  const logs: Observe.Log[] = [];
  const guarded = operation({
    label: "guarded",
    input: (raw: unknown) => raw as Record<string, unknown>,
    run: () => "ran",
  });
  const frame = tinkerer({
    label: "coder",
    tools: [
      tool(guarded, {
        description: "guarded",
        schema: {},
        mode: "workspace-write",
        sequential: true,
      }),
    ],
  });
  const seen: HttpRequest.Record[] = [];
  const scope = createScope({
    observe: { log: (entry) => logs.push(entry) },
    tags: [
      backend(
        scripted(seen, [
          askingFor([
            { name: "guarded", args: "{not json" },
            { name: "missing", args: "{}" },
            { name: "guarded", args: "{}" },
          ]),
          answer,
        ]),
      ),
      frame.config({ model: "m", baseUrl: "https://api" }),
    ],
  });
  await scope.createSession().run(frame.turn, { input: "go" });
  expect(lines(logs, "tinkerer tool")).toEqual([
    { name: "guarded", ok: false },
    { name: "missing", ok: false },
    { name: "guarded", ok: false },
  ]);
  await scope.close();
});

test("a reply cut by the token limit logs ok false for every call", async () => {
  const logs: Observe.Log[] = [];
  const counting = operation({
    label: "counting",
    input: (raw: unknown) => raw as Record<string, unknown>,
    run: () => "ran",
  });
  const frame = tinkerer({
    label: "coder",
    tools: [tool(counting, { description: "counting", schema: {} })],
  });
  const seen: HttpRequest.Record[] = [];
  const scope = createScope({
    observe: { log: (entry) => logs.push(entry) },
    tags: [
      backend(scripted(seen, [askingFor([{ name: "counting", args: "{}" }], "length"), answer])),
      frame.config({ model: "m", baseUrl: "https://api" }),
    ],
  });
  await scope.createSession().run(frame.turn, { input: "go" });
  expect(lines(logs, "tinkerer tool")).toEqual([{ name: "counting", ok: false }]);
  await scope.close();
});

test("a gate decision logs the tool name and whether it allowed", async () => {
  const logs: Observe.Log[] = [];
  const act = operation({
    label: "act",
    input: (raw: unknown) => raw as Record<string, unknown>,
    run: () => "ran",
  });
  const blocking: Tinkerer.Gate = operation({
    label: "blocking",
    run: (): Tinkerer.Decision => ({ allow: false, reason: "no" }),
  });
  const frame = tinkerer({
    label: "coder",
    tools: [tool(act, { description: "act", schema: {} })],
    gate: blocking,
  });
  const seen: HttpRequest.Record[] = [];
  const scope = createScope({
    observe: { log: (entry) => logs.push(entry) },
    tags: [
      backend(scripted(seen, [askingFor([{ name: "act", args: "{}" }]), answer])),
      frame.config({ model: "m", baseUrl: "https://api" }),
    ],
  });
  await scope.createSession().run(frame.turn, { input: "go" });
  expect(lines(logs, "tinkerer gate")).toEqual([{ name: "act", allow: false }]);
  await scope.close();
});

test("the turn logs its finish reason and the output token count", async () => {
  const logs: Observe.Log[] = [];
  const coder = tinkerer({ label: "coder" });
  const seen: HttpRequest.Record[] = [];
  const scope = createScope({
    observe: { log: (entry) => logs.push(entry) },
    tags: [backend(scripted(seen, [answer])), coder.config({ model: "m", baseUrl: "https://api" })],
  });
  await scope.createSession().run(coder.turn, { input: "hi" });
  const turnLines = lines(logs, "tinkerer turn");
  expect(turnLines).toHaveLength(1);
  expect(turnLines[0]?.["finish"]).toBe("stop");
  expect(turnLines[0]?.["output"]).toBe(194);
  expect(Object.keys(turnLines[0] ?? {}).sort()).toEqual(["finish", "input", "output"]);
  await scope.close();
});
