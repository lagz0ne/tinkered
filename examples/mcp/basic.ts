import { createScope, extension, resource } from "@tinker/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { searchMcp } from "./search.ts";
import { checkClosed } from "./errors.ts";

export const memory = resource({
  label: "memory.transports",
  target: "scope",
  factory: (_deps, ctx) => {
    const [client, server] = InMemoryTransport.createLinkedPair();
    ctx.defer(() => client.close());
    ctx.defer(() => server.close());
    return { client, server };
  },
});

export const connected = extension({
  label: "memory.server",
  hooks: {
    start: async (event) => {
      await event.next();
      const server = event.resolve(searchMcp);
      event.defer(() => server.close());
      await server.connect(event.resolve(memory).server);
    },
  },
});

if (import.meta.main) {
  const stop = new AbortController();
  const root = createScope({ signal: stop.signal, extensions: [connected, searchMcp] });
  const client = new Client({ name: "example", version: "1.0.0" });
  let completed = false;
  let output: string;
  const onStop = () => stop.abort();
  process.once("SIGINT", onStop);
  process.once("SIGTERM", onStop);
  try {
    await root.ready;
    await client.connect(root.resolve(memory).client);
    const listed = await client.listTools();
    const answered = await client.request(
      { method: "tools/call", params: { name: "search", arguments: { q: "owls" } } },
      CallToolResultSchema,
    );
    const text = answered.content.find((part) => part.type === "text")?.text ?? "";
    output = `${listed.tools.map((entry) => entry.name).join(",")}=${text}`;
    completed = true;
  } finally {
    const [clientResult] = await Promise.allSettled([client.close()]);
    stop.abort();
    const result = await root.closed;
    process.off("SIGINT", onStop);
    process.off("SIGTERM", onStop);
    if (completed) checkClosed(clientResult, result);
  }
  process.stdout.write(`${output}\n`);
}
