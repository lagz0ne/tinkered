import { expect, test } from "vite-plus/test";
import { createScope, preset, tag } from "@tinker/core";
import type { McpServerConfig, Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { claudeCode, harness, type ClaudeCode } from "../src/index.ts";
import { readResult, readSystemInit, readToolResult, readToolUse } from "./fixtures.ts";

/** What the fake SDK saw: every in-process server registered, every `query`'s options, and
 * what each tool handler returned when the fake "model" called it. */
type Seen = {
  servers: { name: string; tools: Parameters<ClaudeCode.Sdk["createSdkMcpServer"]>[0]["tools"] }[];
  queries: (Options | undefined)[];
  results: CallToolResult[];
};

/** A fake SDK module: `tool` keeps the definition, `createSdkMcpServer` records it and returns
 * a stdio config (a legit `McpServerConfig`), `query` calls the first registered tool with
 * `{ q: "x" }` before yielding the tool-use messages, so the model's call is simulated. */
function fakeSdk(seen: Seen): ClaudeCode.Sdk {
  return {
    tool: (name, description, schema, handler) => ({
      name,
      description,
      inputSchema: schema,
      handler,
    }),
    createSdkMcpServer: ({ name, tools }): McpServerConfig => {
      seen.servers.push({ name, tools });
      return { type: "stdio", command: "fake" };
    },
    query: ({ options }) => readStream(options, seen),
  };
}

/** The recorded turn: init, the simulated model call of the LAST registered server's first tool
 * (each session's thread registers its own) when a `coder` server is present, then the tool
 * use, its result, and the turn result. */
async function* readStream(options: Options | undefined, seen: Seen): AsyncGenerator<SDKMessage> {
  seen.queries.push(options);
  yield readSystemInit();
  const server = seen.servers[seen.servers.length - 1];
  const registered = options?.mcpServers?.coder === undefined ? undefined : server?.tools[0];
  if (registered !== undefined) seen.results.push(await registered.handler({ q: "x" }, {}));
  yield readToolUse();
  yield readToolResult();
  yield readResult("Hello");
}

const index = tag<string>({ label: "index", default: "base" });

test("a tool op runs as a subflow of the turn and its result reaches the SDK by identity", async () => {
  const seen: Seen = { servers: [], queries: [], results: [] };
  const answer: CallToolResult = { content: [{ type: "text", text: "found x" }] };
  const search = claudeCode.tool({
    name: "search",
    description: "find things",
    schema: { q: z.string() },
    run: (_deps, ctx) => (ctx.input.q === "x" ? answer : { content: [] }),
  });
  const coder = harness({ label: "coder", adapter: claudeCode, tools: [search] });
  const ask = coder.turn({ label: "ask", request: (prompt: string) => ({ prompt }) });
  const scope = createScope({
    observe: { history: 20 },
    presets: [preset(claudeCode.sdk, async () => fakeSdk(seen))],
  });
  const session = scope.createSession();
  await session.run(ask, { input: "hello" });
  expect(seen.results[0]).toBe(answer);
  const spans = scope.spans();
  const turn = spans.find((span) => span.name === "coder.ask");
  const call = spans.find((span) => span.name === "search");
  expect(call?.parentId).toBe(turn?.id);
  await scope.close();
});

test("the in-process server is built once per thread and reused across turns", async () => {
  const seen: Seen = { servers: [], queries: [], results: [] };
  const search = claudeCode.tool({
    name: "search",
    description: "find things",
    schema: { q: z.string() },
    run: (): CallToolResult => ({ content: [] }),
  });
  const coder = harness({ label: "coder", adapter: claudeCode, tools: [search] });
  const ask = coder.turn({ label: "ask", request: (prompt: string) => ({ prompt }) });
  const scope = createScope({ presets: [preset(claudeCode.sdk, async () => fakeSdk(seen))] });
  const session = scope.createSession();
  await session.run(ask, { input: "a" });
  await session.run(ask, { input: "b" });
  expect(seen.servers.length).toBe(1);
  expect(seen.servers[0].name).toBe("coder");
  expect(seen.queries.length).toBe(2);
  expect(seen.queries[1]?.mcpServers?.coder).toBe(seen.queries[0]?.mcpServers?.coder);
  await scope.close();
});

test("a user-bound mcpServers entry survives beside the frame's server", async () => {
  const seen: Seen = { servers: [], queries: [], results: [] };
  const search = claudeCode.tool({
    name: "search",
    description: "find things",
    schema: { q: z.string() },
    run: (): CallToolResult => ({ content: [] }),
  });
  const coder = harness({ label: "coder", adapter: claudeCode, tools: [search] });
  const ask = coder.turn({ label: "ask", request: (prompt: string) => ({ prompt }) });
  const scope = createScope({
    tags: [claudeCode.options({ mcpServers: { other: { command: "x" } } })],
    presets: [preset(claudeCode.sdk, async () => fakeSdk(seen))],
  });
  await scope.createSession().run(ask, { input: "hello" });
  expect(Object.keys(seen.queries[0]?.mcpServers ?? {}).sort()).toEqual(["coder", "other"]);
  await scope.close();
});

test("a tool op sees the session's own bindings", async () => {
  const seen: Seen = { servers: [], queries: [], results: [] };
  const search = claudeCode.tool({
    name: "search",
    description: "find things",
    schema: { q: z.string() },
    depends: { index },
    run: ({ index }, ctx): CallToolResult => ({
      content: [{ type: "text", text: `${index}:${ctx.input.q}` }],
    }),
  });
  const coder = harness({ label: "coder", adapter: claudeCode, tools: [search] });
  const ask = coder.turn({ label: "ask", request: (prompt: string) => ({ prompt }) });
  const scope = createScope({ presets: [preset(claudeCode.sdk, async () => fakeSdk(seen))] });
  await scope.createSession({ tags: [index("docs")] }).run(ask, { input: "a" });
  await scope.createSession({ tags: [index("code")] }).run(ask, { input: "b" });
  const texts = seen.results.map((result) => result.content[0]);
  expect(texts).toEqual([
    { type: "text", text: "docs:x" },
    { type: "text", text: "code:x" },
  ]);
  await scope.close();
});
