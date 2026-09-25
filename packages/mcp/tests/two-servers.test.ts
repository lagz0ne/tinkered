import { expect, test } from "vite-plus/test";
import { createScope, extension, operation, resource, type Scope } from "@tinker/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { expose, mcp } from "../src/index.ts";

/** One linked pair: a client wired straight to one extension's server, no stdio.
 * `ready` settles every extension's `start`, so the resolve hands back the server. */
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

/** The stdio recipe in memory (the README's root extension): resolve the
 * driver's server once `next()` settles it, connect a transport, and close the
 * server on scope close. `closes` records each server's own close. */
function serve(
  ext: Scope.Extension<McpServer>,
  name: string,
  closes: string[],
): Scope.Extension<unknown> {
  return extension({
    label: `${name}.serve`,
    start: async (scope, ctx, next) => {
      await next();
      const server = scope.resolve(ext);
      const [, transport] = InMemoryTransport.createLinkedPair();
      ctx.defer(() => {
        closes.push(name);
        return server.close();
      });
      await server.connect(transport);
    },
  });
}

const entryShape = { entry: z.string() };

test("two extensions on one scope share a scope resource: a write through one is the other's next read", async () => {
  const audit = resource({
    label: "audit",
    target: "scope",
    factory: (): { entries: string[] } => ({ entries: [] }),
  });
  const record = operation({
    label: "record",
    input: (raw: unknown) => z.object(entryShape).parse(raw),
    depends: { audit },
    run: ({ audit }, ctx) => {
      audit.entries.push(ctx.input.entry);
      return audit.entries.length;
    },
  });
  const readAudit = operation({
    label: "readAudit",
    depends: { audit },
    run: ({ audit }) => [...audit.entries],
  });
  const app = mcp({
    name: "app",
    version: "1.0.0",
    tools: [expose(record, { description: "record one audit entry", schema: entryShape })],
  });
  const admin = mcp({
    name: "admin",
    version: "1.0.0",
    tools: [expose(readAudit, { description: "read the audit log", schema: {} })],
  });
  const scope = createScope({ extensions: [app, admin] });
  const appClient = await linkClient(scope, app);
  const adminClient = await linkClient(scope, admin);
  const before = await adminClient.callTool({ name: "readAudit", arguments: {} });
  expect(before.content).toEqual([{ type: "text", text: "[]" }]);
  const wrote = await appClient.callTool({ name: "record", arguments: { entry: "app" } });
  expect(wrote.content).toEqual([{ type: "text", text: "1" }]);
  // One scope-target instance for both servers: the app's write is the
  // admin's next read, so neither server built its own copy.
  const after = await adminClient.callTool({ name: "readAudit", arguments: {} });
  expect(after.content).toEqual([{ type: "text", text: '["app"]' }]);
  await scope.close({ graceful: true });
});

test("every call opens its own session: per-call state never crosses between two servers", async () => {
  let builds = 0;
  const perCall = resource({
    label: "mcp.call",
    target: "session",
    factory: () => ({ id: ++builds }),
  });
  const who = operation({
    label: "who",
    depends: { perCall },
    run: ({ perCall }) => perCall.id,
  });
  const app = mcp({
    name: "app",
    version: "1.0.0",
    tools: [expose(who, { description: "say which call this is", schema: {} })],
  });
  const admin = mcp({
    name: "admin",
    version: "1.0.0",
    tools: [expose(who, { description: "say which call this is", schema: {} })],
  });
  const scope = createScope({ extensions: [app, admin] });
  const appClient = await linkClient(scope, app);
  const adminClient = await linkClient(scope, admin);
  // Each call builds its own session resource: a fresh build per call, and
  // never the other server's, whether the call comes back to the same
  // server or crosses to the other one.
  const first = await appClient.callTool({ name: "who", arguments: {} });
  expect(first.content).toEqual([{ type: "text", text: "1" }]);
  const second = await adminClient.callTool({ name: "who", arguments: {} });
  expect(second.content).toEqual([{ type: "text", text: "2" }]);
  const third = await appClient.callTool({ name: "who", arguments: {} });
  expect(third.content).toEqual([{ type: "text", text: "3" }]);
  await scope.close({ graceful: true });
});

test("one scope close closes both servers: each server's close runs once", async () => {
  const closes: string[] = [];
  const app = mcp({ name: "app", version: "1.0.0", tools: [] });
  const admin = mcp({ name: "admin", version: "1.0.0", tools: [] });
  // Each root extension sits before the server it serves, so its `next()`
  // settles that `start` and `scope.resolve(ext)` finds the server.
  const scope = createScope({
    extensions: [serve(app, "app", closes), app, serve(admin, "admin", closes), admin],
  });
  await scope.ready;
  await scope.close({ graceful: true });
  expect(closes.sort()).toEqual(["admin", "app"]);
  await scope.close({ graceful: true });
  // The first close reaped both; a second close runs neither server's close.
  expect(closes.sort()).toEqual(["admin", "app"]);
});

test("a tool name declared on both extensions answers from the server that got the request", async () => {
  const appPing = operation({ label: "appPing", run: () => "app" });
  const adminPing = operation({ label: "adminPing", run: () => "admin" });
  const app = mcp({
    name: "app",
    version: "1.0.0",
    tools: [expose(appPing, { description: "answer app", schema: {}, name: "ping" })],
  });
  const admin = mcp({
    name: "admin",
    version: "1.0.0",
    tools: [expose(adminPing, { description: "answer admin", schema: {}, name: "ping" })],
  });
  const scope = createScope({ extensions: [app, admin] });
  const appClient = await linkClient(scope, app);
  const adminClient = await linkClient(scope, admin);
  const appListed = await appClient.listTools();
  expect(appListed.tools.map((entry) => entry.name)).toEqual(["ping"]);
  const adminListed = await adminClient.listTools();
  expect(adminListed.tools.map((entry) => entry.name)).toEqual(["ping"]);
  const fromApp = await appClient.callTool({ name: "ping", arguments: {} });
  expect(fromApp.content).toEqual([{ type: "text", text: '"app"' }]);
  const fromAdmin = await adminClient.callTool({ name: "ping", arguments: {} });
  expect(fromAdmin.content).toEqual([{ type: "text", text: '"admin"' }]);
  await scope.close({ graceful: true });
});
