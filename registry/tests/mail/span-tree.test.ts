import { createScope, operation, type Observe } from "@tinker/core";
import { expect, test } from "vite-plus/test";
import { fixture, input, readStates, scopes } from "./fixtures.ts";

test("the graph traces queuing mail and delivering it", async () => {
  const { client, clock, sendMail, tags, extensions } = await fixture();
  const spans: Observe.Span[] = [];
  const welcome = operation({
    label: "welcome",
    depends: { sendMail },
    run: ({ sendMail }) => sendMail.run({ input }),
  });
  const scope = createScope({ tags, extensions, observe: { export: (span) => spans.push(span) } });
  scopes.push(scope);
  await scope.ready;
  spans.length = 0;
  await scope.session((s) => s.run(welcome));
  await clock.advance(1000);
  await expect.poll(() => readStates(client)).toEqual([{ state: "completed", retry_count: 0 }]);
  expect(
    spans
      .filter((span) => ["welcome", "mail.send", "jobs.send", "mail.deliver"].includes(span.name))
      .map((span) => ({
        name: span.name,
        parent: spans.find((parent) => parent.id === span.parentId)?.name,
      })),
  ).toEqual([
    { name: "jobs.send", parent: "mail.send" },
    { name: "mail.send", parent: "welcome" },
    { name: "welcome", parent: undefined },
    { name: "mail.deliver", parent: undefined },
  ]);
});
