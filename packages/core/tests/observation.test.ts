import { expect, test } from "vite-plus/test";
import { createScope, operation, type Observe } from "../src/index.ts";

test("a manual child span exports its event", () => {
  const op = operation({
    label: "op",
    run: (_deps, { obs }) => {
      obs.event("ping", { n: 1 });
      return 1;
    },
  });
  const spans: Observe.Span[] = [];
  let now = 0;
  const scope = createScope({ observe: { clock: () => ++now, export: (s) => void spans.push(s) } });
  scope.run(op);
  expect(spans.length).toBe(1);
  expect(spans[0].events.map((e) => e.name)).toEqual(["ping"]);
});

test("a manual child span that returns a value closes as ok", () => {
  const op = operation({
    label: "op",
    run: (_deps, { obs }) => obs.child("step", () => 7),
  });
  const spans: Observe.Span[] = [];
  let now = 0;
  const scope = createScope({ observe: { clock: () => ++now, export: (s) => void spans.push(s) } });
  expect(scope.run(op)).toBe(7);
  const step = spans.find((s) => s.name === "step");
  expect(step?.status).toBe("ok");
  expect(step?.parentId).toBe(spans.find((s) => s.name === "op")?.id);
});

test("a manual child span that throws closes as failed and rethrows", () => {
  const boom = new Error("child-boom");
  const op = operation({
    label: "op",
    run: (_deps, { obs }) =>
      obs.child("step", (): number => {
        throw boom;
      }),
  });
  const spans: Observe.Span[] = [];
  let now = 0;
  const scope = createScope({ observe: { clock: () => ++now, export: (s) => void spans.push(s) } });
  let thrown: unknown;
  try {
    scope.run(op);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBe(boom);
  expect(spans.find((s) => s.name === "step")?.status).toBe("failed");
});

test("an async child span closes as ok when its promise resolves", async () => {
  let release!: (v: number) => void;
  const gate = new Promise<number>((resolve) => {
    release = resolve;
  });
  const op = operation({
    label: "op",
    run: (_deps, { obs }) => obs.child("step", () => gate),
  });
  const spans: Observe.Span[] = [];
  let now = 0;
  const scope = createScope({ observe: { clock: () => ++now, export: (s) => void spans.push(s) } });
  const pending = scope.run(op) as Promise<number>;
  release(3);
  expect(await pending).toBe(3);
  await Promise.resolve();
  await Promise.resolve();
  expect(spans.find((s) => s.name === "step")?.status).toBe("ok");
});

test("an async child span closes as failed when its promise rejects", async () => {
  const boom = new Error("async-child-boom");
  const op = operation({
    label: "op",
    run: (_deps, { obs }) => obs.child("step", () => Promise.reject(boom)),
  });
  const spans: Observe.Span[] = [];
  let now = 0;
  const scope = createScope({ observe: { clock: () => ++now, export: (s) => void spans.push(s) } });
  const pending = scope.run(op) as Promise<unknown>;
  await expect(pending).rejects.toBe(boom);
  await Promise.resolve();
  await Promise.resolve();
  expect(spans.find((s) => s.name === "step")?.status).toBe("failed");
});

test("sibling spans carry distinct ids in call order", () => {
  const more: Observe.Span[] = [];
  let now = 0;
  const first = operation({ label: "first", run: () => 1 });
  const second = operation({ label: "second", run: () => 2 });
  const scope = createScope({ observe: { clock: () => ++now, export: (s) => void more.push(s) } });
  scope.run(first);
  scope.run(second);
  expect(more[1].id).toBe(more[0].id + 1);
});

test("a run retains its span in history", () => {
  const op = operation({ label: "op", run: () => 1 });
  const scope = createScope({ observe: { history: 10 } });
  scope.run(op);
  const spans = scope.spans();
  expect(spans.length).toBe(1);
  expect(spans[0].status).toBe("ok");
});
