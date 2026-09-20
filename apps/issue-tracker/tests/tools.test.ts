import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { createScope } from "@tinker/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { run } from "@tinker/cli";
import { mcpServer } from "@tinker/mcp";
import {
  api,
  createApp,
  issueCommands,
  issueTools,
  parseComment,
  parseIssue,
  parseIssueDetail,
  parseIssueList,
  readDetail,
} from "../src/index.ts";

function tempPath(): string {
  return join(mkdtempSync(join(tmpdir(), "issues-tools-")), "db");
}

type Heard = { readonly stop: () => Promise<void>; readonly base: string };

async function hear(app: {
  fetch: (req: Request) => Response | Promise<Response>;
}): Promise<Heard> {
  const { serve } = await import("@hono/node-server");
  let settle: (port: number) => void = () => undefined;
  const heard = new Promise<number>((resolve) => {
    settle = resolve;
  });
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, (info) =>
    settle(info.port),
  );
  const port = await heard;
  return {
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
    base: `http://127.0.0.1:${port}`,
  };
}

function readTextPart(part: unknown): string {
  if (typeof part !== "object" || part === null) return "";
  if (!("type" in part) || !("text" in part)) return "";
  if (part.type !== "text" || typeof part.text !== "string") return "";
  return part.text;
}

function readText(answered: object): string {
  if (!("content" in answered)) return "";
  const content: unknown = answered.content;
  if (!Array.isArray(content)) return "";
  return readTextPart(content[0]);
}

test("missing and blank revisions report command usage", async () => {
  const base = { name: "issues", version: "0.1.0" };
  const usage = `${base.name} ${base.version}\n  comment`;
  const tags = [...issueCommands, ...issueTools, api.config({ baseUrl: "http://127.0.0.1:1" })];
  const missing = await run({ ...base, scope: { tags }, argv: ["update", "x"] });
  expect(missing.code).toBe(2);
  expect(missing.stdout).toBe("");
  expect(missing.stderr).toContain(usage);
  const blank = await run({
    ...base,
    scope: { tags },
    argv: ["update", "x", "--base-revision", "  "],
  });
  expect(blank.code).toBe(2);
  expect(blank.stdout).toBe("");
  expect(blank.stderr).toContain(usage);
});

test("help lists the issue commands with no backend", async () => {
  const helped = await run({
    name: "issues",
    version: "0.1.0",
    scope: { tags: [...issueCommands, ...issueTools] },
    argv: ["help"],
  });
  expect(helped.code).toBe(0);
  expect(helped.stdout).toContain("  list");
  expect(helped.stdout).toContain("  create");
  expect(helped.stdout).toContain("  update");
  expect(helped.stdout).toContain("  comment");
  expect(helped.stdout).toContain("  get");
  expect(helped.stderr).toBe("");
});

test("CLI drives the saved create/list/update/comment/get through real HTTP", async () => {
  const { scope, app } = await createApp({ dataPath: tempPath() });
  const heard = await hear(app);
  const tags = [...issueCommands, ...issueTools, api.config({ baseUrl: heard.base })];
  const options = { name: "issues", version: "0.1.0" };
  try {
    const created = await run({
      ...options,
      scope: { tags },
      argv: ["create", "--title", "Tool saved", "--description", "via CLI"],
    });
    expect(created.code).toBe(0);
    const made = parseIssue(JSON.parse(created.stdout));
    expect(made.title).toBe("Tool saved");
    expect(made.revision).toBe(0);

    const listed = await run({ ...options, scope: { tags }, argv: ["list"] });
    expect(listed.code).toBe(0);
    const seen = parseIssueList(JSON.parse(listed.stdout));
    expect(seen.map((issue) => issue.title)).toEqual(["Tool saved"]);

    const updated = await run({
      ...options,
      scope: { tags },
      argv: ["update", made.id, "--base-revision", String(made.revision), "--status", "done"],
    });
    expect(updated.code).toBe(0);
    const moved = parseIssue(JSON.parse(updated.stdout));
    expect(moved.status).toBe("done");
    expect(moved.revision).toBe(1);
    const fresh = await scope.run(readDetail, { input: made.id });

    const stale = await run({
      ...options,
      scope: { tags },
      argv: ["update", made.id, "--base-revision", String(made.revision), "--title", "Late"],
    });
    expect(stale.code).toBe(1);
    expect(stale.stderr).toContain("IssueConflict");
    const kept = await scope.run(readDetail, { input: made.id });
    expect(kept).toEqual(fresh);
    expect(kept.issue.title).toBe("Tool saved");
    expect(kept.issue.revision).toBe(1);
    expect(kept.activity.map((entry) => entry.kind)).toEqual(["created", "edited"]);

    const commented = await run({
      ...options,
      scope: { tags },
      argv: ["comment", made.id, "--author", "Ada", "--text", "Shipped"],
    });
    expect(commented.code).toBe(0);
    const posted = parseComment(JSON.parse(commented.stdout));
    expect(posted.author).toBe("Ada");
    expect(posted.text).toBe("Shipped");

    const shown = await run({ ...options, scope: { tags }, argv: ["get", made.id] });
    expect(shown.code).toBe(0);
    const detail = parseIssueDetail(JSON.parse(shown.stdout));
    expect(detail.issue.revision).toBe(1);
    expect(detail.comments.map((comment) => comment.text)).toEqual(["Shipped"]);
    expect(detail.activity.map((entry) => entry.kind)).toEqual(["created", "edited", "commented"]);

    const gone = await run({ ...options, scope: { tags }, argv: ["get", "missing-id"] });
    expect(gone.code).toBe(1);
    expect(gone.stderr).toContain("IssueNotFound");
  } finally {
    await heard.stop();
    await scope.close({ graceful: true });
  }
});

