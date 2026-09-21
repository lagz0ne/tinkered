import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import { createScope, data } from "@tinker/core";
import { backend, HttpResponse, type HttpClient, type HttpRequest } from "@tinker/http";
import { gate, tinkerer, tool, type Tinkerer } from "../src/index.ts";
import { operation } from "@tinker/core";

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

/** One streamed reply asking for one call `{ name, args }`, then `[DONE]`. */
function askingFor(name: string, args: string): string {
  const call = JSON.stringify({
    choices: [
      {
        delta: {
          tool_calls: [
            { index: 0, id: "call_0", type: "function", function: { name, arguments: args } },
          ],
        },
        finish_reason: null,
      },
    ],
  });
  const end = JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] });
  return `data: ${call}\n\ndata: ${end}\n\ndata: [DONE]\n\n`;
}

/** The tool messages of a transcript, in order. */
function toolMessages(transcript: readonly Tinkerer.Message[]): string[] {
  return transcript.flatMap((message) => (message.role === "tool" ? [message.content] : []));
}

/** A counting tool that records its runs and answers "did it". */
function countingTool(runs: { n: number }): Tinkerer.Tool {
  const op = operation({
    label: "act",
    input: (raw: unknown) => raw as Record<string, unknown>,
    run: () => {
      runs.n += 1;
      return "did it";
    },
  });
  return tool(op, { description: "acts", schema: {} });
}

test("a blocking gate answers the model with a declined result and the tool never runs", async () => {
  const runs = { n: 0 };
  const coder = tinkerer({
    label: "coder",
    tools: [countingTool(runs)],
    gate: gate(() => ({ allow: false, reason: "not now" })),
  });
  const seen: HttpRequest.Record[] = [];
  const scope = createScope({
    tags: [
      backend(scripted(seen, [askingFor("act", '{"x":1}'), answer])),
      coder.config({ model: "m", baseUrl: "https://api" }),
    ],
  });
  const session = scope.createSession();
  await session.run(coder.turn, { input: "go" });
  expect(toolMessages(session.resolve(coder.messages))).toEqual(["Tool act was declined: not now"]);
  expect(runs.n).toBe(0);
  await scope.close();
});

test("an allowing gate lets the tool run", async () => {
  const runs = { n: 0 };
  const coder = tinkerer({
    label: "coder",
    tools: [countingTool(runs)],
    gate: gate(() => ({ allow: true })),
  });
  const seen: HttpRequest.Record[] = [];
  const scope = createScope({
    tags: [
      backend(scripted(seen, [askingFor("act", "{}"), answer])),
      coder.config({ model: "m", baseUrl: "https://api" }),
    ],
  });
  const session = scope.createSession();
  await session.run(coder.turn, { input: "go" });
  expect(toolMessages(session.resolve(coder.messages))).toEqual(["did it"]);
  expect(runs.n).toBe(1);
  await scope.close();
});

test("the gate receives the tool name, the parsed arguments, the mode, and the wire call", async () => {
  const runs = { n: 0 };
  let seen: Tinkerer.GateRequest | undefined;
  const coder = tinkerer({
    label: "coder",
    tools: [countingTool(runs)],
    gate: gate((request) => {
      seen = request;
      return { allow: true };
    }),
  });
  const scope = createScope({
    tags: [
      backend(scripted([], [askingFor("act", '{"path":"x"}'), answer])),
      coder.config({ model: "m", baseUrl: "https://api" }),
      coder.mode("full-access"),
    ],
  });
  await scope.createSession().run(coder.turn, { input: "go" });
  expect(seen?.name).toBe("act");
  expect(seen?.args).toEqual({ path: "x" });
  expect(seen?.mode).toBe("full-access");
  expect(seen?.call).toEqual({
    id: "call_0",
    type: "function",
    function: { name: "act", arguments: '{"path":"x"}' },
  });
  await scope.close();
});

test("a gate may read a cell to decide, so a policy or a human can drive it", async () => {
  const allowed = data<boolean>({ label: "allowed", initial: false });
  const runs = { n: 0 };
  const decide = operation({
    label: "policy",
    input: (raw: unknown) => raw as Tinkerer.GateRequest,
    depends: { allowed: allowed.controller },
    run: (deps): Tinkerer.Decision =>
      deps.allowed.get() ? { allow: true } : { allow: false, reason: "held" },
  });
  const coder = tinkerer({ label: "coder", tools: [countingTool(runs)], gate: decide });
  const build = () =>
    createScope({
      tags: [
        backend(scripted([], [askingFor("act", "{}"), answer])),
        coder.config({ model: "m", baseUrl: "https://api" }),
      ],
    });
  const held = build();
  await held.createSession().run(coder.turn, { input: "go" });
  expect(runs.n).toBe(0);
  await held.close();
  const open = build();
  open.controller(allowed).set(true);
  await open.createSession().run(coder.turn, { input: "go" });
  expect(runs.n).toBe(1);
  await open.close();
});
