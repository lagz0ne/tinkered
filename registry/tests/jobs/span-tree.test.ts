import { createScope, operation, type Observe } from "@tinker/core";
import { expect, test } from "vite-plus/test";
import { job } from "../../src/jobs/index.ts";
import { fixture, scopes } from "./fixtures.ts";

test("the graph traces sending and running the job operation", async () => {
  const receive = operation({ label: "receive", run: () => undefined });
  const { client, clock, piece, tags } = await fixture([job("trace", receive)]);
  const spans: Observe.Span[] = [];
  const add = operation({
    label: "add",
    depends: { send: piece.send },
    run: ({ send }) => send.run({ input: { queue: "trace", data: {} } }),
  });
  const scope = createScope({
    tags,
    extensions: [piece.extension],
    observe: { export: (span) => spans.push(span) },
  });
  scopes.push(scope);
  await scope.ready;
  spans.length = 0;
  await scope.session((s) => s.run(add));
  await clock.advance(1000);
  await expect
    .poll(async () => (await client.query("select state from pgboss.job")).rows)
    .toEqual([{ state: "completed" }]);
  expect(
    spans
      .filter((span) => ["add", "jobs.send", "receive"].includes(span.name))
      .map((span) => ({
        name: span.name,
        parent: spans.find((parent) => parent.id === span.parentId)?.name,
      })),
  ).toEqual([
    { name: "jobs.send", parent: "add" },
    { name: "add", parent: undefined },
    { name: "receive", parent: undefined },
  ]);
});
