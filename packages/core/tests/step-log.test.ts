import { expect, test } from "vite-plus/test";
import { createScope, LEVELS, operation, resource, type Observe } from "../src/index.ts";

test("an observed operation logs its label, elapsed time, outcome, level, and span", () => {
  const lines: Observe.Log[] = [];
  let now = 10;
  const op = operation({ label: "step", run: () => 7 });
  const scope = createScope({
    observe: { history: 2, clock: () => now++, log: (line) => void lines.push(line) },
  });
  expect(scope.run(op)).toBe(7);
  expect(lines).toEqual([
    {
      message: "step",
      attributes: { ms: 1, outcome: "ok" },
      level: LEVELS.debug,
      time: 11,
      span: scope.spans()[0],
    },
  ]);
  expect(lines[0].span).toBe(scope.spans()[0]);
});

test("a failed operation logs its failure at error level", () => {
  const lines: Observe.Log[] = [];
  const failure = new Error("failed");
  const op = operation({
    label: "step",
    run: (): number => {
      throw failure;
    },
  });
  let now = 30;
  const scope = createScope({
    observe: { history: 1, clock: () => now++, log: (line) => void lines.push(line) },
  });
  expect(() => scope.run(op)).toThrow(failure);
  expect(lines).toEqual([
    {
      message: "step",
      attributes: { ms: 1, outcome: "failed" },
      level: LEVELS.error,
      time: 31,
      span: scope.spans()[0],
    },
  ]);
});

test("nested subflows log child before parent, once each", () => {
  const lines: Observe.Log[] = [];
  const child = operation({ label: "child", run: () => 2 });
  const dep = resource({ label: "dep", factory: () => 1 });
  const parent = operation({
    label: "parent",
    depends: { child, dep },
    run: ({ child, dep }) => child.run() + dep,
  });
  const scope = createScope({
    observe: { history: 2, log: (line) => void lines.push(line) },
  });
  expect(scope.run(parent)).toBe(3);
  expect(lines.map((line) => line.message)).toEqual(["child", "parent"]);
  expect(lines[0].span?.parentId).toBe(lines[1].span?.id);
});

test("an info threshold drops ok step lines but keeps failed ones", () => {
  const lines: Observe.Log[] = [];
  const ok = operation({ label: "ok", run: () => 1 });
  const failure = new Error("failed");
  const failed = operation({
    label: "failed",
    run: (): number => {
      throw failure;
    },
  });
  const scope = createScope({
    observe: { history: 2, level: LEVELS.info, log: (line) => void lines.push(line) },
  });
  scope.run(ok);
  expect(() => scope.run(failed)).toThrow(failure);
  expect(lines.map((line) => [line.message, line.level, line.attributes.outcome])).toEqual([
    ["failed", LEVELS.error, "failed"],
  ]);
});

test("logging without observation keeps ctx.log but emits no step line", () => {
  const lines: Observe.Log[] = [];
  const op = operation({
    label: "step",
    run: (_deps, ctx) => {
      ctx.log("body");
      return 1;
    },
  });
  const scope = createScope({ observe: { log: (line) => void lines.push(line) } });
  expect(scope.run(op)).toBe(1);
  expect(lines.map((line) => line.message)).toEqual(["body"]);
  expect(lines[0].span).toBe(undefined);
});

test("observing without a log sink preserves operation and resource spans", () => {
  const dep = resource({ label: "dep", factory: () => 3 });
  const op = operation({ label: "step", depends: { dep }, run: ({ dep }) => dep });
  const scope = createScope({ observe: { history: 2 } });
  expect(scope.run(op)).toBe(3);
  expect(scope.spans().map((span) => [span.kind, span.status])).toEqual([
    ["resource", "ok"],
    ["operation", "ok"],
  ]);
});

test("a throwing step log sink does not change the run result", () => {
  const op = operation({ label: "step", run: () => 4 });
  const scope = createScope({
    observe: {
      history: 1,
      log: () => {
        throw new Error("sink");
      },
    },
  });
  expect(scope.run(op)).toBe(4);
  expect(scope.spans()[0].status).toBe("ok");
});
