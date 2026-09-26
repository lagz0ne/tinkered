import { expect, test } from "vite-plus/test";
import {
  createScope,
  extension,
  isError as isCoreError,
  operation,
  tag,
  type Observe,
  type Scope,
} from "@tinker/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { answerTool, expose, mcp } from "../src/index.ts";

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
  run: (_deps, ctx) => `hit:${ctx.input.q}`,
});

const migrateShape = { target: z.string() };
const migrateSchema = z.object(migrateShape);
const parseMigrate = parseWith(migrateSchema);

const pingShape = { note: z.string() };
const pingSchema = z.object(pingShape);
const parsePing = parseWith(pingSchema);

/** One linked pair: a client wired straight to the extension's server, no stdio.
 * `ready` settles the extension's `start`, so the resolve hands back the server. */
async function linkClient(
  scope: ReturnType<typeof createScope>,
  ext: Scope.Extension<McpServer>,
): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await scope.ready;
  const server = scope.resolve(ext);
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

test("listTools lists every row with its description and schema keys", async () => {
  const migrate = operation({
    label: "migrate",
    input: parseMigrate,
    run: (_deps, ctx) => `migrated:${ctx.input.target}`,
  });
  const ext = mcp({
    name: "coder",
    version: "1.0.0",
    tools: [
      expose(search, { description: "search the index", schema: searchShape }),
      expose(migrate, { description: "run migrations", schema: migrateShape }),
    ],
  });
  const scope = createScope({ extensions: [ext] });
  const client = await linkClient(scope, ext);
  const listed = await client.listTools();
  expect(listed.tools.length).toBe(2);
  const names = listed.tools.map((entry) => entry.name).sort();
  expect(names).toEqual(["migrate", "search"]);
  const found = listed.tools.find((entry) => entry.name === "search");
  expect(found?.description).toBe("search the index");
  expect(schemaKeys(found)).toEqual(["q"]);
  await scope.close({ graceful: true });
});

test("tools take nested lists and false: every reachable row is registered", async () => {
  const flags = { migrations: false };
  const migrate = operation({
    label: "migrate",
    input: parseMigrate,
    run: (_deps, ctx) => `migrated:${ctx.input.target}`,
  });
  const ext = mcp({
    name: "coder",
    version: "1.0.0",
    tools: [
      [null, [expose(search, { description: "search the index", schema: searchShape })]],
      flags.migrations && expose(migrate, { description: "run migrations", schema: migrateShape }),
    ],
  });
  const scope = createScope({ extensions: [ext] });
  const client = await linkClient(scope, ext);
  const listed = await client.listTools();
  expect(listed.tools.map((entry) => entry.name)).toEqual(["search"]);
  await scope.close({ graceful: true });
});

test("callTool runs the op under an mcp span and answers one JSON text with one mcp tool line", async () => {
  const logs: Observe.Log[] = [];
  const exported: string[] = [];
  const ext = mcp({
    name: "coder",
    version: "1.0.0",
    tools: [expose(search, { description: "search the index", schema: searchShape })],
  });
  const scope = createScope({
    extensions: [ext],
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
  const client = await linkClient(scope, ext);
  const answered = await client.callTool({ name: "search", arguments: { q: " owls " } });
  expect(answered.isError).not.toBe(true);
  expect(answered.content).toEqual([{ type: "text", text: '"hit: owls "' }]);
  const tools = logs.filter((entry) => entry.message === "mcp tool");
  expect(tools.length).toBe(1);
  expect(tools[0].attributes).toEqual({ tool: "search", ok: true });
  expect(tools[0].span?.name).toBe("mcp search");
  expect(exported).toContain("operation:mcp search:root");
  const child = scope.spans().find((span) => span.name === "search");
  const head = scope.spans().find((span) => span.name === "mcp search");
  expect(child?.parentId).toBe(head?.id);
  await scope.close({ graceful: true });
});

test("a respond in the row replaces the default JSON text", async () => {
  const shaped = operation({
    label: "shaped",
    input: parseSearch,
    run: (_deps, ctx) => ctx.input.q,
  });
  const ext = mcp({
    name: "coder",
    version: "1.0.0",
    tools: [
      expose(shaped, {
        description: "a shaped answer",
        schema: searchShape,
        respond: (value) => ({ content: [{ type: "text", text: `got ${String(value)}` }] }),
      }),
    ],
  });
  const scope = createScope({ extensions: [ext] });
  const client = await linkClient(scope, ext);
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
    run: (_deps, ctx) => ctx.input,
  });
  const ext = mcp({
    name: "coder",
    version: "1.0.0",
    tools: [expose(strict, { description: "needs a long word", schema: strictShape })],
  });
  const scope = createScope({
    extensions: [ext],
    observe: {
      history: 20,
      log: (entry) => {
        logs.push(entry);
      },
    },
  });
  const client = await linkClient(scope, ext);
  const answered = await client.callTool({ name: "strict", arguments: { word: "no" } });
  expect(answered.isError).toBe(true);
  expect(answered.content).toEqual([{ type: "text", text: "invalid input" }]);
  const tools = logs.filter((entry) => entry.message === "mcp tool");
  expect(tools.length).toBe(1);
  expect(tools[0].attributes).toEqual({ tool: "strict", ok: false });
  const head = scope.spans().find((span) => span.name === "mcp strict");
  expect(head?.status).toBe("failed");
  await scope.close({ graceful: true });
});

