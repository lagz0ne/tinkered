import { fileURLToPath } from "node:url";
import { PassThrough } from "node:stream";
import { expect, test } from "vite-plus/test";
import { createScope } from "@tinker/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { runServer, memory, connected, searchMcp } from "./index.ts";

test("the memory example lists and calls search", async () => {
  const stop = new AbortController();
  const root = createScope({ signal: stop.signal, extensions: [connected, searchMcp] });
  const client = new Client({ name: "example-test", version: "1.0.0" });
  try {
    await root.ready;
    await client.connect(root.resolve(memory).client);
    const listed = await client.listTools();
    expect(listed.tools.map((entry) => entry.name)).toEqual(["search"]);
    const answered = await client.request(
      { method: "tools/call", params: { name: "search", arguments: { q: "owls" } } },
      CallToolResultSchema,
    );
    expect(answered.content).toEqual([{ type: "text", text: '["hit:owls"]' }]);
  } finally {
    try {
      await client.close();
    } finally {
      stop.abort();
      await root.closed;
    }
  }
});

test("both stdio entries answer the search tool", async () => {
  const replies = [];
  for (const entry of [
    { path: "./serve.ts", args: [] },
    { path: "./cli.ts", args: ["--", "mcp"] },
  ]) {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        "--experimental-strip-types",
        fileURLToPath(new URL(entry.path, import.meta.url)),
        ...entry.args,
      ],
      stderr: "pipe",
    });
    const client = new Client({ name: "example-test", version: "1.0.0" });
    try {
      await client.connect(transport);
      const result = await client.request(
        { method: "tools/call", params: { name: "search", arguments: { q: "owls" } } },
        CallToolResultSchema,
      );
      replies.push(result.content);
    } finally {
      try {
        await client.close();
      } finally {
        await transport.close();
      }
    }
  }
  expect(replies).toEqual([
    [{ type: "text", text: '["hit:owls"]' }],
    [{ type: "text", text: '["hit:owls"]' }],
  ]);
});

test("the standalone server stops when its input ends", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const stop = new AbortController();
  try {
    input.end();
    expect(await runServer({ input, output }, stop.signal)).toBe(0);
  } finally {
    stop.abort();
    input.destroy();
    output.destroy();
  }
});
