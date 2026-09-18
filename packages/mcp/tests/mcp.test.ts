import { expect, test } from "vite-plus/test";
import { createScope, operation, tag, type Observe } from "@tinker/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { isError, mcpServer, tool, tools } from "../src/index.ts";

/** The op edge and the declaration share one source: parse through the object
 * built from the raw shape. A named function, not a method pull. */
function parseWith<T>(schema: { parse: (raw: unknown) => T }): (raw: unknown) => T {
  function parse(raw: unknown): T {
    return schema.parse(raw);
  }
  return parse;
}

const searchShape = { q: z.string() };
const searchSchema = z.object(searchShape);
const parseSearch = parseWith(searchSchema);

const search = operation({
  label: "search",
  input: parseSearch,
  meta: [tool({ description: "search the index", schema: searchShape })],
  run: (_deps, ctx) => `hit:${ctx.input.q}`,
});

const migrateShape = { target: z.string() };
const migrateSchema = z.object(migrateShape);
const parseMigrate = parseWith(migrateSchema);

const pingShape = { note: z.string() };
const pingSchema = z.object(pingShape);
const parsePing = parseWith(pingSchema);

/** One linked pair: a client wired straight to our server, no stdio. */
async function linkClient(scope: ReturnType<typeof createScope>): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = mcpServer(scope, { name: "coder", version: "1.0.0" });
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientTransport);
  return client;
}

/** Read the tool's JSON schema keys off one listed tool: the SDK converts the
 * zod shape, so `properties` carries the declared fields. */
function schemaKeys(entry: { inputSchema: unknown } | undefined): string[] {
  if (entry === undefined) return [];
  const schema = entry.inputSchema;
  if (typeof schema !== "object" || schema === null) return [];
  if (!("properties" in schema)) return [];
  const properties = schema.properties;
  if (typeof properties !== "object" || properties === null) return [];
  return Object.keys(properties);
}

test("listTools lists every bound op with its description and schema keys", async () => {
  const migrate = operation({
    label: "migrate",
    input: parseMigrate,
    meta: [tool({ description: "run migrations", schema: migrateShape })],
    run: (_deps, ctx) => `migrated:${ctx.input.target}`,
  });
  const scope = createScope({ tags: [tools(search), tools(migrate)] });
  const client = await linkClient(scope);
  const listed = await client.listTools();
  expect(listed.tools.length).toBe(2);
  const names = listed.tools.map((entry) => entry.name).sort();
  expect(names).toEqual(["migrate", "search"]);
  const found = listed.tools.find((entry) => entry.name === "search");
  expect(found?.description).toBe("search the index");
  expect(schemaKeys(found)).toEqual(["q"]);
  await scope.close({ graceful: true });
});

test("callTool runs the op under an mcp span and answers one JSON text with one log line", async () => {
  const logs: Observe.Log[] = [];
  const exported: string[] = [];
  const scope = createScope({
    tags: [tools(search)],
    observe: {
      history: 20,
      export: (span) => {
        exported.push(`${span.kind}:${span.name}:${span.parentId ?? "root"}`);
      },
      log: (entry) => {
        logs.push(entry);
      },
    },
  });
  const client = await linkClient(scope);
  const answered = await client.callTool({ name: "search", arguments: { q: " owls " } });
  expect(answered.isError).not.toBe(true);
  expect(answered.content).toEqual([{ type: "text", text: '"hit: owls "' }]);
  expect(logs.length).toBe(1);
  expect(logs[0].message).toBe("mcp tool");
  expect(logs[0].attributes.tool).toBe("search");
  expect(logs[0].attributes.ok).toBe(true);
  expect(typeof logs[0].attributes.ms).toBe("number");
  expect(logs[0].span?.name).toBe("mcp search");
  expect(exported).toContain("operation:mcp search:root");
  const child = scope.spans().find((span) => span.name === "search");
  const head = scope.spans().find((span) => span.name === "mcp search");
  expect(child?.parentId).toBe(head?.id);
  await scope.close({ graceful: true });
});

