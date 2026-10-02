import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import { operation } from "@tinker/core";
import { argv, io, positionals, run, type Process } from "../../src/process/index.ts";
import { backend, HttpResponse, type HttpClient, type HttpRequest } from "../../src/http/index.ts";
import { tinkerer } from "../../src/tinkerer/index.ts";

const answer = readFileSync(new URL("./fixtures/answer.sse", import.meta.url));

const replyText =
  "In `README.md`:\n\n```md\n# tinkered\n\nA tiny engine. Scope, session, operation, resource, data cell.\n```";

const coder = tinkerer({ label: "coder" });

/** The prompt from argv: the plain words, with the values of `--cwd` and `--mode` skipped.
 * Those two take a value; every other flag is boolean and drops alone. */
function readPrompt(args: readonly string[]): string {
  return positionals(args, { values: ["--cwd", "--mode"] }).join(" ");
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

const shell: Process.Shell = {
  name: "tinkerer",
  version: "0.0.0",
  commands: [
    {
      name: "ask",
      description: "run one turn and print the answer as it streams",
      entry: () => ({ kind: "command", op: ask }),
    },
  ],
};

async function runCommand(args: readonly string[], seen: HttpRequest.Record[] = []) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await run({
    shell,
    args,
    options: {
      tags: [backend(recording(seen)), coder.config({ model: "m", baseUrl: "https://api" })],
    },
    io: {
      write: (text) => stdout.push(text),
      error: (text) => stderr.push(text),
    },
  });
  return { code, stdout: stdout.join(""), stderr: stderr.join("") };
}

test("ask runs one turn and prints the answer with exit code 0", async () => {
  const result = await runCommand(["ask", "read", "the", "readme"]);
  expect(result.code).toBe(0);
  expect(result.stdout).toBe(`${replyText}\n`);
  expect(result.stderr).toBe("");
});

test("ask writes the reply to io in pieces that join to the reply and a newline", async () => {
  const written: string[] = [];
  const code = await run({
    shell,
    args: ["ask", "read it"],
    options: {
      tags: [backend(recording([])), coder.config({ model: "m", baseUrl: "https://api" })],
    },
    io: { write: (text) => written.push(text), error: () => {} },
  });
  expect(code).toBe(0);
  expect(written.length).toBeGreaterThan(2);
  expect(written.join("")).toBe(`${replyText}\n`);
});

test("ask with no prompt exits 2 with its usage on stderr and sends no request", async () => {
  const seen: HttpRequest.Record[] = [];
  const result = await runCommand(["ask"], seen);
  expect(result.code).toBe(2);
  expect(result.stderr).toBe("usage: ask <prompt>\n");
  expect(seen).toHaveLength(0);
});

test("ask joins the prompt words with spaces and drops --flags with their values", async () => {
  const seen: HttpRequest.Record[] = [];
  await runCommand(["ask", "read", "--mode", "full-access", "the", "readme"], seen);
  const body = seen[0]?.body;
  if (body === undefined || body.kind !== "text") throw new Error("expected a JSON body");
  const parsed = JSON.parse(body.text) as { messages: { role: string; content: string }[] };
  expect(parsed.messages[parsed.messages.length - 1]).toEqual({
    role: "user",
    content: "read the readme",
  });
});

test("ask keeps a plain word after a boolean flag: ask --json hello sends hello", async () => {
  const seen: HttpRequest.Record[] = [];
  const result = await runCommand(["ask", "--json", "hello"], seen);
  expect(result.code).toBe(0);
  const body = seen[0]?.body;
  if (body === undefined || body.kind !== "text") throw new Error("expected a JSON body");
  const parsed = JSON.parse(body.text) as { messages: { role: string; content: string }[] };
  expect(parsed.messages[parsed.messages.length - 1]?.content).toBe("hello");
});

test("an unknown command exits 2 and lists ask in the usage", async () => {
  const result = await runCommand(["nope"]);
  expect(result.code).toBe(2);
  expect(result.stderr).toContain("  ask");
});

test("help lists ask with its description and sends no request", async () => {
  const seen: HttpRequest.Record[] = [];
  const result = await runCommand(["help"], seen);
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("ask  run one turn and print the answer as it streams");
  expect(seen).toHaveLength(0);
});
