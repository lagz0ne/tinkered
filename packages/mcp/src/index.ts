import type { Many, Operation, Scope, Tag } from "@tinker/core";
import { extension, isError as isCoreError, readMany, tag } from "@tinker/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ZodTypeAny } from "zod";
import { isError, raise } from "./errors.ts";

export { isError };
export type { Errors } from "./errors.ts";

/** A tool is an operation plus its description facts: the wiring row names the
 * operation and carries the facts, the driver registers one MCP tool per row
 * (ADR 0051). The `tool` meta tag stays exported — harnesses read it off bound
 * ops until their own ticket. */
export declare namespace Mcp {
  /** One zod schema per input field: the language the SDK turns into JSON
   * Schema. A plain record of zod types — no `Any`-prefixed alias in src. */
  export type ZodShape = { readonly [key: string]: ZodTypeAny };
  /** The static facts a row carries to advertise its operation as a tool. `name`
   * defaults to the operation's label; `respond` maps the value to a result. */
  export type Tool = {
    readonly description: string;
    readonly schema: ZodShape;
    readonly name?: string;
    readonly respond?: (value: unknown) => CallToolResult;
  };
  /** One wiring row: the operation plus its tool facts. Built with `expose`. */
  export type Row = {
    readonly op: Operation.Handle<unknown, unknown>;
    readonly meta: Tool;
  };
  /** What the MCP driver serves: its name and version plus the flat tool rows. */
  export type Wiring = {
    readonly name: string;
    readonly version: string;
    readonly tools: Many<Row>;
  };
}

/** The meta tag an operation carries to declare itself a tool:
 * `meta: [tool({ description, schema })]`. Harnesses read it until their own
 * ticket; the MCP driver reads the `expose` rows below, not this tag. */
export const tool: Tag.Handle<Mcp.Tool> = tag({ label: "mcp.tool" });

/** Name one tool row: the operation plus its description facts. Hand the rows
 * to `mcp({ tools })` — plain data, not a scope tag. */
export function expose(op: Operation.Handle<unknown, unknown>, meta: Mcp.Tool): Mcp.Row {
  return { op, meta };
}

function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

function failureResult(text: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text }] };
}

/** Map a tool row's value to a tool result, exactly as the driver answers a call:
 * `respond` wins, the default is one JSON text content, `undefined` answers
 * with no content. Harnesses share it for the in-process path (ADR 0046). */
export function answerTool(meta: Mcp.Tool, value: unknown): CallToolResult {
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
                return answerTool(meta, value);
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

/** Read the tool facts off one tool op: the `tool` meta's facts, read by the
 * harness adapters until their own ticket (ADR 0046). An op without meta cannot
 * be advertised, so this throws `ToolUndeclared` with the op's label. */
export function readTool(op: Operation.Handle<unknown, unknown>): Mcp.Tool {
  const found = tool.read(op);
  if (!found.present) raise("ToolUndeclared", { label: op.label });
  return found.value;
}

/** The MCP driver, an extension (ADR 0051): `start` resolves its hand once
 * (`await next()`, so a second extension's `start` work is visible), then builds
 * the one `McpServer` — one tool per wiring row, each call answered through the
 * row's operation. The value is the server. This `start` is the extension's ONE
 * use of the scope: per call it opens a session from the captured root handle.
 * Connecting a transport is the root's job. */
export function mcp(wiring: Mcp.Wiring): Scope.Extension<McpServer> {
  return extension<McpServer>({
    label: "mcp",
    start: async (scope, _ctx, next) => {
      await next();
      const server = new McpServer({ name: wiring.name, version: wiring.version });
      for (const row of readMany(wiring.tools)) {
        const name = row.meta.name ?? row.op.label;
        server.registerTool(
          name,
          { description: row.meta.description, inputSchema: row.meta.schema },
          readCall(scope, name, row.op, row.meta),
        );
      }
      return server;
    },
  });
}