test("a throwing op answers isError with the thrown text", async () => {
  const broken = operation({
    label: "broken",
    input: parseSearch,
    run: () => {
      throw new Error("boom");
    },
  });
  const ext = mcp({
    name: "coder",
    version: "1.0.0",
    tools: [expose(broken, { description: "always fails", schema: searchShape })],
  });
  const scope = createScope({ extensions: [ext] });
  const client = await linkClient(scope, ext);
  const answered = await client.callTool({ name: "broken", arguments: { q: "owls" } });
  expect(answered.isError).toBe(true);
  expect(answered.content).toEqual([{ type: "text", text: "Error: boom" }]);
  await scope.close({ graceful: true });
});

test("a failed call recovers through settle: a panic and a raised error answer isError and the session closes success", async () => {
  const closed: string[] = [];
  const sessions = extension({
    label: "sessions",
    session: async (_handle, next) => {
      const ended = await next();
      closed.push(ended.status);
      return ended;
    },
  });
  const panics = operation({
    label: "panics",
    input: parseSearch,
    run: () => {
      throw new Error("boom");
    },
  });
  const refuses = operation({
    label: "refuses",
    input: parseSearch,
    run: (_deps, ctx) => ctx.raise("Refused", { q: ctx.input.q }),
  });
  const ext = mcp({
    name: "coder",
    version: "1.0.0",
    tools: [
      expose(panics, { description: "panics", schema: searchShape }),
      expose(refuses, { description: "raises an error", schema: searchShape }),
    ],
  });
  const scope = createScope({ extensions: [sessions, ext] });
  const client = await linkClient(scope, ext);
  const panicked = await client.callTool({ name: "panics", arguments: { q: "owls" } });
  expect(panicked.isError).toBe(true);
  expect(panicked.content).toEqual([{ type: "text", text: "Error: boom" }]);
  const refused = await client.callTool({ name: "refuses", arguments: { q: "owls" } });
  expect(refused.isError).toBe(true);
  expect(refused.content).toEqual([{ type: "text", text: "Error: Refused" }]);
  expect(closed).toEqual(["success", "success"]);
  await scope.close({ graceful: true });
});

test("a throwing respond answers isError with one ok:true line, a failed span, and a success session", async () => {
  const logs: Observe.Log[] = [];
  const closed: string[] = [];
  const sessions = extension({
    label: "sessions",
    session: async (_handle, next) => {
      const ended = await next();
      closed.push(ended.status);
      return ended;
    },
  });
  const ext = mcp({
    name: "coder",
    version: "1.0.0",
    tools: [
      expose(search, {
        description: "a broken answer",
        schema: searchShape,
        respond: () => {
          throw new Error("respond broke");
        },
      }),
    ],
  });
  const scope = createScope({
    extensions: [sessions, ext],
    observe: {
      history: 20,
      log: (entry) => {
        logs.push(entry);
      },
    },
  });
  const client = await linkClient(scope, ext);
  const answered = await client.callTool({ name: "search", arguments: { q: "owls" } });
  expect(answered.isError).toBe(true);
  expect(answered.content).toEqual([{ type: "text", text: "Error: respond broke" }]);
  const tools = logs.filter((entry) => entry.message === "mcp tool");
  expect(tools.length).toBe(1);
  expect(tools[0].attributes).toEqual({ tool: "search", ok: true });
  const head = scope.spans().find((span) => span.name === "mcp search");
  expect(head?.status).toBe("failed");
  expect(closed).toEqual(["success"]);
  await scope.close({ graceful: true });
});

