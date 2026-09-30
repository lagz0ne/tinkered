import { describe, expect, it, test } from "vite-plus/test";
import { createScope, extension, LEVELS, type Observe, type Scope } from "../src/index.ts";

function startWith(
  form: "callback" | "object",
  config: { label: string; start: NonNullable<Scope.Extension["start"]> },
) {
  return extension(
    form === "callback"
      ? config
      : {
          label: config.label,
          hooks: { start: (event) => config.start(event.scope, event, event.next) },
        },
  );
}

describe.each(["callback", "object"] as const)("%s extension start", (form) => {
  it("extension start logs before and after next reach the scope sink without a span", async () => {
    const lines: Observe.Log[] = [];
    const scope = createScope({
      observe: { history: 1, clock: () => 10, log: (line) => void lines.push(line) },
      extensions: [
        startWith(form, {
          label: "outer",
          start: async (_scope, ctx, next) => {
            ctx.log("before", { port: 3000, label: "mine", extension: "caller" });
            await next();
            ctx.log("after");
          },
        }),
        startWith(form, {
          label: "inner",
          start: (_scope, ctx, next) => {
            ctx.log("inside");
            return next();
          },
        }),
      ],
    });
    await scope.ready;
    await scope.close();
    expect(lines).toEqual([
      {
        time: 10,
        level: LEVELS.info,
        message: "before",
        attributes: { port: 3000, label: "mine", extension: "outer" },
        span: undefined,
      },
      {
        time: 10,
        level: LEVELS.info,
        message: "inside",
        attributes: { extension: "inner" },
        span: undefined,
      },
      {
        time: 10,
        level: LEVELS.info,
        message: "after",
        attributes: { extension: "outer" },
        span: undefined,
      },
    ]);
    expect(scope.spans()).toEqual([]);
  });

  it("a destructured extension start logger sends every level without span observation", async () => {
    const lines: Observe.Log[] = [];
    const scope = createScope({
      observe: { clock: () => 7, log: (line) => void lines.push(line) },
      extensions: [
        startWith(form, {
          label: "boot",
          start: (_scope, ctx, next) => {
            const { log } = ctx;
            expect(ctx.log).toBe(log);
            log("plain");
            log.debug("debug");
            log.info("info");
            log.warn("warn");
            log.error("error");
            return next();
          },
        }),
      ],
    });
    await scope.ready;
    await scope.close();
    expect(lines).toEqual(
      [
        { message: "plain", level: LEVELS.info },
        { message: "debug", level: LEVELS.debug },
        { message: "info", level: LEVELS.info },
        { message: "warn", level: LEVELS.warn },
        { message: "error", level: LEVELS.error },
      ].map((line) => ({ ...line, time: 7, attributes: { extension: "boot" }, span: undefined })),
    );
  });

  it("an info threshold drops extension start debug lines before reading the clock", async () => {
    const lines: Observe.Log[] = [];
    let reads = 0;
    const scope = createScope({
      observe: {
        level: LEVELS.info,
        clock: () => reads++,
        log: (line) => void lines.push(line),
      },
      extensions: [
        startWith(form, {
          label: "boot",
          start: (_scope, ctx, next) => {
            ctx.log.debug("dropped");
            ctx.log.info("kept");
            return next();
          },
        }),
      ],
    });
    await scope.ready;
    await scope.close();
    expect(lines).toEqual([
      {
        time: 0,
        level: LEVELS.info,
        message: "kept",
        attributes: { extension: "boot" },
        span: undefined,
      },
    ]);
    expect(reads).toBe(1);
  });

  it("extension start logging without a sink reads no clock or attributes", async () => {
    let reads = 0;
    const attributes = {
      get detail() {
        reads++;
        return "unused";
      },
    };
    const boot = startWith(form, {
      label: "boot",
      start: (_scope, ctx, next) => {
        ctx.log("plain", attributes);
        ctx.log.debug("debug", attributes);
        ctx.log.info("info", attributes);
        ctx.log.warn("warn", attributes);
        ctx.log.error("error", attributes);
        return next();
      },
    });
    for (const observe of [undefined, { history: 1, clock: () => reads++ }]) {
      const scope = createScope({ observe, extensions: [boot] });
      await scope.ready;
      await scope.close();
    }
    expect(reads).toBe(0);
  });

  it("a failed extension start delivers the log before its throw", async () => {
    const lines: string[] = [];
    const failure = new Error("boot failed");
    const scope = createScope({
      observe: { log: (line) => void lines.push(line.message) },
      extensions: [
        startWith(form, {
          label: "boot",
          start: (_scope, ctx) => {
            ctx.log.error("failed to boot");
            throw failure;
          },
        }),
      ],
    });
    await expect(scope.ready).rejects.toBe(failure);
    expect(lines).toEqual(["failed to boot"]);
  });

  it("a throwing extension start log sink does not fail ready", async () => {
    const scope = createScope({
      observe: {
        log: () => {
          throw new Error("sink failed");
        },
      },
      extensions: [
        startWith(form, {
          label: "boot",
          start: async (_scope, ctx, next) => {
            ctx.log("before");
            await next();
            ctx.log("after");
          },
        }),
      ],
    });
    await expect(scope.ready).resolves.toBeUndefined();
    await scope.close();
  });
});

test("an object close hook logs before and after next with the scope filter and clock", async () => {
  const lines: Observe.Log[] = [];
  const scope = createScope({
    observe: { level: LEVELS.warn, clock: () => 12, log: (line) => void lines.push(line) },
    extensions: [
      extension({
        label: "shutdown",
        hooks: {
          async close(event) {
            event.log.info("dropped");
            event.log.warn("before");
            const result = await event.next();
            event.log.error("after");
            return result;
          },
        },
      }),
    ],
  });
  await scope.ready;
  await scope.close();
  expect(lines).toEqual([
    {
      time: 12,
      level: LEVELS.warn,
      message: "before",
      attributes: { extension: "shutdown" },
      span: undefined,
    },
    {
      time: 12,
      level: LEVELS.error,
      message: "after",
      attributes: { extension: "shutdown" },
      span: undefined,
    },
  ]);
});
