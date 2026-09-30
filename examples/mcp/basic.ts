import { createScope, extension, resource } from "@tinker/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { searchMcp } from "./search.ts";
import { checkClosed } from "./errors.ts";

const memory = resource({
  label: "memory.transports",
  target: "scope",
  factory: (_deps, ctx) => {
    const [client, server] = InMemoryTransport.createLinkedPair();
    ctx.defer(() => client.close());
    ctx.defer(() => server.close());
    return { client, server };
  },
});

const connected = extension({
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

/** The SDK schema reads the tool reply at the edge; imports start no client or server. */
export async function tour(): Promise<string> {
  const stop = new AbortController();
  const root = createScope({ signal: stop.signal, extensions: [connected, searchMcp] });
  const client = new Client({ name: "tour", version: "1.0.0" });
  let completed = false;
  try {
    await root.ready;
    await client.connect(root.resolve(memory).client);
    const listed = await client.listTools();
    const answered = await client.request(
      { method: "tools/call", params: { name: "search", arguments: { q: "owls" } } },
      CallToolResultSchema,
    );
    const text = answered.content.find((part) => part.type === "text")?.text ?? "";
    const result = `${listed.tools.map((entry) => entry.name).join(",")}=${text}`;
    completed = true;
    return result;
  } finally {
    const [clientResult] = await Promise.allSettled([client.close()]);
    stop.abort();
    const result = await root.closed;
    if (completed) checkClosed(clientResult, result);
  }
}

if (import.meta.main) process.stdout.write(`${await tour()}\n`);
