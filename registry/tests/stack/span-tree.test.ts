import { createScope, operation, type Observe } from "@tinker/core";
import { hono, route } from "../../src/hono/index.ts";
import { startNatsServer } from "../../src/nats/testing.ts";
import { expect, test } from "vite-plus/test";
import { liveUpdates } from "../../src/stack/index.ts";

test("the graph traces the changed signal and the root re-read", async () => {
  const server = await startNatsServer();
  const spans: Observe.Span[] = [];
  const publish = operation({ label: "publish", run: () => undefined });
  const save = operation({ label: "save", run: () => "saved" });
  const web = hono([route.post("/", save)]).extension;
  const scope = createScope({
    extensions: [
      web,
      liveUpdates(publish, { subject: "trace.changed", env: { NATS_URL: server.url } }),
    ],
    observe: { export: (span) => spans.push(span) },
  });
  try {
    await scope.ready;
    spans.length = 0;
    await scope.resolve(web).request("/", { method: "POST" });
    await expect.poll(() => spans.some((span) => span.name === "stack.refresh")).toBe(true);
    await scope.close({ graceful: true });
    expect(
      spans.map((span) => ({
        name: span.name,
        parent: spans.find((parent) => parent.id === span.parentId)?.name,
      })),
    ).toEqual([
      { name: "save", parent: "POST /" },
      { name: "POST /", parent: undefined },
      { name: "publish", parent: "publish after commit" },
      { name: "nats.publish", parent: "stack.changed" },
      { name: "stack.changed", parent: "publish after commit" },
      { name: "publish after commit", parent: undefined },
      { name: "stack.rootPublish", parent: "stack.refresh" },
      { name: "publish", parent: "stack.rootPublish" },
      { name: "stack.refresh", parent: "nats trace.changed" },
      { name: "nats trace.changed", parent: undefined },
    ]);
  } finally {
    await scope.close();
    await server.close();
  }
});
