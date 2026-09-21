import { operation } from "@tinker/core";
import type { Scope } from "@tinker/core";
import { command, type Process } from "@tinker/process";
import { isError as isHttpError } from "@tinker/http";
import { expose, mcp, tool, type Mcp } from "@tinker/mcp";
import { z } from "zod";
import { getDetail, getIssues, patchIssue, postComment, postIssue } from "../client/api.ts";
import { fail } from "../errors.ts";
import {
  parseCommentInput,
  parseCreateInput,
  parseEditInput,
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

function readRemoteError(error: unknown, fallbackId: string): unknown {
  if (!isHttpError(error, "ResponseFailed")) return error;
  const status = error.payload.response.status;
  if (status === 404) {
    const missing = fail("IssueNotFound", { id: fallbackId });
    missing.message = `IssueNotFound: ${fallbackId} is gone`;
    return missing;
  }
  error.message = `ResponseFailed: ${error.payload.reason} (status ${status})`;
  return error;
}

/** List the saved issues through the running server. The `tool` meta stays until
 * the harness ticket: the harness reads it off this op, while MCP reads the
 * `issueTools` rows and the CLI reads the `issueCommands` rows below. */
export const listRemote = operation({
  label: "list",
  meta: [tool({ description: "list the saved issues", schema: {} })],
  depends: { issues: getIssues },
  run: async ({ issues }) => {
    try {
      return await issues.run();
    } catch (error: unknown) {
      throw readRemoteError(error, "issues");
    }
  },
});

/** Create one issue through the running server. */
export const createRemote = operation({
  label: "create",
  input: parseCreateInput,
  depends: { saved: postIssue },
  run: async ({ saved }, ctx) => {
    try {
      return await saved.run({ input: ctx.input });
    } catch (error: unknown) {
      throw readRemoteError(error, "issues");
    }
  },
});

/** Save an edit through the running server, guarded by the opened revision. */
export const updateRemote = operation({
  label: "update",
  input: parseEditInput,
  depends: { saved: patchIssue },
  run: async ({ saved }, ctx) => {
    try {
      return await saved.run({ input: ctx.input });
    } catch (error: unknown) {
      throw readRemoteError(error, ctx.input.id);
    }
  },
});

/** Append a comment through the running server; no revision is needed. */
export const commentRemote = operation({
  label: "comment",
  input: parseCommentInput,
  depends: { saved: postComment },
  run: async ({ saved }, ctx) => {
    try {
      return await saved.run({ input: ctx.input });
    } catch (error: unknown) {
      throw readRemoteError(error, ctx.input.issueId);
    }
  },
});

/** Show one saved issue with its comments, activity, and revision. The `tool` meta
 * stays until the harness ticket: the harness reads it off this op, while MCP
 * reads the `issueTools` rows and the CLI reads the `issueCommands` rows below. */
export const getRemote = operation({
  label: "get",
  input: parseGetInput,
  meta: [
    tool({ description: "show one saved issue with comments and activity", schema: getShape }),
  ],
  depends: { detail: getDetail },
  run: async ({ detail }, ctx) => {
    try {
      return await detail.run({ input: ctx.input });
    } catch (error: unknown) {
      throw readRemoteError(error, ctx.input);
    }
  },
});

/** The routes for the issue commands: the operation plus its argv reader, each
 * carrying the root `options` its run needs (ADR 0056). Help lists them without
 * building a root, so it needs no backend. */
export function issueCommands(options: Scope.Options = {}): readonly Process.Route[] {
  return [
    command("list", listRemote, { description: "list the saved issues", options }),
    command("create", createRemote, {
      description: "create one issue: create --title T --description D",
      input: readCreateArgs,
      options,
    }),
    command("update", updateRemote, {
      description:
        "save an edit: update ID --base-revision N [--title T] [--status S] [--assignee A]",
      input: readUpdateArgs,
      options,
    }),
    command("comment", commentRemote, {
      description: "append a comment: comment ID --author A --text T",
      input: readCommentArgs,
      options,
    }),
    command("get", getRemote, {
      description: "show one saved issue with its detail",
      input: readGetArgs,
      options,
    }),
  ];
}

/** The MCP wiring rows for the same issue actions: the operation plus its tool
 * facts, handed to `mcp({ tools })`. The MCP driver reads these rows; the
 * harness reads the `tool` meta still on `listRemote` and `getRemote`. */
export const issueTools: readonly Mcp.Row[] = [
  expose(listRemote, { description: "list the saved issues", schema: {} }),
  expose(createRemote, { description: "create one issue", schema: createShape }),
  expose(updateRemote, {
    description: "save an edit guarded by the opened revision",
    schema: updateShape,
  }),
  expose(commentRemote, {
    description: "append a comment without an edit revision",
    schema: commentShape,
  }),
  expose(getRemote, {
    description: "show one saved issue with comments and activity",
    schema: getShape,
  }),
];

/** The issue MCP driver: installed on the scope `runMain` creates, resolved in
 * the `mcp` entry command. */
export const issuesMcp = mcp({ name: "issues", version: "0.1.0", tools: issueTools });
