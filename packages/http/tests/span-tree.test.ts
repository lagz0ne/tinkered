import { expect, test } from "vite-plus/test";
import { createScope, operation, type Observe } from "@tinker/core";
import { backend, httpClient, HttpRequest, HttpResponse } from "../src/index.ts";

const api = httpClient({ label: "github", retry: { times: 1 } });

/** A caller's own operation: it depends on `send` and reads the body itself. */
const listRepos = operation({
  label: "listRepos",
  depends: { send: api.send },
  run: async ({ send }) => {
    const res = await send.run({ input: HttpRequest.get("https://api/users/x/repos") });
    return res.status;
  },
});

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

test("the graph produces the trace: a caller, its send, and one attempt per try", async () => {
  let calls = 0;
  const flaky = backend(async (request) => {
    calls += 1;
    return HttpResponse.make(request, { status: calls === 1 ? 503 : 200, body: "[]" });
  });
  const scope = createScope({ tags: [flaky], observe: { history: 50 } });
  expect(await scope.run(listRepos)).toBe(200);
  expect(shape(scope.spans())).toEqual([
    "listRepos",
    "  github.send",
    "    github.attempt",
    "    github.attempt",
  ]);
  await scope.close();
});

test("each attempt span carries the method, url, attempt number, and status", async () => {
  const ok = backend(async (request) => HttpResponse.make(request, { status: 200, body: "[]" }));
  const scope = createScope({ tags: [ok], observe: { history: 50 } });
  await scope.run(listRepos);
  const attempt = scope.spans().find((span) => span.name === "github.attempt");
  expect(attempt?.attributes).toMatchObject({
    method: "GET",
    url: "https://api/users/x/repos",
    attempt: 1,
    status: 200,
  });
  await scope.close();
});
