import type { Operation, Scope, Tag } from "@tinker/core";
import { isError as isCoreError, tag } from "@tinker/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ZodTypeAny } from "zod";
import { isError, raise } from "./errors.ts";

export { isError };
export type { Errors } from "./errors.ts";

/** A tool is an operation with description meta: the handler is the operation's
 * `run`, the input its `parse`, the static facts ride on the handle's `meta`,
 * and the list is scope config read by the driver (ADR 0046). */
export declare namespace Mcp {
  /** One zod schema per input field: the language the SDK turns into JSON
   * Schema. A plain record of zod types — no `Any`-prefixed alias in src. */
  export type ZodShape = { readonly [key: string]: ZodTypeAny };
  /** The static facts an operation carries to declare itself a tool. `name`
   * defaults to the operation's label; `respond` maps the value to a result. */
  export type Tool = {
    readonly description: string;
    readonly schema: ZodShape;
    readonly name?: string;
    readonly respond?: (value: unknown) => CallToolResult;
  };
  /** What the MCP server is called and which version it answers. */
  export type Options = { readonly name: string; readonly version: string };
}

/** The meta tag an operation carries to declare itself a tool:
 * `meta: [tool({ description, schema })]`. Read with `tool.read(op)`. */
export const tool: Tag.Handle<Mcp.Tool> = tag({ label: "mcp.tool" });

/** The binding tag: `tools(op)` on a scope or session; the driver reads
 * `scope.resolve(tools.all)`. */
export const tools: Tag.Handle<Operation.Handle<unknown, unknown>> = tag({ label: "mcp.tools" });

function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

function failureResult(text: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text }] };
}

/** Map the settled value to a tool result: `respond` wins, the default is one
 * JSON text content, `undefined` answers with no content. */
function answerResult(meta: Mcp.Tool, value: unknown): CallToolResult {
  if (meta.respond !== undefined) return meta.respond(value);
  if (value === undefined) return { content: [] };
  return textResult(JSON.stringify(value));
}

/** Run one tool call: a session with an inline op `mcp <name>`, the tool op as
 * its subflow (a bare operation in `depends` delivers a controller; `rawInput`
 * runs the op's own parse). One `mcp tool` log line on both paths; a throw logs
 * then rethrows so the session settles failed, and the outer catch maps the
 * outcome to a tool result. */
function readCall(
  scope: Scope.Handle,
  name: string,
  op: Operation.Handle<unknown, unknown>,
  meta: Mcp.Tool,
): (args: Record<string, unknown>) => Promise<CallToolResult> {
  return (args) =>
    scope
      .session((s) =>
        s.run(
          {
            label: `mcp ${name}`,
            depends: { op },
            run: async ({ op: flow }, ctx) => {
              const started = ctx.clock.currentTimeMillis();
              try {
                const value = await flow.run({ rawInput: args });
                ctx.log("mcp tool", {
                  tool: name,
                  ok: true,
                  ms: ctx.clock.currentTimeMillis() - started,
                });
                return answerResult(meta, value);
              } catch (error: unknown) {
                ctx.log("mcp tool", {
                  tool: name,
                  ok: false,
                  ms: ctx.clock.currentTimeMillis() - started,
                });
                throw error;
              }
            },
          },
          { input: args },
        ),
      )
      .catch((error: unknown) => {
        if (isCoreError(error, "DataValidationFailed")) return failureResult("invalid input");
        return failureResult(String(error));
      });
}

/** Read the tool facts off one bound operation: a bound op without meta cannot
 * be advertised, so the driver throws. */
function readTool(op: Operation.Handle<unknown, unknown>): Mcp.Tool {
  const found = tool.read(op);
  if (!found.present) raise("ToolUndeclared", { label: op.label });
  return found.value;
}

/** The driver: publish every tool bound on the scope as an MCP tool. Returns
 * the SDK's own `McpServer` — the caller connects the transport it wants. */
export function mcpServer(scope: Scope.Handle, options: Mcp.Options): McpServer {
  const server = new McpServer({ name: options.name, version: options.version });
  const bound = scope.resolve(tools.all);
  for (const op of bound) {
    const meta = readTool(op);
    const name = meta.name ?? op.label;
    server.registerTool(
      name,
      { description: meta.description, inputSchema: meta.schema },
      readCall(scope, name, op, meta),
    );
  }
  return server;
}