test("answerTool answers undefined with no content and a value with one JSON text", () => {
  const meta = { description: "search the index", schema: searchShape };
  expect(answerTool(meta, undefined)).toEqual({ content: [] });
  expect(answerTool(meta, ["hit"])).toEqual({ content: [{ type: "text", text: '["hit"]' }] });
});

test("a call cut short by a forced close answers isError and fails its span with the cancel reason", async () => {
  let markStarted = (): void => undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const seen: unknown[] = [];
  const waits = operation({
    label: "waits",
    input: parseSearch,
    run: (_deps, { signal }) =>
      new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          seen.push(signal.reason);
          reject(signal.reason);
        });
        markStarted();
      }),
  });
  const ext = mcp({
    name: "coder",
    version: "1.0.0",
    tools: [expose(waits, { description: "waits for close", schema: searchShape })],
  });
  const scope = createScope({ observe: { history: 20 }, extensions: [ext] });
  const client = await linkClient(scope, ext);
  const call = client.callTool({ name: "waits", arguments: { q: "owls" } });
  await started;
  const closing = scope.close();
  const answered = await call;
  expect(seen.length).toBe(1);
  expect(answered.isError).toBe(true);
  expect(answered.content).toEqual([{ type: "text", text: String(seen[0]) }]);
  await closing;
  const head = scope.spans().find((span) => span.name === "mcp waits");
  expect(head?.status).toBe("failed");
  expect(head?.error).toBe(seen[0]);
});

test("an extension run hook sees the call's arguments as the mcp op's input", async () => {
  const inputs: unknown[] = [];
  const watch = extension({
    label: "watch",
    run: (op, call, next) => {
      if (op.label === "mcp search") inputs.push(call?.input);
      return next();
    },
  });
  const ext = mcp({
    name: "coder",
    version: "1.0.0",
    tools: [expose(search, { description: "search the index", schema: searchShape })],
  });
  const scope = createScope({ extensions: [watch, ext] });
  const client = await linkClient(scope, ext);
  await client.callTool({ name: "search", arguments: { q: "owls" } });
  expect(inputs).toEqual([{ q: "owls" }]);
  await scope.close({ graceful: true });
});

test("the op's deps see a tag bound on the scope", async () => {
  const index = tag<string>({ label: "index" });
  const lookup = operation({
    label: "lookup",
    input: parseSearch,
    depends: { index },
    run: ({ index: name }, ctx) => `${name}:${ctx.input.q}`,
  });
  const ext = mcp({
    name: "coder",
    version: "1.0.0",
    tools: [expose(lookup, { description: "read the bound index", schema: searchShape })],
  });
  const scope = createScope({ tags: [index("main")], extensions: [ext] });
  const client = await linkClient(scope, ext);
  const answered = await client.callTool({ name: "lookup", arguments: { q: "owls" } });
  expect(answered.isError).not.toBe(true);
  expect(answered.content).toEqual([{ type: "text", text: '"main:owls"' }]);
  await scope.close({ graceful: true });
});

test("a renamed row answers under its own name with one session per call", async () => {
  const ping = operation({
    label: "ping",
    input: parsePing,
    run: () => "pong",
  });
  const ext = mcp({
    name: "coder",
    version: "1.0.0",
    tools: [expose(ping, { description: "answer pong", schema: pingShape, name: "pong" })],
  });
  const scope = createScope({ observe: { history: 20 }, extensions: [ext] });
  const client = await linkClient(scope, ext);
  const listed = await client.listTools();
  expect(listed.tools.map((entry) => entry.name)).toEqual(["pong"]);
  const first = await client.callTool({ name: "pong", arguments: { note: "a" } });
  expect(first.isError).not.toBe(true);
  expect(first.content).toEqual([{ type: "text", text: '"pong"' }]);
  const second = await client.callTool({ name: "pong", arguments: { note: "b" } });
  expect(second.isError).not.toBe(true);
  const calls = scope.spans().filter((span) => span.name === "mcp pong");
  expect(calls.length).toBe(2);
  expect(calls[0]?.id).not.toBe(calls[1]?.id);
  await scope.close({ graceful: true });
});

test("resolving the server before ready fails with NotResolved", async () => {
  const ext = mcp({
    name: "coder",
    version: "1.0.0",
    tools: [expose(search, { description: "search the index", schema: searchShape })],
  });
  const scope = createScope({ extensions: [ext] });
  try {
    scope.resolve(ext);
    expect.unreachable();
  } catch (error: unknown) {
    if (!isCoreError(error, "NotResolved")) throw error;
    expect(error.payload.label).toBe("mcp:coder");
  }
  await scope.close({ graceful: true });
});
