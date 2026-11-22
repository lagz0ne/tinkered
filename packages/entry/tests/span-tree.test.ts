import { createScope, operation } from "@tinkered/core";
import type { Observe } from "@tinkered/core";
import { expect, test } from "vite-plus/test";
import { z } from "zod";

import { httpBackend, httpRequest, routes } from "@/server";

/** The span tree as indented `name` lines, in start order (ADR 0058). */
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

const profile = operation({
  label: "profile",
  input: z.object({ id: z.string() }),
  depends: { get: httpRequest },
  run: async ({ get }, { input }) => {
    const url = `https://api.example/users/${input.id}`;
    const response = await get.run({ rawInput: { url, method: "GET" } });
    return { status: response.status };
  },
});

test("a routed request's trace shows the row's operation, the request it sends, and the client it builds", async () => {
  const spans: Observe.Span[] = [];
  const app = await createScope({
    observe: { export: (span) => void spans.push(span) },
    tags: [httpBackend(async () => new Response("{}"))],
    capsules: [
      routes({ stop: new AbortController().signal, table: { "GET /users/{id}": profile } }),
    ],
  }).ready;

  const answer = await app.resolve(routes).fetch(new Request("http://t/users/7"), app);
  await app.close();

  expect(answer?.status).toBe(200);
  expect(shape(spans)).toEqual(["profile", "  http.request", "    http"]);
});
