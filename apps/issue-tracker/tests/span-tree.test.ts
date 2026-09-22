import { createScope } from "@tinker/core";
import { backend } from "@tinker/http";
import { HttpResponse } from "@tinker/http";
import { expect, test } from "vite-plus/test";
import { api, getIssues, type Issues } from "../src/index.ts";
import type { Observe } from "@tinker/core";

/** The span tree as `parent > child` lines, deepest last, in start order. */
function shape(spans: readonly Observe.Span[]): string[] {
  const byId = new Map(spans.map((span) => [span.id, span]));
  const depth = (span: Observe.Span): number => {
    let n = 0;
    for (let at = span.parentId; at !== undefined; at = byId.get(at)?.parentId) n += 1;
    return n;
  };
  return [...spans]
    .sort((a, b) => a.id - b.id)
    .map((span) => `${"  ".repeat(depth(span))}${span.name}`);
}

test("the graph produces the trace: a caller, its send, and its attempt", async () => {
  const issue: Issues.Issue = {
    id: "i1",
    title: "First",
    description: "hello",
    status: "open",
    assignee: null,
    revision: 0,
    createdAt: 1,
    updatedAt: 1,
  };
  const fake = backend(async (request) =>
    HttpResponse.make(request, { status: 200, body: JSON.stringify([issue]) }),
  );
  const scope = createScope({
    observe: { history: 50 },
    tags: [fake, api.config({ baseUrl: "http://x" })],
  });
  const issues = await scope.run(getIssues);
  expect(issues).toEqual([issue]);
  expect(shape(scope.spans())).toEqual(["issues.getIssues", "  http.send", "    http.attempt"]);
  await scope.close();
});
