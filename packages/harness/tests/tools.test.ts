import { expect, test } from "vite-plus/test";
import { createScope, operation, preset, tag } from "@tinker/core";
import { expose, isError, mcp, readTool, tool } from "@tinker/mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type {
  McpServerConfig,
  Options,
  PermissionResult,
  SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
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

/** The op edge and the declaration share one source: parse through the object built from the
 * raw shape (the shape `@tinker/mcp`'s tests declare the same way). */
function parseWith<T>(schema: { parse: (raw: unknown) => T }): (raw: unknown) => T {
  function parse(raw: unknown): T {
    return schema.parse(raw);
  }
  return parse;
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

const searchShape = { q: z.string() };
const parseSearch = parseWith(z.object(searchShape));

/** One declaration for every harness: a plain-value op with `tool` meta — the same shape
 * `@tinker/mcp`'s tests declare. The MCP driver and the Claude fast path map the value. */
const search = operation({
  label: "search",
  input: parseSearch,
  meta: [tool({ description: "find things", schema: searchShape })],
  run: (_deps, ctx) => `hit:${ctx.input.q}`,
});

test("a tool op runs as a subflow of the turn and answers the mapped value", async () => {
  const seen: Seen = { servers: [], queries: [], results: [] };
  const coder = harness({ label: "coder", adapter: claudeCode, tools: [search] });
  const ask = coder.turn({ label: "ask", request: (prompt: string) => ({ prompt }) });
  const scope = createScope({
    observe: { history: 20 },
    presets: [preset(claudeCode.sdk, async () => fakeSdk(seen))],
  });
  const session = scope.createSession();
  await session.run(ask, { input: "hello" });
  expect(seen.results[0]?.content).toEqual([{ type: "text", text: '"hit:x"' }]);
  const spans = scope.spans();
  const turn = spans.find((span) => span.name === "coder.ask");
  const call = spans.find((span) => span.name === "search");
  expect(call?.parentId).toBe(turn?.id);
  await scope.close();
});

test("the in-process server is built once per thread and reused across turns", async () => {
  const seen: Seen = { servers: [], queries: [], results: [] };
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
  const lookup = operation({
    label: "search",
    input: parseSearch,
    depends: { index },
    meta: [tool({ description: "find things", schema: searchShape })],
    run: ({ index }, ctx) => `${index}:${ctx.input.q}`,
  });
  const coder = harness({ label: "coder", adapter: claudeCode, tools: [lookup] });
  const ask = coder.turn({ label: "ask", request: (prompt: string) => ({ prompt }) });
  const scope = createScope({ presets: [preset(claudeCode.sdk, async () => fakeSdk(seen))] });
  await scope.createSession({ tags: [index("docs")] }).run(ask, { input: "a" });
  await scope.createSession({ tags: [index("code")] }).run(ask, { input: "b" });
  const texts = seen.results.map((result) => result.content[0]);
  expect(texts).toEqual([
    { type: "text", text: '"docs:x"' },
    { type: "text", text: '"code:x"' },
  ]);
  await scope.close();
});

test("a tool op without tool meta throws ToolUndeclared with its label", async () => {
  const bare = operation({ label: "bare", run: () => "hi" });
  try {
    harness({ label: "coder", adapter: claudeCode, tools: [bare] });
    expect.unreachable();
  } catch (error: unknown) {
    if (!isError(error, "ToolUndeclared")) throw error;
    expect(error.payload.label).toBe("bare");
  }
});

test("one declaration serves the MCP driver and the Claude fast path", async () => {
  const seen: Seen = { servers: [], queries: [], results: [] };
  const coder = harness({ label: "coder", adapter: claudeCode, tools: [search] });
  const ask = coder.turn({ label: "ask", request: (prompt: string) => ({ prompt }) });
  const ext = mcp({ name: "coder", version: "0", tools: [expose(search, readTool(search))] });
  const scope = createScope({
    extensions: [ext],
    presets: [preset(claudeCode.sdk, async () => fakeSdk(seen))],
  });
  await scope.ready;
  const server = scope.resolve(ext);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientTransport);
  const listed = await client.listTools();
  expect(listed.tools.find((entry) => entry.name === "search")?.description).toBe("find things");
  await scope.createSession().run(ask, { input: "hello" });
  expect(seen.servers[0]?.tools.map((entry) => entry.name)).toContain("search");
  await scope.close({ graceful: true });
});

