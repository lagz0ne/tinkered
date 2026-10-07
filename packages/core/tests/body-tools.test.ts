import { expect, test } from "vite-plus/test";
import { createScope, LEVELS, operation, originOf, resource, type Observe } from "../src/index";

test("a destructured operation logger stays the same and sends every level in order", () => {
  const records: Observe.Log[] = [];
  let now = 0;
  const scope = createScope({
    observe: { history: 1, clock: () => now++, log: (record) => void records.push(record) },
  });
  const op = operation({
    label: "logged",
    run: (_deps, ctx) => {
      const { log } = ctx;
      expect(ctx.log).toBe(log);
      log("body", { n: 1 });
      log.debug("debug");
      log.info("info");
      log.warn("warn");
      log.error("error");
    },
  });
  scope.run(op);
  const span = scope.spans()[0];
  expect(records).toEqual([
    { time: 1, level: LEVELS.info, message: "body", attributes: { n: 1 }, span },
    { time: 2, level: LEVELS.debug, message: "debug", attributes: {}, span },
    { time: 3, level: LEVELS.info, message: "info", attributes: {}, span },
    { time: 4, level: LEVELS.warn, message: "warn", attributes: {}, span },
    { time: 5, level: LEVELS.error, message: "error", attributes: {}, span },
    {
      time: 6,
      level: LEVELS.debug,
      message: "logged",
      attributes: { ms: 6, outcome: "ok" },
      span,
    },
  ]);
});

test("a destructured resource logger stays the same and keeps the level threshold", () => {
  const records: Observe.Log[] = [];
  const scope = createScope({
    observe: {
      history: 1,
      clock: () => 10,
      level: LEVELS.warn,
      log: (record) => void records.push(record),
    },
  });
  const res = resource({
    label: "logged",
    factory: (_deps, ctx) => {
      const { log } = ctx;
      expect(ctx.log).toBe(log);
      log("body");
      log.debug("debug");
      log.info("info");
      log.warn("warn", { n: 1 });
      log.error("error");
      return 7;
    },
  });
  scope.controller(res).resolve();
  const span = scope.spans()[0];
  expect(records).toEqual([
    { time: 10, level: LEVELS.warn, message: "warn", attributes: { n: 1 }, span },
    { time: 10, level: LEVELS.error, message: "error", attributes: {}, span },
  ]);
});

test("a resource keeps its observation tools and exports manual events and children", () => {
  const scope = createScope({ observe: { history: 2, clock: () => 10 } });
  const res = resource({
    label: "observed",
    factory: (_deps, ctx) => {
      const { obs } = ctx;
      expect(ctx.obs).toBe(obs);
      obs.event("ready", { n: 1 });
      return obs.child("child", () => 7);
    },
  });
  expect(scope.controller(res).resolve()).toBe(7);
  const spans = scope.spans();
  expect(
    spans.map((span) => ({ name: span.name, status: span.status, events: span.events })),
  ).toEqual([
    { name: "child", status: "ok", events: [] },
    {
      name: "observed",
      status: "ok",
      events: [{ name: "ready", time: 10, attributes: { n: 1 } }],
    },
  ]);
  expect(spans[0].parentId).toBe(spans[1].id);
});

test("a caught operation raise carries its span before the body reads observation tools", () => {
  const scope = createScope({ observe: { history: 1 } });
  const op = operation({
    label: "caught",
    run: (_deps, { raise }) => {
      try {
        raise("Missing", { id: 7 });
      } catch (error) {
        return originOf(error);
      }
    },
  });
  const origin = scope.run(op);
  expect(origin).toEqual({ label: "caught", span: scope.spans()[0].id, path: ["caught"] });
});

test("a caught resource raise carries its span before the factory reads observation tools", () => {
  const scope = createScope({ observe: { history: 1 } });
  const res = resource({
    label: "caught",
    factory: (_deps, { raise }) => {
      try {
        raise("Missing", { id: 7 });
      } catch (error) {
        return originOf(error);
      }
    },
  });
  const origin = scope.controller(res).resolve();
  expect(origin).toEqual({ label: "caught", span: scope.spans()[0].id, path: ["caught"] });
});
