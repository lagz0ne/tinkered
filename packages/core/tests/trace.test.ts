import { expect, test } from "vite-plus/test";
import {
  createScope,
  extension,
  makeTestRandom,
  operation,
  resource,
  tag,
  type Observe,
} from "../src/index.ts";

const readSpan = operation({ label: "readSpan", run: (_deps, ctx) => ctx.obs.span });
const seed: Observe.Trace = {
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  parentSpanId: "00f067aa0ba902b7",
  sampled: false,
};
const hint = tag<string>({ label: "hint" });

test("a root span has nonzero W3C ids before its body runs", async () => {
  const scope = createScope({ observe: { history: 10 } });
  scope.run({
    run: (_deps, { obs }) => {
      expect(obs.span).toMatchObject({
        parentId: undefined,
        parentSpanId: undefined,
        sampled: true,
        end: undefined,
      });
      expect(obs.span?.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(obs.span?.traceId).not.toBe("0".repeat(32));
      expect(obs.span?.spanId).toMatch(/^[0-9a-f]{16}$/);
      expect(obs.span?.spanId).not.toBe("0".repeat(16));
    },
  });
  await scope.close();
});

test("operation, resource, and manual children inherit the trace and name their parent span", async () => {
  const full = resource({
    label: "full",
    factory: (_deps, ctx) => ctx.obs.child("manual", () => 1),
  });
  const bare = resource({ label: "bare", factory: () => 2 });
  const parent = operation({
    label: "parent",
    depends: { readSpan, full, bare },
    run: ({ readSpan }) => readSpan.run({ tags: hint("child") }),
  });
  const scope = createScope({ observe: { history: 10 } });
  await scope.run(parent);
  const spans = scope.spans();
  const root = spans.find((span) => span.name === "parent")!;
  expect(spans.map((span) => span.name)).toEqual(["manual", "full", "bare", "readSpan", "parent"]);
  for (const span of spans.filter((span) => span !== root)) {
    expect(span.traceId).toBe(root.traceId);
    expect(span.parentSpanId).toBe(spans.find((parent) => parent.id === span.parentId)?.spanId);
  }
  expect(new Set(spans.map((span) => span.spanId)).size).toBe(spans.length);
  await scope.close();
});

test("two unseeded root spans start different traces", async () => {
  const scope = createScope({ observe: { history: 10 } });
  const first = scope.run(readSpan)!;
  const second = scope.run(readSpan)!;
  expect(second.traceId).not.toBe(first.traceId);
  await scope.close();
});

test("a seeded random replays trace and span ids", async () => {
  const first = createScope({ random: makeTestRandom({ seed: 42 }), observe: { history: 10 } });
  const second = createScope({ random: makeTestRandom({ seed: 42 }), observe: { history: 10 } });
  for (let n = 0; n < 2; n++) {
    const a = first.run(readSpan)!;
    const b = second.createSession().run(readSpan)!;
    expect({ traceId: b.traceId, spanId: b.spanId }).toEqual({
      traceId: a.traceId,
      spanId: a.spanId,
    });
  }
  await first.close();
  await second.close();
});

test("observation off leaves the ambient random stream untouched", async () => {
  const random = makeTestRandom({ seed: 42 });
  const untouched = makeTestRandom({ seed: 42 });
  const scope = createScope({ random, trace: seed, observe: { log: () => undefined } });
  const child = scope.createSession({ trace: seed });
  expect(child.run(readSpan)).toBeUndefined();
  child.run({
    run: (_deps, { obs }) => obs.child("manual", (span) => expect(span).toBeUndefined()),
  });
  expect(random.uuid()).toBe(untouched.uuid());
  await scope.close();
});

test("a session copies its remote trace seed and child sessions inherit it", async () => {
  const hook = extension({ label: "sessions", session: (_session, next) => next() });
  const scope = createScope({ observe: { history: 20 }, extensions: hook });
  await scope.ready;
  const given = { ...seed };
  const session = scope.createSession({ trace: given });
  given.traceId = "1".repeat(32);
  given.parentSpanId = "2".repeat(16);
  const first = session.run(readSpan)!;
  const nested = (await session.createSession().run(readSpan, { tags: hint("nested") }))!;
  for (const span of [first, nested]) expect(span).toMatchObject(seed);
  expect(nested.spanId).not.toBe(first.spanId);
  expect(scope.run(readSpan)?.traceId).not.toBe(seed.traceId);
  await scope.close();
});

test("a session seed overrides its scope seed without changing siblings", async () => {
  const scope = createScope({ observe: { history: 10 }, trace: seed });
  const other = { traceId: "a".repeat(32), parentSpanId: "b".repeat(16) };
  const child = scope.createSession({ trace: other });
  expect(child.run(readSpan)).toMatchObject({ ...other, sampled: true });
  expect(scope.createSession().run(readSpan)).toMatchObject(seed);
  await scope.close();
});

test("a seeded subflow uses its local caller as parent and keeps the sampled flag", async () => {
  const scope = createScope({ observe: { history: 10 } });
  const session = scope.createSession({ trace: seed });
  const child = session.run({
    label: "parent",
    depends: { readSpan },
    run: ({ readSpan }) => readSpan.run(),
  })!;
  const parent = scope.spans().find((span) => span.name === "parent")!;
  expect(child).toMatchObject({
    traceId: seed.traceId,
    parentSpanId: parent.spanId,
    sampled: false,
  });
  await scope.close();
});

test("a null session seed starts a fresh trace without changing its parent", async () => {
  const scope = createScope({ observe: { history: 10 }, trace: seed });
  const fresh = scope.createSession({ trace: null }).createSession().run(readSpan)!;
  expect(fresh.traceId).not.toBe(seed.traceId);
  expect(fresh.parentSpanId).toBeUndefined();
  expect(scope.run(readSpan)).toMatchObject(seed);
  await scope.close();
});
