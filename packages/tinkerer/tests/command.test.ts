import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import { operation } from "@tinker/core";
import { argv, io, run, type Process } from "@tinker/process";
import { backend, HttpResponse, type HttpClient, type HttpRequest } from "@tinker/http";
import { tinkerer } from "../src/index.ts";

const answer = readFileSync(new URL("./fixtures/answer.sse", import.meta.url));

const replyText =
  "In `README.md`:\n\n```md\n# tinkered\n\nA tiny engine. Scope, session, operation, resource, data cell.\n```";

const coder = tinkerer({ label: "coder" });

/** The prompt from argv: the words that are not a `--flag` or a flag's value. */
function readPrompt(args: readonly string[]): string {
  return args
    .filter((word, at) => !word.startsWith("--") && args[at - 1]?.startsWith("--") !== true)
    .join(" ");
}

/** The `ask` command, declared by its author: one turn, the reply streamed through `io`, and
 * the exit code owned here. The frame's cells and operations it depends on are public. */
const ask = operation({
  label: "ask",
  depends: {
    argv: argv.required,
    io: io.required,
    text: coder.text.controller,
    turn: coder.turn,
  },
  run: async ({ argv: args, io: out, text, turn }) => {
    const prompt = readPrompt(args);
    if (prompt === "") {
      out.error("usage: ask <prompt>\n");
      return 2;
    }
    const stop = text.watch((next, previous) => out.write(next.slice(previous.length)));
    try {
      const reply = await turn.run({ input: prompt });
      out.write("\n");
      return reply.finish === "stop" ? 0 : 3;
    } finally {
      stop();
    }
  },
});

/** A backend that records every request and answers the recorded reply. */
function recording(seen: HttpRequest.Record[]): HttpClient.Backend {
  return async (request) => {
    seen.push(request);
    return HttpResponse.make(request, { status: 200, body: answer });
  };
}

/** The binary: one `ask` route whose root carries the fake model and the config. */
function shell(seen: HttpRequest.Record[] = []): Process.Shell {
  return {
    name: "tinkerer",
    version: "0.0.0",
    commands: [
      {
        name: "ask",
        description: "run one turn and print the answer as it streams",
        entry: () => ({
          op: ask,
          options: {
            tags: [backend(recording(seen)), coder.config({ model: "m", baseUrl: "https://api" })],
          },
        }),
      },
    ],
  };
}

test("ask runs one turn and prints the answer with exit code 0", async () => {
  const result = await run(shell(), ["ask", "read", "the", "readme"]);
  expect(result.code).toBe(0);
  expect(result.stdout).toBe(`${replyText}\n`);
  expect(result.stderr).toBe("");
});

test("ask writes the reply to io in pieces that join to the reply and a newline", async () => {
  const written: string[] = [];
  const result = await run(shell(), ["ask", "read it"], { write: (s) => written.push(s) });
  expect(result.code).toBe(0);
  expect(written.length).toBeGreaterThan(2);
  expect(written.join("")).toBe(`${replyText}\n`);
});

test("ask with no prompt exits 2 with its usage on stderr and sends no request", async () => {
  const seen: HttpRequest.Record[] = [];
  const result = await run(shell(seen), ["ask"]);
  expect(result.code).toBe(2);
  expect(result.stderr).toBe("usage: ask <prompt>\n");
  expect(seen).toHaveLength(0);
});

test("ask joins the prompt words with spaces and drops --flags with their values", async () => {
  const seen: HttpRequest.Record[] = [];
  await run(shell(seen), ["ask", "read", "--mode", "full-access", "the", "readme"]);
  const body = seen[0]?.body;
  if (body === undefined || body.kind !== "text") throw new Error("expected a JSON body");
  const parsed = JSON.parse(body.text) as { messages: { role: string; content: string }[] };
  expect(parsed.messages[parsed.messages.length - 1]).toEqual({
    role: "user",
    content: "read the readme",
  });
});

test("an unknown command exits 2 and lists ask in the usage", async () => {
  const result = await run(shell(), ["nope"]);
  expect(result.code).toBe(2);
  expect(result.stderr).toContain("  ask");
});

test("help lists ask with its description and sends no request", async () => {
  const seen: HttpRequest.Record[] = [];
  const result = await run(shell(seen), ["help"]);
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("ask  run one turn and print the answer as it streams");
  expect(seen).toHaveLength(0);
});
