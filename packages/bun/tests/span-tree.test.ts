import { createScope, operation, rpc } from "@tinkered/core";
import type { Observe } from "@tinkered/core";
import { afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";

import { ws as wsClient } from "@/client";
import { serve, ws } from "@/index";

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const c of closers.splice(0).reverse()) await c();
});

/** The span tree as indented `name` lines, in start order: the graph produces the trace (ADR 0058). */
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

const api = rpc({ greet: { input: z.object({ name: z.string() }), output: z.string() } });

const greetHere = operation({
  label: "greet.here",
  input: api.greet.input,
  run: async (_, { input }) => `Hello, ${input.name}.`,
});

const greetFromTab = operation({
  label: "greet.tab",
  depends: { greet: api.greet },
  run: ({ greet }) => greet.run({ input: { name: "Ada" } }),
});

test("a call's trace: the tab's operation and its send, then the server's serve and its operation", async () => {
  const served: Observe.Span[] = [];
  const sent: Observe.Span[] = [];
  const socket = ws.server({ path: "/rpc", services: [api] });
  const app = await createScope({
    observe: { export: (span) => void served.push(span) },
    capsules: [
      serve({ port: 0, websocket: socket }),
      api({ implement: { greet: greetHere } }),
      socket,
    ],
  }).ready;
  closers.push(() => app.close());
  const at = app.resolve(serve.url).get()!;
  const tab = await createScope({
    observe: { export: (span) => void sent.push(span) },
    capsules: [wsClient.client({ url: `ws://${at.host}/rpc` }), api({ remote: wsClient.client })],
  }).ready;
  closers.push(() => tab.close());

  expect(await tab.run(greetFromTab)).toBe("Hello, Ada.");
  await tab.close();
  await app.close();

  const call = sent.find((span) => span.name === "greet.tab")?.traceId;
  const inCall = (spans: Observe.Span[]) => spans.filter((span) => span.traceId === call);
  expect(shape(inCall(sent))).toEqual(["greet.tab", "  greet", "    ws.call", "      ws.send"]);
  expect(shape(inCall(served))).toEqual(["ws.serve", "  rpc.answer", "    greet.here"]);
});
