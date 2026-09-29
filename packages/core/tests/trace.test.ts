import { execFileSync } from "node:child_process";
import { expect, test } from "vite-plus/test";
import {
  createScope,
  extension,
  makeTestClock,
  makeTestRandom,
  namespace,
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

test("importing core draws no random values; the id stream seeds on the first observed span", () => {
  expect(
    execFileSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--no-warnings",
        "--input-type=module",
        "--eval",
        `
          import assert from "node:assert/strict";
          const getRandomValues = crypto.getRandomValues.bind(crypto);
          let allowed = false;
          crypto.getRandomValues = (words) => {
            assert.ok(allowed, "random values are not allowed in global scope");
            return getRandomValues(words);
          };
          const { createScope } = await import(process.argv[1]);
          const off = createScope();
          assert.equal(off.run({ run: () => 42 }), 42);
          await off.close();
          const observed = createScope({ observe: { history: 10 } });
          allowed = true;
          const first = observed.run({ run: (_deps, { obs }) => obs.span });
          allowed = false;
          const second = observed.run({ run: (_deps, { obs }) => obs.span });
          for (const span of [first, second]) {
            assert.match(span.traceId, /^[0-9a-f]{32}$/);
            assert.match(span.spanId, /^[0-9a-f]{16}$/);
            assert.notEqual(span.traceId, "0".repeat(32));
            assert.notEqual(span.spanId, "0".repeat(16));
          }
          await observed.close();
          process.stdout.write("ok");
        `,
        new URL("../src/index.ts", import.meta.url).href,
      ],
      { encoding: "utf8" },
    ),
  ).toBe("ok");
});

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

test("span JSON keeps public fields, ids, attributes, and events without internal state", async () => {
  const cause = { reason: "could not read" };
  for (const fails of [false, true]) {
    const child = operation({
      label: "child",
      run: (_deps, { obs }) => {
        obs.span!.attributes.answer = 42;
        obs.event("read", { size: 1 });
        if (fails) throw cause;
      },
    });
    const scope = createScope({ clock: makeTestClock({ now: 100 }), observe: { history: 10 } });
    const result = scope.settle({
      label: "parent",
      depends: { child },
      run: ({ child }) => child.run(),
    });
    const span = scope.spans().find((span) => span.name === "child")!;
    expect(JSON.parse(JSON.stringify(span))).toStrictEqual({
      id: span.id,
      parentId: span.parentId,
      traceId: span.traceId,
      spanId: span.spanId,
      parentSpanId: span.parentSpanId,
      sampled: true,
      name: "child",
      kind: "operation",
      start: 100,
      end: 100,
      status: result.status === "success" ? "ok" : "failed",
      ...(fails ? { error: cause } : {}),
      attributes: { answer: 42 },
      events: [{ name: "read", time: 100, attributes: { size: 1 } }],
    });
    await scope.close();
  }
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

test("reading ids later leaves the seeded random stream and ids unchanged", async () => {
  const earlyRandom = makeTestRandom({ seed: 42 });
  const lateRandom = makeTestRandom({ seed: 42 });
  const early = createScope({ random: earlyRandom, observe: { history: 10 } });
  const late = createScope({ random: lateRandom, observe: { history: 10 } });
  const first = early.run(readSpan)!;
  const firstIds = { traceId: first.traceId, spanId: first.spanId };
  const delayed = late.run(readSpan)!;
  expect(lateRandom.next()).toBe(earlyRandom.next());
  const second = early.run(readSpan)!;
  const last = late.run(readSpan)!;
  expect({ traceId: last.traceId, spanId: last.spanId }).toEqual({
    traceId: second.traceId,
    spanId: second.spanId,
  });
  expect({ traceId: delayed.traceId, spanId: delayed.spanId }).toEqual(firstIds);
  expect(lateRandom.next()).toBe(earlyRandom.next());
  await early.close();
  await late.close();
});

test("observation leaves seeded and custom user randomness unchanged", async () => {
  const value = resource({ label: "value", factory: (_deps, ctx) => ctx.random.next() });
  const inner = operation({
    label: "inner",
    run: (_deps, ctx) => [ctx.random.next(), ctx.random.uuid()],
  });
  const outer = operation({
    label: "outer",
    depends: { value, inner },
    run: ({ value, inner }, ctx) => ({ value, own: ctx.random.next(), inner: inner.run() }),
  });
  for (const custom of [false, true]) {
    for (const observing of [false, true]) {
      const random = makeTestRandom({ seed: 7 });
      const untouched = makeTestRandom({ seed: 7 });
      const scope = createScope({
        random: custom ? { next: () => random.next(), uuid: () => random.uuid() } : random,
        observe: observing ? { history: 20 } : undefined,
      });
      expect(scope.run(outer)).toEqual({
        value: untouched.next(),
        own: untouched.next(),
        inner: [untouched.next(), untouched.uuid()],
      });
      expect(scope.createSession().run(inner)).toEqual([untouched.next(), untouched.uuid()]);
      expect(random.next()).toBe(untouched.next());
      expect(random.uuid()).toBe(untouched.uuid());
      await scope.close();
    }
  }
});

test("user random reads do not change seeded trace and child span ids", async () => {
  const parent = operation({
    label: "parent",
    depends: { readSpan },
    run: ({ readSpan }) => readSpan.run(),
  });
  const firstRandom = makeTestRandom({ seed: 7 });
  const secondRandom = makeTestRandom({ seed: 7 });
  const first = createScope({ random: firstRandom, observe: { history: 10 } });
  const second = createScope({ random: secondRandom, observe: { history: 10 } });
  for (let n = 0; n < 2; n++) {
    secondRandom.next();
    secondRandom.uuid();
    const a = first.run(parent)!;
    const b = second.run(parent)!;
    expect({ traceId: b.traceId, spanId: b.spanId, parentSpanId: b.parentSpanId }).toEqual({
      traceId: a.traceId,
      spanId: a.spanId,
      parentSpanId: a.parentSpanId,
    });
  }
  await first.close();
  await second.close();
});

test("seeded ids use generator bits in every hex position and stay nonzero", async () => {
  const scope = createScope({ random: makeTestRandom({ seed: 0 }), observe: { history: 128 } });
  const traces: string[] = [];
  const spans: string[] = [];
  for (let n = 0; n < 64; n++) {
    const span = scope.run(readSpan)!;
    traces.push(span.traceId);
    spans.push(span.spanId);
  }
  for (const { ids, width } of [
    { ids: traces, width: 32 },
    { ids: spans, width: 16 },
  ]) {
    for (let digit = 0; digit < width; digit++) {
      expect(new Set(ids.map((id) => id.charAt(digit))).size).toBeGreaterThan(1);
    }
    for (const id of ids) expect(id).not.toMatch(/^0+$/);
  }
  await scope.close();
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

test("a session seed follows direct resource builds to their scope owner", async () => {
  const scope = createScope({ observe: { history: 10 } });
  const session = scope.createSession({ trace: seed, ns: namespace() });
  const bare = resource({ label: "bare", factory: () => 1 });
  const full = resource({ label: "full", factory: (_deps, ctx) => ctx.obs.span });
  const named = resource({ label: "named", target: "namespace", factory: () => 2 });
  session.resolve(bare);
  session.resolve(full);
  session.resolve(named);
  expect(
    scope.spans().map(({ traceId, parentSpanId, sampled }) => ({ traceId, parentSpanId, sampled })),
  ).toEqual([seed, seed, seed]);
  await scope.close();
});
