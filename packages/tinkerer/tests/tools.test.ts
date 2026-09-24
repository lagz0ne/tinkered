import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { createScope, isError as isCoreError, operation } from "@tinker/core";
import { backend, HttpResponse, type HttpClient, type HttpRequest } from "@tinker/http";
import {
  cwd,
  isError,
  read,
  readTool,
  shippedTools,
  tinkerer,
  tool,
  type Tinkerer,
} from "../src/index.ts";

const ask = readFileSync(new URL("./fixtures/ask.sse", import.meta.url));
const answer = readFileSync(new URL("./fixtures/answer.sse", import.meta.url));

const lines = ["line one", "line two", "line three"];
const toolId = "call_01a0c37b9cbe701e9136fc698fbf76a5";

/** The recorded second-step reply, in full. */
const replyText =
  "In `README.md`:\n\n```md\n# tinkered\n\nA tiny engine. Scope, session, operation, resource, data cell.\n```";

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

function readBody(seen: HttpRequest.Record[], index = 0): Record<string, unknown> {
  const body = seen[index]?.body;
  if (body === undefined || body.kind !== "text") throw new Error("tinkerer: expected a JSON body");
  return JSON.parse(body.text) as Record<string, unknown>;
}

/** The smallest parse a counting tool needs: an object with a string `path`. */
function readPath(raw: unknown): { path: string } {
  if (typeof raw !== "object" || raw === null || !("path" in raw) || typeof raw.path !== "string")
    throw new Error("expected { path }");
  return { path: raw.path };
}

/** A temp dir whose README.md holds the three lines. */
function readmeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "tinkerer-"));
  writeFileSync(join(dir, "README.md"), lines.join("\n"));
  return dir;
}

const coder = tinkerer({ label: "coder", tools: [readTool] });

function toolScope(
  seen: HttpRequest.Record[],
  dir: string,
  extra = coder.config({}),
): ReturnType<typeof createScope> {
  return createScope({
    tags: [
      backend(scripted(seen, [ask, answer])),
      coder.config({ model: "m", baseUrl: "https://api" }),
      cwd(dir),
      extra,
    ],
  });
}

test("a reply with a tool call runs the tool as a subflow and the next step carries its result", async () => {
  const seen: HttpRequest.Record[] = [];
  const scope = toolScope(seen, readmeDir());
  const session = scope.createSession();
  const reply = await session.run(coder.turn, { input: "read it" });
  expect(reply.message.content).toBe(replyText);
  expect(seen).toHaveLength(2);
  const carried = readBody(seen, 1)["messages"] as readonly Tinkerer.Message[];
  expect(carried[carried.length - 2]).toEqual({
    role: "assistant",
    content: "I'll read README.md for you.",
    tool_calls: [
      {
        id: toolId,
        type: "function",
        function: { name: "read", arguments: '{"path":"README.md"}' },
      },
    ],
  });
  expect(carried[carried.length - 1]).toEqual({
    role: "tool",
    tool_call_id: toolId,
    content: lines.join("\n"),
  });
  await scope.close();
});

test("the request advertises every row as a function tool with its JSON schema", async () => {
  const seen: HttpRequest.Record[] = [];
  const scope = toolScope(seen, readmeDir());
  await scope.createSession().run(coder.turn, { input: "read it" });
  const tools = readBody(seen)["tools"] as readonly {
    type: string;
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }[];
  expect(tools).toHaveLength(1);
  expect(tools[0]?.type).toBe("function");
  expect(tools[0]?.function.name).toBe("read");
  expect(tools[0]?.function.description).toBe(
    "Read a file under cwd, optionally a window of lines",
  );
  const parameters = tools[0]?.function.parameters as {
    required: readonly string[];
  } & Record<string, unknown>;
  expect(parameters.required).toEqual(["path"]);
  expect(parameters["$schema"]).toBeUndefined();
  await scope.close();
});

test("a tool the frame does not know answers the model with a not-found result", async () => {
  const bare = tinkerer({ label: "bare" });
  const seen: HttpRequest.Record[] = [];
  const scope = createScope({
    tags: [
      backend(scripted(seen, [ask, answer])),
      bare.config({ model: "m", baseUrl: "https://api" }),
    ],
  });
  const session = scope.createSession();
  const reply = await session.run(bare.turn, { input: "read it" });
  const transcript = session.resolve(bare.messages);
  expect(transcript[transcript.length - 2]).toEqual({
    role: "tool",
    tool_call_id: toolId,
    content: "Tool read not found",
  });
  expect(reply.message.content).toBe(replyText);
  await scope.close();
});