test("a respond in the meta replaces the default JSON text", async () => {
  const shaped = operation({
    label: "shaped",
    input: parseSearch,
    meta: [
      tool({
        description: "a shaped answer",
        schema: searchShape,
        respond: (value) => ({ content: [{ type: "text", text: `got ${String(value)}` }] }),
      }),
    ],
    run: (_deps, ctx) => ctx.input.q,
  });
  const scope = createScope({ tags: [tools(shaped)] });
  const client = await linkClient(scope);
  const answered = await client.callTool({ name: "shaped", arguments: { q: "owls" } });
  expect(answered.isError).not.toBe(true);
  expect(answered.content).toEqual([{ type: "text", text: "got owls" }]);
  await scope.close({ graceful: true });
});

test("a parse failure the schema admits answers isError with one ok:false line", async () => {
  const logs: Observe.Log[] = [];
  const strictShape = { word: z.string() };
  const strictSchema = z.object({ word: z.string().min(3) });
  const strict = operation({
    label: "strict",
    input: (raw: unknown) => strictSchema.parse(raw).word,
    meta: [tool({ description: "needs a long word", schema: strictShape })],
    run: (_deps, ctx) => ctx.input,
  });
  const scope = createScope({
    tags: [tools(strict)],
    observe: {
      history: 20,
      log: (entry) => {
        logs.push(entry);
      },
    },
  });
  const client = await linkClient(scope);
  const answered = await client.callTool({ name: "strict", arguments: { word: "no" } });
  expect(answered.isError).toBe(true);
  expect(answered.content).toEqual([{ type: "text", text: "invalid input" }]);
  expect(logs.length).toBe(1);
  expect(logs[0].message).toBe("mcp tool");
  expect(logs[0].attributes.ok).toBe(false);
  const head = scope.spans().find((span) => span.name === "mcp strict");
  expect(head?.status).toBe("failed");
  await scope.close({ graceful: true });
});

test("a throwing op answers isError with the thrown text", async () => {
  const broken = operation({
    label: "broken",
    input: parseSearch,
    meta: [tool({ description: "always fails", schema: searchShape })],
    run: () => {
      throw new Error("boom");
    },
  });
  const scope = createScope({ tags: [tools(broken)] });
  const client = await linkClient(scope);
  const answered = await client.callTool({ name: "broken", arguments: { q: "owls" } });
  expect(answered.isError).toBe(true);
  expect(answered.content).toEqual([{ type: "text", text: "Error: boom" }]);
  await scope.close({ graceful: true });
});

test("a tool bound on a session is listed there and not by the scope server", async () => {
  const ping = operation({
    label: "ping",
    input: parsePing,
    meta: [tool({ description: "answer pong", schema: pingShape })],
    run: () => "pong",
  });
  const scope = createScope({ tags: [tools(ping)] });
  const session = scope.createSession({ tags: [tools(search)] });
  const sessionClient = await linkClient(session);
  const sessionListed = await sessionClient.listTools();
  expect(sessionListed.tools.map((entry) => entry.name)).toContain("search");
  const scopeClient = await linkClient(scope);
  const scopeListed = await scopeClient.listTools();
  expect(scopeListed.tools.map((entry) => entry.name)).toEqual(["ping"]);
  await scope.close({ graceful: true });
});

test("the op's deps see a tag bound on the scope", async () => {
  const index = tag<string>({ label: "index" });
  const lookup = operation({
    label: "lookup",
    input: parseSearch,
    depends: { index },
    meta: [tool({ description: "read the bound index", schema: searchShape })],
    run: ({ index: name }, ctx) => `${name}:${ctx.input.q}`,
  });
  const scope = createScope({ tags: [tools(lookup), index("main")] });
  const client = await linkClient(scope);
  const answered = await client.callTool({ name: "lookup", arguments: { q: "owls" } });
  expect(answered.isError).not.toBe(true);
  expect(answered.content).toEqual([{ type: "text", text: '"main:owls"' }]);
  await scope.close({ graceful: true });
});

test("a bound op without tool meta throws ToolUndeclared with its label", async () => {
  const bare = operation({ label: "bare", run: () => "hi" });
  const scope = createScope({ tags: [tools(bare)] });
  try {
    mcpServer(scope, { name: "coder", version: "1.0.0" });
    expect.unreachable();
  } catch (error: unknown) {
    if (!isError(error, "ToolUndeclared")) throw error;
    expect(error.payload.label).toBe("bare");
  }
  await scope.close({ graceful: true });
});
