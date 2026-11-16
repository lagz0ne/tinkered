import { expect, test } from "vite-plus/test";

import { capsule, createScope, operation, transport, type Observe, type Scope } from "@/main";

const found = operation({ label: "found", run: async () => ({ kind: "found", id: 1 }) });

const plain = operation({ label: "plain", run: () => ({ id: 1 }) });

const denied = operation({
  label: "denied",
  depends: { flow: transport.lifecycle },
  run: ({ flow }) => flow.refuse({ signIn: true }),
});

/** A root that taps every span; `hooked` adds a run hook that passes through, as devtools does. */
async function observed(hooked: boolean): Promise<{ scope: Scope.Handle; spans: Observe.Span[] }> {
  const spans: Observe.Span[] = [];
  const devtools = capsule({
    label: "devtools",
    hooks: {
      start: ({ tap }) => tap({ export: (span) => void spans.push(span) }),
      ...(hooked ? { run: ({ next }: { next: () => unknown }) => next() } : {}),
    },
  });
  const scope = await createScope({ capsules: [devtools()] }).ready;
  return { scope, spans };
}

const exitOf = (spans: Observe.Span[], name: string) =>
  spans.find((span) => span.name === name)?.attributes["tinker.exit"];

for (const [path, hooked] of [
  ["a plain run", false],
  ["a run under a run hook", true],
] as const) {
  test(`${path}: an answer with a string kind ends its span with that kind as tinker.exit`, async () => {
    const { scope, spans } = await observed(hooked);

    await scope.run(found);
    await scope.close();

    expect(exitOf(spans, "found")).toBe("found");
  });

  test(`${path}: an rpc refusal ends its span with tinker.exit "refused"`, async () => {
    const { scope, spans } = await observed(hooked);

    scope.run(denied);
    await scope.close();

    expect(exitOf(spans, "denied")).toBe("refused");
  });

  test(`${path}: a plain value ends its span with no tinker.exit`, async () => {
    const { scope, spans } = await observed(hooked);

    scope.run(plain);
    await scope.close();

    expect(spans.map((span) => span.name)).toContain("plain");
    expect(exitOf(spans, "plain")).toBeUndefined();
  });
}

test("an answer whose kind getter throws still returns, and its span names no exit", async () => {
  const { scope, spans } = await observed(false);
  const hostile = operation({
    label: "hostile",
    run: () => ({
      get kind(): string {
        throw new RangeError("no kind");
      },
    }),
  });

  const answer = scope.run(hostile);
  await scope.close();

  expect(typeof answer).toBe("object");
  expect(spans.find((span) => span.name === "hostile")?.status).toBe("ok");
  expect(exitOf(spans, "hostile")).toBeUndefined();
});