test("a read-only mode blocks a workspace-write tool and tells the model why", async () => {
  let runs = 0;
  const writer = operation({
    label: "gated",
    run: () => {
      runs += 1;
      return "wrote";
    },
  });
  const gated = tinkerer({
    label: "gated",
    tools: [
      tool(writer, { description: "writes", schema: {}, mode: "workspace-write", name: "read" }),
    ],
  });
  const seen: HttpRequest.Record[] = [];
  const scope = createScope({
    tags: [
      backend(scripted(seen, [ask, answer])),
      gated.config({ model: "m", baseUrl: "https://api" }),
    ],
  });
  const session = scope.createSession();
  await session.run(gated.turn, { input: "read it" });
  const transcript = session.resolve(gated.messages);
  expect(transcript[transcript.length - 2]).toEqual({
    role: "tool",
    tool_call_id: toolId,
    content: "Tool read is blocked: mode is read-only, it needs workspace-write",
  });
  expect(runs).toBe(0);
  await scope.close();
});

test("a session bound to full-access lets the same tool run", async () => {
  let runs = 0;
  const writer = operation({
    label: "open",
    run: () => {
      runs += 1;
      return "wrote";
    },
  });
  const open = tinkerer({
    label: "open",
    tools: [
      tool(writer, { description: "writes", schema: {}, mode: "workspace-write", name: "read" }),
    ],
  });
  const seen: HttpRequest.Record[] = [];
  const scope = createScope({
    tags: [
      backend(scripted(seen, [ask, answer])),
      open.config({ model: "m", baseUrl: "https://api" }),
    ],
  });
  const session = scope.createSession({ tags: [open.mode("full-access")] });
  await session.run(open.turn, { input: "read it" });
  expect(runs).toBe(1);
  const transcript = session.resolve(open.messages);
  expect(transcript[transcript.length - 2]).toEqual({
    role: "tool",
    tool_call_id: toolId,
    content: "wrote",
  });
  await scope.close();
});

test("a reply cut by the token limit fails every tool call without running it", async () => {
  let runs = 0;
  const counting = operation({
    label: "read",
    input: readPath,
    run: () => {
      runs += 1;
      return Promise.resolve("hit");
    },
  });
  const limited = tinkerer({
    label: "limited",
    tools: [tool(counting, { description: "counts reads", schema: {} })],
  });
  const cut = Buffer.from(
    ask.toString("utf8").replace('finish_reason":"tool_calls"', 'finish_reason":"length"'),
    "utf8",
  );
  const seen: HttpRequest.Record[] = [];
  const scope = createScope({
    tags: [
      backend(scripted(seen, [cut, answer])),
      limited.config({ model: "m", baseUrl: "https://api" }),
    ],
  });
  const session = scope.createSession();
  await session.run(limited.turn, { input: "read it" });
  const transcript = session.resolve(limited.messages);
  const toolMessage = transcript[transcript.length - 2];
  if (toolMessage?.role !== "tool") throw new Error("tinkerer: expected a tool message");
  expect(toolMessage.content.startsWith('Tool call "read" was not executed')).toBe(true);
  expect(runs).toBe(0);
  await scope.close();
});

test("a tool that throws answers the model with a failed result and the loop continues", async () => {
  const failing = operation({
    label: "read",
    run: () => Promise.reject(new Error("boom")),
  });
  const fragile = tinkerer({
    label: "fragile",
    tools: [tool(failing, { description: "fails", schema: {} })],
  });
  const seen: HttpRequest.Record[] = [];
  const scope = createScope({
    tags: [
      backend(scripted(seen, [ask, answer])),
      fragile.config({ model: "m", baseUrl: "https://api" }),
    ],
  });
  const session = scope.createSession();
  const reply = await session.run(fragile.turn, { input: "read it" });
  const transcript = session.resolve(fragile.messages);
  expect(transcript[transcript.length - 2]).toEqual({
    role: "tool",
    tool_call_id: toolId,
    content: "Tool read failed: boom",
  });
  expect(reply.message.content).toBe(replyText);
  await scope.close();
});