test("MCP tools save through the same server and answer conflicts as errors", async () => {
  const { scope, app } = await createApp({ dataPath: tempPath() });
  const heard = await hear(app);
  const tools = createScope({ tags: [...issueTools, api.config({ baseUrl: heard.base })] });
  const server = mcpServer(tools, { name: "issues", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientTransport);
  try {
    const listed = await client.listTools();
    expect(listed.tools.map((entry) => entry.name).sort()).toEqual([
      "comment",
      "create",
      "get",
      "list",
      "update",
    ]);

    const created = await client.callTool({
      name: "create",
      arguments: { title: "MCP saved", description: "via tools" },
    });
    expect(created.isError).not.toBe(true);
    const made = parseIssue(JSON.parse(readText(created)));
    expect(made.title).toBe("MCP saved");
    const seen = await client.callTool({ name: "list", arguments: {} });
    expect(parseIssueList(JSON.parse(readText(seen))).map((issue) => issue.title)).toEqual([
      "MCP saved",
    ]);

    const updated = await client.callTool({
      name: "update",
      arguments: { id: made.id, baseRevision: made.revision, status: "in_progress" },
    });
    expect(updated.isError).not.toBe(true);
    const moved = parseIssue(JSON.parse(readText(updated)));
    expect(moved.status).toBe("in_progress");
    expect(moved.revision).toBe(1);
    const fresh = await scope.run(readDetail, { input: made.id });

    const stale = await client.callTool({
      name: "update",
      arguments: { id: made.id, baseRevision: made.revision, title: "Late" },
    });
    expect(stale.isError).toBe(true);
    expect(readText(stale)).toContain("IssueConflict");
    const kept = await scope.run(readDetail, { input: made.id });
    expect(kept).toEqual(fresh);
    expect(kept.issue.title).toBe("MCP saved");
    expect(kept.issue.revision).toBe(1);
    expect(kept.activity.map((entry) => entry.kind)).toEqual(["created", "edited"]);

    const commented = await client.callTool({
      name: "comment",
      arguments: { issueId: made.id, author: "Lin", text: "On it" },
    });
    expect(commented.isError).not.toBe(true);
    const posted = parseComment(JSON.parse(readText(commented)));
    expect(posted.author).toBe("Lin");
    expect(posted.text).toBe("On it");
    const shown = await client.callTool({ name: "get", arguments: { id: made.id } });
    expect(shown.isError).not.toBe(true);
    const detail = parseIssueDetail(JSON.parse(readText(shown)));
    expect(detail.comments.map((comment) => comment.text)).toEqual(["On it"]);
    expect(detail.activity.map((entry) => entry.kind)).toEqual(["created", "edited", "commented"]);

    const missing = await client.callTool({
      name: "comment",
      arguments: { issueId: made.id, author: "Nope", text: "junk" },
    });
    expect(missing.isError).toBe(true);
  } finally {
    await client.close();
    await server.close();
    await tools.close({ graceful: true });
    await heard.stop();
    await scope.close({ graceful: true });
  }
});
