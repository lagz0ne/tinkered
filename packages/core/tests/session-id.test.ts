import { expect, test } from "vite-plus/test";

import { capsule, createScope, operation, resource, tag, type Observe, type Scope } from "@/index";

const hint = tag<string>({ label: "hint" });

const conn = resource({ label: "conn", target: "session", factory: () => 1 });

const step = operation({ label: "step", depends: { conn }, run: ({ conn }) => conn });

/** A root with one capsule that taps every span, as a devtools capsule does. */
async function tapped(): Promise<{ scope: Scope.Handle; spans: Observe.Span[] }> {
  const spans: Observe.Span[] = [];
  const devtools = capsule({
    label: "devtools",
    hooks: { start: ({ tap }) => tap({ export: (span) => void spans.push(span) }) },
  });
  const scope = await createScope({ capsules: [devtools()] }).ready;
  return { scope, spans };
}

const idsOf = (spans: Observe.Span[]) =>
  spans.map((span) => [span.name, span.attributes["session.id"]]);

test("each span in a session carries that session's id; a root span carries none", async () => {
  const { scope, spans } = await tapped();
  const [a, b] = [scope.createSession(), scope.createSession()];

  scope.run({ label: "top", run: () => 0 });
  a.run(step);
  b.run(step);

  const [first, second] = [spans[1]?.attributes["session.id"], spans[3]?.attributes["session.id"]];
  expect(idsOf(spans)).toEqual([
    ["top", undefined],
    ["conn", first],
    ["step", first],
    ["conn", second],
    ["step", second],
  ]);
  expect(first).not.toBe(second);
  await scope.close();
});

test("a nested session's spans carry the innermost id", async () => {
  const { scope, spans } = await tapped();
  const outer = scope.createSession();

  outer.run(step);
  await outer.session((inner) => inner.run(step));

  const [own, , nested] = idsOf(spans).map(([, id]) => id);
  expect(typeof own).toBe("number");
  expect(nested).not.toBe(own);
  await scope.close();
});

test("a tagged call's spans keep its session's id", async () => {
  const { scope, spans } = await tapped();
  const session = scope.createSession();

  session.run(step);
  await session.run(step, { tags: hint("tagged") });

  const [own, , tagged] = idsOf(spans).map(([, id]) => id);
  expect(typeof own).toBe("number");
  expect(tagged).toBe(own);
  await scope.close();
});

test("a session hook sees, at open and at close, the id its session's spans carry", async () => {
  const spans: Observe.Span[] = [];
  const seen: unknown[] = [];
  const devtools = capsule({
    label: "devtools",
    hooks: {
      start: ({ tap }) => tap({ export: (span) => void spans.push(span) }),
      session: async ({ handle, next }) => {
        seen.push(["open", handle.id]);
        const ended = await next();
        seen.push(["close", handle.id]);
        return ended;
      },
    },
  });
  const scope = await createScope({ capsules: [devtools()] }).ready;
  const session = scope.createSession();

  session.run(step);
  await session.close();

  const id = spans.find((span) => span.name === "step")?.attributes["session.id"];
  expect(typeof id).toBe("number");
  expect(seen).toEqual([
    ["open", id],
    ["close", id],
  ]);
  expect(session.id).toBe(id);
  await scope.close();
});

test("the root, and a session opened with no tap, have no id", async () => {
  const scope = createScope();
  const session = scope.createSession();

  const ids = [scope.id, session.id];

  expect(ids).toEqual([undefined, undefined]);
  await scope.close();
});