test("read returns a window of lines and refuses a path outside cwd", async () => {
  const dir = readmeDir();
  const scope = createScope({ tags: [cwd(dir)] });
  const session = scope.createSession();
  const window = await session.run(read, { rawInput: { path: "README.md", offset: 1, limit: 1 } });
  expect(window).toBe("line two");
  const failure = await session.run(read, { rawInput: { path: "../x" } }).then(
    () => null,
    (error: unknown) => error,
  );
  if (!isError(failure, "PathOutsideCwd")) throw failure;
  expect(failure.payload).toEqual({ label: "read", path: "../x" });
  if (isCoreError(failure, "DataValidationFailed")) throw new Error("tinkerer: wrong failure");
  await scope.close();
});

test("settings are seeded from the tags at turn start and read at the step", async () => {
  const seen: HttpRequest.Record[] = [];
  const scope = toolScope(seen, readmeDir(), coder.config({ reasoning_effort: "low" }));
  const session = scope.createSession();
  await session.run(coder.turn, { input: "read it" });
  expect(session.resolve(coder.settings)).toEqual({
    mode: "read-only",
    options: { model: "m", reasoning_effort: "low" },
  });
  expect(readBody(seen)["reasoning_effort"]).toBe("low");
  await scope.close();
});

/** One streamed reply asking for `calls`, each `{ name, args }`, then `[DONE]`. */
function askingFor(calls: readonly { name: string; args: string }[]): string {
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
  const end = JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] });
  return [...pieces, end].map((data) => `data: ${data}\n\n`).join("") + "data: [DONE]\n\n";
}

/** The tool messages of a transcript, in order. */
function toolMessages(transcript: readonly Tinkerer.Message[]): string[] {
  return transcript.flatMap((message) => (message.role === "tool" ? [message.content] : []));
}

test("two rows with one wire name fail construction with DuplicateTool", () => {
  const twin = operation({ label: "read", run: () => "" });
  try {
    tinkerer({
      label: "twins",
      tools: [readTool, tool(twin, { description: "again", schema: {} })],
    });
    expect.unreachable();
  } catch (error) {
    if (!isError(error, "DuplicateTool")) throw error;
    expect(error.payload).toEqual({ label: "twins", name: "read" });
  }
});

test("a tool call whose arguments are not JSON answers the model with an error result", async () => {
  let runs = 0;
  const counting = operation({
    label: "read",
    input: readPath,
    run: () => {
      runs += 1;
      return "hit";
    },
  });
  const frame = tinkerer({
    label: "badjson",
    tools: [tool(counting, { description: "counts", schema: {} })],
  });
  const seen: HttpRequest.Record[] = [];
  const scope = createScope({
    tags: [
      backend(scripted(seen, [askingFor([{ name: "read", args: "{not json" }]), answer])),
      frame.config({ model: "m", baseUrl: "https://api" }),
    ],
  });
  const session = scope.createSession();
  await session.run(frame.turn, { input: "go" });
  const [content] = toolMessages(session.resolve(frame.messages));
  expect(content?.startsWith("Tool read: arguments are not JSON: ")).toBe(true);
  expect(runs).toBe(0);
  await scope.close();
});

test("a frame with no tool rows sends no tools field at all", async () => {
  const bare = tinkerer({ label: "bare" });
  const seen: HttpRequest.Record[] = [];
  const scope = createScope({
    tags: [backend(scripted(seen, [answer])), bare.config({ model: "m", baseUrl: "https://api" })],
  });
  await scope.createSession().run(bare.turn, { input: "hi" });
  expect("tools" in readBody(seen)).toBe(false);
  await scope.close();
});

test("the request lists each shipped row with its own name, description and schema", async () => {
  const shipped = tinkerer({ label: "shipped", tools: shippedTools });
  const seen: HttpRequest.Record[] = [];
  const scope = createScope({
    tags: [
      backend(scripted(seen, [answer])),
      shipped.config({ model: "m", baseUrl: "https://api" }),
    ],
  });
  await scope.createSession().run(shipped.turn, { input: "hi" });
  const tools = readBody(seen)["tools"] as readonly {
    function: {
      name: string;
      description: string;
      parameters: { required?: readonly string[] };
    };
  }[];
  expect(tools.map((row) => row.function.name)).toEqual(["read", "edit", "write", "bash"]);
  expect(tools.map((row) => row.function.description)).toEqual([
    "Read a file under cwd, optionally a window of lines",
    "Replace one exact occurrence of oldText by newText in a file under cwd",
    "Write a whole file under cwd, creating parent folders",
    "Run a bash command in cwd; answers its combined output and exit code",
  ]);
  expect(tools[0]?.function.parameters.required).toEqual(["path"]);
  expect(tools[3]?.function.parameters.required).toEqual(["command"]);
  await scope.close();
});