test("a frame with approve and tools answers the approval and still calls the tool", async () => {
  const seen: Seen = { servers: [], queries: [], results: [] };
  const decisions: PermissionResult[] = [];
  const approve = operation({
    label: "approve",
    input: claudeCode.approval,
    run: (): PermissionResult => ({ behavior: "allow" }),
  });
  const coder = harness({ label: "coder", adapter: claudeCode, approve, tools: [search] });
  const ask = coder.turn({ label: "ask", request: (prompt: string) => ({ prompt }) });
  const scope = createScope({
    observe: { history: 20 },
    presets: [
      preset(claudeCode.sdk, async (): Promise<ClaudeCode.Sdk> => ({
        ...fakeSdk(seen),
        query: ({ options }: { prompt: string; options?: Options }) =>
          readApproving(options, seen, decisions),
      })),
    ],
  });
  const session = scope.createSession();
  await session.run(ask, { input: "hello" });
  expect(decisions).toEqual([{ behavior: "allow" }]);
  expect(seen.results[0]?.content).toEqual([{ type: "text", text: '"hit:x"' }]);
  const spans = scope.spans();
  const turn = spans.find((span) => span.name === "coder.ask");
  expect(spans.find((span) => span.name === "approve")?.parentId).toBe(turn?.id);
  expect(spans.find((span) => span.name === "search")?.parentId).toBe(turn?.id);
  await scope.close();
});

/** The recorded turn with the approval answered through `canUseTool` first. */
async function* readApproving(
  options: Options | undefined,
  seen: Seen,
  decisions: PermissionResult[],
): AsyncGenerator<SDKMessage> {
  const ask = options?.canUseTool;
  if (ask !== undefined) {
    const signal = options?.abortController?.signal ?? new AbortController().signal;
    const decision = await ask(
      "Bash",
      { command: "ls" },
      { signal, toolUseID: "tu-1", requestId: "r-1" },
    );
    if (decision !== null) decisions.push(decision);
  }
  yield* readStream(options, seen);
}

test("a named tool registers under its meta name, not the op label", async () => {
  const seen: Seen = { servers: [], queries: [], results: [] };
  const named = operation({
    label: "search",
    input: parseSearch,
    meta: [tool({ description: "find things", schema: searchShape, name: "lookup" })],
    run: (_deps, ctx) => `hit:${(ctx.input as { q: string }).q}`,
  });
  const coder = harness({ label: "coder", adapter: claudeCode, tools: [named] });
  const ask = coder.turn({ label: "ask", request: (prompt: string) => ({ prompt }) });
  const scope = createScope({
    presets: [preset(claudeCode.sdk, async () => fakeSdk(seen))],
  });
  await scope.createSession().run(ask, { input: "hello" });
  expect(seen.servers[0]?.tools.map((entry) => entry.name)).toEqual(["lookup"]);
  expect(seen.results[0]?.content).toEqual([{ type: "text", text: '"hit:x"' }]);
  await scope.close();
});

test("the frame server wins over a user server bound under the frame label", async () => {
  const seen: Seen = { servers: [], queries: [], results: [] };
  const coder = harness({ label: "coder", adapter: claudeCode, tools: [search] });
  const ask = coder.turn({ label: "ask", request: (prompt: string) => ({ prompt }) });
  const scope = createScope({
    tags: [claudeCode.options({ mcpServers: { coder: { command: "mine" } } })],
    presets: [preset(claudeCode.sdk, async () => fakeSdk(seen))],
  });
  await scope.createSession().run(ask, { input: "hello" });
  expect(seen.queries[0]?.mcpServers?.coder).toEqual({ type: "stdio", command: "fake" });
  expect(seen.servers[0]?.name).toBe("coder");
  await scope.close();
});

test("two tools register under their own names", async () => {
  const seen: Seen = { servers: [], queries: [], results: [] };
  const lookup = operation({
    label: "lookup",
    input: parseSearch,
    meta: [tool({ description: "find things", schema: searchShape })],
    run: (_deps, ctx) => `hit:${(ctx.input as { q: string }).q}`,
  });
  const coder = harness({ label: "coder", adapter: claudeCode, tools: [search, lookup] });
  const ask = coder.turn({ label: "ask", request: (prompt: string) => ({ prompt }) });
  const scope = createScope({
    presets: [preset(claudeCode.sdk, async () => fakeSdk(seen))],
  });
  await scope.createSession().run(ask, { input: "hello" });
  expect(seen.servers[0]?.tools.map((entry) => entry.name).sort()).toEqual(["lookup", "search"]);
  await scope.close();
});
