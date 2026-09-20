import { createScope, operation } from "@tinker/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { expose, mcp } from "@tinker/mcp";

const searchShape = { q: z.string() };
const searchSchema = z.object(searchShape);

/** Parse through the object built from the raw shape: the op edge and the
 * declaration share one source. A named function, not a method pull. */
function parseSearch(raw: unknown): { q: string } {
  return searchSchema.parse(raw);
}

const search = operation({
  label: "search",
  input: parseSearch,
  run: (_deps, ctx) => [`hit:${ctx.input.q}`],
});

/** Read one text part off a tool result's content: the tour's one read of
 * the SDK's shape, narrowed by control flow. */
function readTextPart(part: unknown): string {
  if (typeof part !== "object" || part === null) return "";
  if (!("type" in part) || !("text" in part)) return "";
  if (part.type !== "text" || typeof part.text !== "string") return "";
  return part.text;
}

/** Read the first text answer off a tool result. */
function readFirstText(answered: object): string {
  if (!("content" in answered)) return "";
  const content: unknown = answered.content;
  if (!Array.isArray(content)) return "";
  return readTextPart(content[0]);
}

/** A cast-free tour of the driver: a tool is an operation plus its row facts,
 * `mcp({ tools })` is the extension, and a harness reaches it over MCP — here
 * through the SDK's in-memory pair against the resolved server. Answers the
 * listed names and the first call's text. */
export async function tour(): Promise<string> {
  const ext = mcp({
    name: "coder",
    version: "1.0.0",
    tools: [expose(search, { description: "search the index", schema: searchShape })],
  });
  const scope = createScope({ extensions: [ext] });
  await scope.ready;
  const server = scope.resolve(ext);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "tour", version: "0" });
  await client.connect(clientTransport);
  const listed = await client.listTools();
  const names = listed.tools.map((entry) => entry.name).join(",");
  const answered = await client.callTool({ name: "search", arguments: { q: "owls" } });
  const text = readFirstText(answered);
  await scope.close({ graceful: true });
  return `${names}=${text}`;
}
