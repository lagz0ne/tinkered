import { operation } from "@tinker/core";
import type { Scope } from "@tinker/core";
import { argv, io, jsonLine, type Process } from "@tinker/process";
import { isError as isHttpError } from "@tinker/http";
import { expose, mcp, type Mcp } from "@tinker/mcp";
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

/** List the saved issues through the running server. */
export const listRemote = operation({
  label: "list",
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

/** Show one saved issue with its comments, activity, and revision. */
export const getRemote = operation({
  label: "get",
  input: parseGetInput,
  depends: { detail: getDetail },
  run: async ({ detail }, ctx) => {
    try {
      return await detail.run({ input: ctx.input });
    } catch (error: unknown) {
      throw readRemoteError(error, ctx.input);
    }
  },
});

/** The `list` command: no argv to read, the saved issues out as one JSON line. Declared once at
 * module level (ADR 0057): its identity is its cache key, and it reads no root options. */
const listCommand: Process.Command = operation({
  label: "list",
  depends: { io: io.required, remote: listRemote },
  run: async ({ io: out, remote }) => {
    out.write(jsonLine(await remote.run()) ?? "");
    return 0;
  },
});

/** The `create` command: `--title` and `--description` in, the saved issue out. */
const createCommand: Process.Command = operation({
  label: "create",
  depends: { argv: argv.required, io: io.required, remote: createRemote },
  run: async ({ argv: args, io: out, remote }) => {
    out.write(jsonLine(await remote.run({ rawInput: readCreateArgs(args) })) ?? "");
    return 0;
  },
});

/** The `update` command: the id plus `--base-revision` and the edited fields in. */
const updateCommand: Process.Command = operation({
  label: "update",
  depends: { argv: argv.required, io: io.required, remote: updateRemote },
  run: async ({ argv: args, io: out, remote }) => {
    out.write(jsonLine(await remote.run({ rawInput: readUpdateArgs(args) })) ?? "");
    return 0;
  },
});

/** The `comment` command: the id plus `--author` and `--text` in. */
const commentCommand: Process.Command = operation({
  label: "comment",
  depends: { argv: argv.required, io: io.required, remote: commentRemote },
  run: async ({ argv: args, io: out, remote }) => {
    out.write(jsonLine(await remote.run({ rawInput: readCommentArgs(args) })) ?? "");
    return 0;
  },
});

/** The `get` command: the id in, the saved issue with its detail out. */
const getCommand: Process.Command = operation({
  label: "get",
  depends: { argv: argv.required, io: io.required, remote: getRemote },
  run: async ({ argv: args, io: out, remote }) => {
    out.write(jsonLine(await remote.run({ rawInput: readGetArgs(args) })) ?? "");
    return 0;
  },
});

/** The routes for the issue commands: plain rows, each naming one of the module-level operations
 * above and carrying the root `options` its run needs (ADR 0056). Help lists them without
 * building a root, so it needs no backend. */
export function issueCommands(options: Scope.Options = {}): readonly Process.Route[] {
  return [
    {
      name: "list",
      description: "list the saved issues",
      entry: () => ({ op: listCommand, options }),
    },
    {
      name: "create",
      description: "create one issue: create --title T --description D",
      entry: () => ({ op: createCommand, options }),
    },
    {
      name: "update",
      description:
        "save an edit: update ID --base-revision N [--title T] [--status S] [--assignee A]",
      entry: () => ({ op: updateCommand, options }),
    },
    {
      name: "comment",
      description: "append a comment: comment ID --author A --text T",
      entry: () => ({ op: commentCommand, options }),
    },
    {
      name: "get",
      description: "show one saved issue with its detail",
      entry: () => ({ op: getCommand, options }),
    },
  ];
}

/** The `list` tool row: MCP serves it, and the draft harness takes it too. */
export const listTool: Mcp.Row = expose(listRemote, {
  description: "list the saved issues",
  schema: {},
});

/** The `get` tool row: MCP serves it, and the draft harness takes it too. */
export const getTool: Mcp.Row = expose(getRemote, {
  description: "show one saved issue with comments and activity",
  schema: getShape,
});

/** The MCP wiring rows for the issue actions: the operation plus its tool
 * facts, handed to `mcp({ tools })`. */
export const issueTools: readonly Mcp.Row[] = [
  listTool,
  expose(createRemote, { description: "create one issue", schema: createShape }),
  expose(updateRemote, {
    description: "save an edit guarded by the opened revision",
    schema: updateShape,
  }),
  expose(commentRemote, {
    description: "append a comment without an edit revision",
    schema: commentShape,
  }),
  getTool,
];

/** The issue MCP driver: installed on the scope `runMain` creates, resolved in
 * the `mcp` entry command. */
export const issuesMcp = mcp({ name: "issues", version: "0.1.0", tools: issueTools });
