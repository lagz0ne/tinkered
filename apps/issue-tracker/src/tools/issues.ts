import { operation, type Scope } from "@tinker/core";
import { command, commands } from "@tinker/cli";
import { isError as isHttpError } from "@tinker/http";
import { mcpServer, tool, tools } from "@tinker/mcp";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDetail, getIssues, patchIssue, postComment, postIssue } from "../client/api.ts";
import { fail, type Errors } from "../errors.ts";
import {
  parseCommentInput,
  parseCreateInput,
  parseEditInput,
  parseIssue,
  parseIssueId,
} from "../shared/issues.ts";

const createShape = { title: z.string(), description: z.string() };

const updateShape = {
  id: z.string(),
  baseRevision: z.number(),
  title: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(["open", "in_progress", "done"]).optional(),
  assignee: z.string().nullable().optional(),
};

const commentShape = { issueId: z.string(), author: z.string(), text: z.string() };

const getShape = { id: z.string() };

function readRevision(raw: string | undefined): unknown {
  if (raw === undefined) return undefined;
  if (raw.trim().length === 0) return Number.NaN;
  const count = Number(raw);
  return Number.isInteger(count) ? count : Number.NaN;
}

function readFlag(argv: readonly string[], name: string): string | undefined {
  const found = argv.indexOf(`--${name}`);
  if (found === -1) return undefined;
  return argv.at(found + 1);
}

function readCreateArgs(argv: readonly string[]): unknown {
  return { title: readFlag(argv, "title"), description: readFlag(argv, "description") };
}

function readUpdateArgs(argv: readonly string[]): unknown {
  return {
    id: argv.at(0),
    baseRevision: readRevision(readFlag(argv, "base-revision")),
    title: readFlag(argv, "title"),
    description: readFlag(argv, "description"),
    status: readFlag(argv, "status"),
    assignee: readFlag(argv, "assignee"),
  };
}

function readCommentArgs(argv: readonly string[]): unknown {
  return {
    issueId: argv.at(0),
    author: readFlag(argv, "author"),
    text: readFlag(argv, "text"),
  };
}

function readGetArgs(argv: readonly string[]): unknown {
  return { id: argv.at(0) };
}

/** Read one issue id from the object both argv and MCP send: `{ id }`. */
function parseGetInput(raw: unknown): string {
  if (isRecord(raw)) return parseIssueId(raw.id);
  return parseIssueId(undefined);
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null;
}

function readConflicted(raw: unknown): Errors.Of<"IssueConflict"> | undefined {
  if (!isRecord(raw)) return undefined;
  if (typeof raw.id !== "string") return undefined;
  if (typeof raw.currentRevision !== "number") return undefined;
  try {
    const current = parseIssue(raw.current);
    const conflict = fail("IssueConflict", {
      id: raw.id,
      currentRevision: raw.currentRevision,
      current,
    });
    conflict.message = `IssueConflict: someone else saved first — current revision ${raw.currentRevision}`;
    return conflict;
  } catch {
    return undefined;
  }
}

async function readRemoteError(error: unknown, fallbackId: string): Promise<unknown> {
  if (!isHttpError(error, "ResponseFailed")) return error;
  const status = error.payload.response.status;
  if (status === 409) {
    const conflicted = readConflicted(await error.payload.response.json());
    if (conflicted !== undefined) return conflicted;
  }
  if (status === 404) {
    const missing = fail("IssueNotFound", { id: fallbackId });
    missing.message = `IssueNotFound: ${fallbackId} is gone`;
    return missing;
  }
  error.message = `ResponseFailed: ${error.payload.reason} (status ${status})`;
  return error;
}

/** List the saved issues through the running server. */
export const listRemote = operation({
  label: "list",
  meta: [
    command({ description: "list the saved issues" }),
    tool({ description: "list the saved issues", schema: {} }),
  ],
  depends: { issues: getIssues },
  run: async ({ issues }) => {
    try {
      return await issues.run();
    } catch (error: unknown) {
      throw await readRemoteError(error, "issues");
    }
  },
});

/** Create one issue through the running server. */
export const createRemote = operation({
  label: "create",
  input: parseCreateInput,
  meta: [
    command({
      description: "create one issue: create --title T --description D",
      argv: readCreateArgs,
    }),
    tool({ description: "create one issue", schema: createShape }),
  ],
  depends: { saved: postIssue },
  run: async ({ saved }, ctx) => {
    try {
      return await saved.run({ input: ctx.input });
    } catch (error: unknown) {
      throw await readRemoteError(error, "issues");
    }
  },
});

/** Save an edit through the running server, guarded by the opened revision. */
export const updateRemote = operation({
  label: "update",
  input: parseEditInput,
  meta: [
    command({
      description:
        "save an edit: update ID --base-revision N [--title T] [--status S] [--assignee A]",
      argv: readUpdateArgs,
    }),
    tool({ description: "save an edit guarded by the opened revision", schema: updateShape }),
  ],
  depends: { saved: patchIssue },
  run: async ({ saved }, ctx) => {
    try {
      return await saved.run({ input: ctx.input });
    } catch (error: unknown) {
      throw await readRemoteError(error, ctx.input.id);
    }
  },
});

/** Append a comment through the running server; no revision is needed. */
export const commentRemote = operation({
  label: "comment",
  input: parseCommentInput,
  meta: [
    command({
      description: "append a comment: comment ID --author A --text T",
      argv: readCommentArgs,
    }),
    tool({ description: "append a comment without an edit revision", schema: commentShape }),
  ],
  depends: { saved: postComment },
  run: async ({ saved }, ctx) => {
    try {
      return await saved.run({ input: ctx.input });
    } catch (error: unknown) {
      throw await readRemoteError(error, ctx.input.issueId);
    }
  },
});

/** Show one saved issue with its comments, activity, and revision. */
export const getRemote = operation({
  label: "get",
  input: parseGetInput,
  meta: [
    command({ description: "show one saved issue with its detail", argv: readGetArgs }),
    tool({ description: "show one saved issue with comments and activity", schema: getShape }),
  ],
  depends: { detail: getDetail },
  run: async ({ detail }, ctx) => {
    try {
      return await detail.run({ input: ctx.input });
    } catch (error: unknown) {
      throw await readRemoteError(error, ctx.input);
    }
  },
});

/** The CLI routing rows for the issue commands. Help lists them without a backend. */
export const issueCommands = [
  commands(listRemote),
  commands(createRemote),
  commands(updateRemote),
  commands(commentRemote),
  commands(getRemote),
];

/** The MCP tool bindings for the same issue actions. */
export const issueTools = [
  tools(listRemote),
  tools(createRemote),
  tools(updateRemote),
  tools(commentRemote),
  tools(getRemote),
];

/** Serve the issue tools over MCP stdio. Owns the serving lifetime exactly like
 * the MCP README entry: EOF or a transport close settles the entry, and a CLI
 * signal closes the scope to settle it; the transport closes in every case
 * while the CLI driver closes the scope it owns. */
export async function serveIssues(scope: Scope.Handle): Promise<void> {
  const server = mcpServer(scope, { name: "issues", version: "0.1.0" });
  let stop: () => void = () => undefined;
  const stopped = new Promise<void>((resolve) => {
    stop = () => resolve();
  });
  scope.onClose(stop);
  process.stdin.once("end", stop);
  server.server.onclose = stop;
  try {
    await server.connect(new StdioServerTransport());
    if (process.stdin.readableEnded) stop();
    await stopped;
  } finally {
    process.stdin.removeListener("end", stop);
    await server.close();
  }
}
