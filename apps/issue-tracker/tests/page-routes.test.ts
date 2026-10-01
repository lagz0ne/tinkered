import { createScope } from "@tinker/core";
import { expect, test } from "vite-plus/test";
import { cloneDatabase } from "./database.ts";
import { issueServer, migrateIssues, publish, src, storeConfig } from "../src/index.ts";

test("a sync route without its source answers 500 before streaming", async () => {
  const web = issueServer();
  const scope = createScope({ extensions: [web] });
  try {
    await scope.ready;
    const response = await scope.resolve(web).request("/sync?keys=issues");
    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).not.toBe("text/event-stream");
  } finally {
    await scope.close();
  }
});

test.each([
  { path: "/api/issues", method: "POST", body: {}, status: 400, text: "title is required" },
  {
    path: "/api/issues/missing",
    method: "PATCH",
    body: {},
    status: 400,
    text: "revision is required",
  },
  {
    path: "/api/issues/missing/comments",
    method: "POST",
    body: {},
    status: 400,
    text: "author is unknown",
  },
  {
    path: "/api/issues/missing/draft",
    method: "POST",
    body: { prompt: 1 },
    status: 400,
    text: "prompt must be text",
  },
  {
    path: "/api/issues/missing/draft",
    method: "POST",
    body: {},
    status: 404,
    text: "draft helper is off",
  },
  { path: "/api/issues/missing", method: "GET", status: 404, text: "issue not found" },
])(
  "a page keeps the API error reply for $method $path: $text",
  async ({ path, method, body, status, text }) => {
    const web = issueServer();
    const scope = createScope({
      tags: [storeConfig({ kind: "borrow", ...(await cloneDatabase()) })],
      extensions: [web, migrateIssues, src, publish()],
    });
    try {
      await scope.ready;
      const response = await scope.resolve(web).request(path, {
        method,
        headers: { "content-type": "application/json" },
        body: method === "GET" ? undefined : JSON.stringify(body),
      });
      expect(response.status).toBe(status);
      expect(await response.text()).toBe(status === 400 ? "bad request" : text);
    } finally {
      await scope.close();
    }
  },
);
