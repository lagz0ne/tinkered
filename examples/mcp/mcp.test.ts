import { fileURLToPath } from "node:url";
import { PassThrough } from "node:stream";
import { expect, test } from "vite-plus/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { runServer, tour } from "./index.ts";

test("the memory demo lists and calls search", async () => {
  expect(await tour()).toBe('search=["hit:owls"]');
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