test("an assistant message with tool calls and no text carries null content", async () => {
  const seen: HttpRequest.Record[] = [];
  const reply = askingFor([{ name: "read", args: '{"path":"README.md"}' }]);
  const scope = createScope({
    tags: [
      backend(scripted(seen, [reply, answer])),
      coder.config({ model: "m", baseUrl: "https://api" }),
      cwd(readmeDir()),
    ],
  });
  const session = scope.createSession();
  await session.run(coder.turn, { input: "read it" });
  expect(session.resolve(coder.messages)[1]).toEqual({
    role: "assistant",
    content: null,
    tool_calls: [
      {
        id: "call_0",
        type: "function",
        function: { name: "read", arguments: '{"path":"README.md"}' },
      },
    ],
  });
  await scope.close();
});

test("a tool whose own input fails validation answers the cause's own message", async () => {
  const picky = operation({
    label: "picky",
    input: (): never => {
      throw new Error("needs a path");
    },
    run: () => "never",
  });
  const frame = tinkerer({ label: "picky", tools: [tool(picky, { description: "", schema: {} })] });
  const seen: HttpRequest.Record[] = [];
  const scope = createScope({
    tags: [
      backend(scripted(seen, [askingFor([{ name: "picky", args: "{}" }]), answer])),
      frame.config({ model: "m", baseUrl: "https://api" }),
    ],
  });
  const session = scope.createSession();
  await session.run(frame.turn, { input: "go" });
  expect(toolMessages(session.resolve(frame.messages))).toEqual([
    "Tool picky failed: needs a path",
  ]);
  await scope.close();
});

test("a sequential row runs a reply's calls one at a time and results keep the model's order", async () => {
  const order: string[] = [];
  const slow = operation({
    label: "slow",
    input: readPath,
    run: async (_deps, { clock }) => {
      order.push("slow:start");
      await clock.sleep(5);
      order.push("slow:end");
      return { took: "long" };
    },
  });
  const fast = operation({
    label: "fast",
    input: readPath,
    run: () => {
      order.push("fast");
      return undefined;
    },
  });
  const frame = tinkerer({
    label: "ordered",
    tools: [
      tool(slow, { description: "slow", schema: {}, sequential: true }),
      tool(fast, { description: "fast", schema: {} }),
    ],
  });
  const seen: HttpRequest.Record[] = [];
  const reply = askingFor([
    { name: "slow", args: '{"path":"a"}' },
    { name: "fast", args: '{"path":"b"}' },
  ]);
  const scope = createScope({
    tags: [
      backend(scripted(seen, [reply, answer])),
      frame.config({ model: "m", baseUrl: "https://api" }),
    ],
  });
  const session = scope.createSession();
  await session.run(frame.turn, { input: "go" });
  expect(order).toEqual(["slow:start", "slow:end", "fast"]);
  expect(toolMessages(session.resolve(frame.messages))).toEqual(['{"took":"long"}', ""]);
  await scope.close();
});

test("without a sequential row a reply's calls run at once", async () => {
  const order: string[] = [];
  const slow = operation({
    label: "slow",
    input: readPath,
    run: async (_deps, { clock }) => {
      order.push("slow:start");
      await clock.sleep(5);
      order.push("slow:end");
      return "slow";
    },
  });
  const fast = operation({
    label: "fast",
    input: readPath,
    run: () => {
      order.push("fast");
      return "fast";
    },
  });
  const frame = tinkerer({
    label: "parallel",
    tools: [
      tool(slow, { description: "slow", schema: {} }),
      tool(fast, { description: "fast", schema: {} }),
    ],
  });
  const seen: HttpRequest.Record[] = [];
  const reply = askingFor([
    { name: "slow", args: '{"path":"a"}' },
    { name: "fast", args: '{"path":"b"}' },
  ]);
  const scope = createScope({
    tags: [
      backend(scripted(seen, [reply, answer])),
      frame.config({ model: "m", baseUrl: "https://api" }),
    ],
  });
  const session = scope.createSession();
  await session.run(frame.turn, { input: "go" });
  expect(order).toEqual(["slow:start", "fast", "slow:end"]);
  expect(toolMessages(session.resolve(frame.messages))).toEqual(["slow", "fast"]);
  await scope.close();
});
