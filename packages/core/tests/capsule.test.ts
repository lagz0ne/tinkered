import { preset } from "@tinker/core/testing";
import { expect, test } from "vite-plus/test";

import * as core from "@/index";
import {
  capsule,
  createScope,
  data,
  isError,
  namespace,
  operation,
  resource,
  tag,
  type Capsule,
  type Resource,
  type RunResult,
} from "@/index";

/** The error `fn` raised, so a test reads it the way a caller does — narrow, or rethrow. */
const caught = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
};

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const setup = { role: "setup", explain: "Makes the pool ready" } as const;
const handler = { role: "handler", explain: "Runs one MCP tool" } as const;
const state = { role: "state", explain: "Holds spans until flush" } as const;
const worker = { role: "worker", explain: "Waits for a stop" } as const;

const smtpUrl = tag<string>({ label: "mail.smtpUrl" });
const from = tag({ label: "mail.from", default: "noreply@example.com" });

const enqueue = operation({
  label: "mail.enqueue",
  depends: { smtpUrl },
  run: ({ smtpUrl }) => `queued via ${smtpUrl}`,
});

const send = operation({ label: "mail.send", run: () => "sent" });
const outbox = data({ label: "mail.outbox", initial: [] as readonly string[] });

/** A library with config and exports, the way `tinker/components/mail` would ship it. */
const mail = capsule({
  label: "mail",
  config: { smtpUrl, from },
  exports: { enqueue, send, outbox },
});

test("I1 load, run and settle in a hook use that hook's own owner and namespace", async () => {
  const zone = tag({ label: "zone", default: "root" });
  const east = namespace({ tags: zone("east") });
  const perSession = resource({
    label: "per.session",
    target: "session",
    factory: () => ({ made: true }),
  });
  const readZone = operation({ label: "read.zone", depends: { zone }, run: ({ zone }) => zone });
  const request = operation({ label: "request", run: () => "request" });
  const seen: unknown[] = [];
  const probe = capsule({
    label: "probe",
    hooks: {
      run: async ({ op, next, load, run, settle }) => {
        if (op !== request) return next();
        seen.push(await load(perSession, state));
        seen.push(await run(readZone, {}, setup));
        seen.push(await settle(readZone, {}, setup));
        return next();
      },
    },
  });
  const scope = createScope({ capsules: [probe()] });
  await scope.ready;
  const session = scope.createSession({ ns: east });

  expect(await Promise.resolve(session.run(request))).toBe("request");
  expect(seen[0]).toBe(session.resolve(perSession));
  expect(seen[0]).not.toBe(scope.resolve(perSession));
  expect(seen.slice(1)).toEqual(["east", { status: "success", value: "east" }]);
  await scope.close();
});

test("I1b a hook's run is a child span of the hook's own run, in the same trace", async () => {
  const inner = operation({ label: "inner", run: () => "inner" });
  const request = operation({ label: "request", run: () => "request" });
  const probe = capsule({
    label: "probe",
    hooks: {
      run: async ({ op, next, run }) => {
        if (op !== request) return next();
        await run(inner, {}, setup);
        return next();
      },
    },
  });
  const scope = createScope({ capsules: [probe()], observe: { history: 10 } });
  await scope.ready;

  await Promise.resolve(scope.run(request));

  const spans = scope.spans();
  const outer = spans.find((span) => span.name === "request");
  const child = spans.find((span) => span.name === "inner");
  expect(child?.parentId).toBe(outer?.id);
  expect(child?.traceId).toBe(outer?.traceId);
  await scope.close();
});

test("I1c aborting the outer run aborts a run the hook started", async () => {
  const seen: string[] = [];
  const slow = operation({
    label: "slow",
    run: (_deps, { signal }) =>
      new Promise<string>((_done, fail) => {
        signal.addEventListener("abort", () => {
          seen.push("slow aborted");
          fail(signal.reason);
        });
      }),
  });
  const request = operation({ label: "request", run: () => "request" });
  const probe = capsule({
    label: "probe",
    hooks: {
      run: ({ op, next, settle }) => {
        if (op !== request) return next();
        return settle(slow, {}, worker);
      },
    },
  });
  const scope = createScope({ capsules: [probe()] });
  await scope.ready;
  const stop = new AbortController();

  const running = Promise.resolve(scope.settle(request, { signal: stop.signal }));
  stop.abort("stop");

  expect(await running).toEqual({ status: "cancelled", reason: "stop" });
  expect(seen).toEqual(["slow aborted"]);
  await scope.close();
});

test("I1d X1: load(cell) in a session hook gives each session its own controller", async () => {
  const who = data({ label: "who", initial: "nobody" });
  const zone = tag<string>({ label: "zone" });
  const controllers: unknown[] = [];
  const probe = capsule({
    label: "probe",
    hooks: {
      session: ({ handle, load, next }) => {
        const controller = load(who, state);
        controllers.push(controller);
        controller.set(handle.resolve(zone));
        return next();
      },
    },
  });
  const scope = createScope({ capsules: [probe()] });
  await scope.ready;

  const a = scope.createSession({ tags: [zone("a")] });
  const b = scope.createSession({ tags: [zone("b")] });

  expect(controllers).toHaveLength(2);
  expect(controllers[0]).not.toBe(controllers[1]);
  expect([a.resolve(who), b.resolve(who), scope.resolve(who)]).toEqual(["a", "b", "nobody"]);
  await scope.close();
});

test("I2 a second load adds no record line and keeps the first meta", async () => {
  const pool = resource({ label: "db.pool", factory: () => ({ open: true }) });
  const db = capsule({
    label: "db",
    hooks: {
      start: async ({ load }) => {
        await load(pool, { role: "setup", explain: "first" });
        await load(pool, { role: "worker", explain: "second" });
      },
    },
  });
  const scope = createScope({ capsules: [db()] });
  await scope.ready;

  expect(scope.capsules[0]?.loaded).toEqual([{ unit: "db.pool", role: "setup", explain: "first" }]);
  await scope.close();
});

test("I3 a close-hook load reads a built unit until next releases it, then Disposed", async () => {
  const pool = resource({ label: "db.pool", factory: () => ({ open: true }) });
  const reads: unknown[] = [];
  const db = capsule({
    label: "db",
    hooks: {
      start: async ({ load }) => {
        await load(pool, setup);
      },
      close: async ({ load, next }) => {
        reads.push(await load(pool, setup));
        const result = await next();
        reads.push(
          await load(pool, setup).then(
            () => "answered",
            (error: unknown) => (isError(error, "Disposed") ? "Disposed" : error),
          ),
        );
        return result;
      },
    },
  });
  const scope = createScope({ capsules: [db()] });
  await scope.ready;
  const built = scope.resolve(pool);

  expect((await scope.close({ graceful: true })).status).toBe("success");
  expect(reads).toEqual([built, "Disposed"]);
  expect(reads[0]).toBe(built);
});

test("I3b a close-hook load of a unit never built raises Disposed and builds nothing", async () => {
  const built: string[] = [];
  const pool = resource({
    label: "db.pool",
    factory: () => {
      built.push("pool");
      return { open: true };
    },
  });
  const reads: unknown[] = [];
  const db = capsule({
    label: "db",
    hooks: {
      close: async ({ load, next }) => {
        reads.push(await load(pool, setup).catch((error: unknown) => error));
        return next();
      },
    },
  });
  const scope = createScope({ capsules: [db()] });
  await scope.ready;

  await scope.close({ graceful: true });

  if (!isError(reads[0], "Disposed")) throw reads[0];
  expect(built).toEqual([]);
});

test("I4 an exported unit with no capsule raises CapsuleMissing at each first touch", () => {
  const notify = operation({
    label: "notify",
    depends: { send: mail.send },
    run: ({ send }) => send.run(),
  });
  const scope = createScope({});

  const first = caught(() => scope.run(notify));
  const again = caught(() => scope.run(mail.send));

  if (!isError(first, "CapsuleMissing")) throw first;
  if (!isError(again, "CapsuleMissing")) throw again;
  expect(first.payload).toEqual({ unit: "mail.send", capsule: "mail" });
  expect(again.payload).toEqual({ unit: "mail.send", capsule: "mail" });
});

test("I5 start runs in capsules order, close in reverse, and a skipped next still cleans up", async () => {
  const order: string[] = [];
  const pool = resource({
    label: "db.pool",
    factory: (_deps, { defer }) => {
      defer(() => {
        order.push("pool released");
      });
      return { open: true };
    },
  });
  const step = (label: string, skip: boolean) =>
    capsule({
      label,
      hooks: {
        start: async ({ load }) => {
          order.push(`start ${label}`);
          await load(pool, setup);
        },
        close: async ({ next }) => {
          order.push(`close ${label}`);
          if (skip) return { status: "success" };
          return next();
        },
      },
    });
  const scope = createScope({ capsules: [step("a", false), step("b", true)] });
  await scope.ready;

  const end = await scope.close({ graceful: true });

  expect(end.status).toBe("success");
  expect(order).toEqual(["start a", "start b", "close b", "close a", "pool released"]);
});

test("N1 two sessions settle one exported op in a run hook at the same tick, each with its own tags and signal", async () => {
  const caller = tag<string>({ label: "mcp.caller" });
  const gate = deferred();
  const seen: string[] = [];
  const tool = operation({
    label: "mcp.tool",
    depends: { caller },
    run: async ({ caller }, { signal }) => {
      seen.push(caller);
      await new Promise<void>((done, fail) => {
        void gate.promise.then(done);
        signal.addEventListener("abort", () => fail(signal.reason), { once: true });
      });
      seen.push(`${caller} done`);
      return caller;
    },
  });
  const request = operation({ label: "mcp.request", run: () => "unreached" });
  const settled: Promise<RunResult<string>>[] = [];
  const mcp = capsule({
    label: "mcp",
    exports: { tool },
    hooks: {
      run: ({ op, next, settle, signal }) => {
        if (op !== request) return next();
        const result = settle(tool, { signal }, handler);
        settled.push(result);
        return result;
      },
    },
  });
  const scope = createScope({ capsules: [mcp()] });
  await scope.ready;
  const a = scope.createSession({ tags: [caller("a")] });
  const b = scope.createSession({ tags: [caller("b")] });
  const stopA = new AbortController();
  const stopB = new AbortController();

  const runs = Promise.allSettled([
    a.run(request, { signal: stopA.signal }),
    b.run(request, { signal: stopB.signal }),
  ]);
  stopA.abort("stop a");
  gate.resolve();
  await runs;

  expect(await Promise.all(settled)).toEqual([
    { status: "cancelled", reason: "stop a" },
    { status: "success", value: "b" },
  ]);
  expect(stopB.signal.aborted).toBe(false);
  expect(seen).toEqual(["a", "b", "b done"]);
  await scope.close();
});

test("N2 a close hook loads a built resource, calls next, then load raises Disposed", async () => {
  const pool = resource({ label: "db.pool", factory: () => ({ open: true }) });
  const steps: unknown[] = [];
  const db = capsule({
    label: "db",
    hooks: {
      close: async ({ load, next }) => {
        steps.push(await load(pool, setup));
        const result = await next();
        steps.push(result.status);
        steps.push(
          await load(pool, setup).then(
            (value) => value,
            (error: unknown) => (isError(error, "Disposed") ? "Disposed" : error),
          ),
        );
        return result;
      },
    },
  });
  const scope = createScope({ capsules: [db()] });
  await scope.ready;
  const built = scope.resolve(pool);

  await scope.close({ graceful: true });

  expect(steps).toEqual([built, "success", "Disposed"]);
});

test("N3 two runs first-touch an export with no capsule at one tick: both CapsuleMissing, no work", async () => {
  const work: string[] = [];
  const job = operation({
    label: "mail.job",
    run: async () => {
      work.push("job");
      return "done";
    },
  });
  const jobs = capsule({ label: "mail", exports: { job } });
  const scope = createScope({});

  const [one, two] = await Promise.all([
    Promise.resolve(scope.settle(jobs.job)),
    Promise.resolve(scope.settle(jobs.job)),
  ]);

  for (const result of [one, two]) {
    if (result.status !== "failed") throw new Error(`expected failed, got ${result.status}`);
    if (!isError(result.error, "CapsuleMissing")) throw result.error;
    expect(result.error.payload).toEqual({ unit: "mail.job", capsule: "mail" });
  }
  expect(work).toEqual([]);
});

test("A02 a required key filled with undefined: MissingConfig", () => {
  const error = caught(() => createScope({ capsules: [mail({ smtpUrl: undefined })] }));

  if (!isError(error, "MissingConfig")) throw error;
  expect(error.payload).toEqual({ label: "mail", key: "smtpUrl" });
});

test("A03 config.x in a hook has the tag's default filled", async () => {
  const seen: unknown[] = [];
  const mailer = capsule({
    label: "mailer",
    config: { smtpUrl, from },
    hooks: {
      start: ({ config }) => {
        seen.push(config.smtpUrl, config.from);
      },
    },
  });
  const scope = createScope({ capsules: [mailer({ smtpUrl: "smtp://x" })] });
  await scope.ready;

  expect(seen).toEqual(["smtp://x", "noreply@example.com"]);
  await scope.close();
});

test("A05 load(resource) answers its value", async () => {
  const pool = resource({ label: "db.pool", factory: () => ({ open: true }) });
  const seen: unknown[] = [];
  const db = capsule({
    label: "db",
    hooks: {
      start: async ({ load }) => {
        seen.push(await load(pool, setup));
      },
    },
  });
  const scope = createScope({ capsules: [db()] });
  await scope.ready;

  expect(seen).toEqual([{ open: true }]);
  expect(seen[0]).toBe(scope.resolve(pool));
  await scope.close();
});

test("A06 run(op, options, meta) answers what scope.run answers, with one span like it", async () => {
  const add = operation({
    label: "add",
    input: (raw): number => Number(raw),
    run: (_deps, { input }) => input + 1,
  });
  const seen: unknown[] = [];
  const calc = capsule({
    label: "calc",
    hooks: {
      start: async ({ run }) => {
        seen.push(await run(add, { input: 2 }, setup));
      },
    },
  });
  const scope = createScope({ capsules: [calc()], observe: { history: 10 } });
  await scope.ready;
  const hookSpans = scope.spans().map((span) => span.name);

  expect(seen).toEqual([scope.run(add, { input: 2 })]);
  expect(hookSpans).toEqual(["add"]);
  await scope.close();
});

test("A07 MCP shape: two sessions settle one tool through a run hook; each sees its own tags and signal", async () => {
  const caller = tag<string>({ label: "mcp.caller" });
  const signals: AbortSignal[] = [];
  const tool = operation({
    label: "mcp.tool",
    depends: { caller },
    run: ({ caller }, { signal }) => {
      signals.push(signal);
      return caller;
    },
  });
  const request = operation({ label: "mcp.request", run: () => "unreached" });
  const hookSignals: AbortSignal[] = [];
  const mcp = capsule({
    label: "mcp",
    exports: { tool },
    hooks: {
      run: ({ op, next, settle, signal }) => {
        if (op !== request) return next();
        hookSignals.push(signal);
        return settle(tool, { signal }, handler);
      },
    },
  });
  const scope = createScope({ capsules: [mcp()] });
  await scope.ready;
  const a = scope.createSession({ tags: [caller("a")] });
  const b = scope.createSession({ tags: [caller("b")] });

  const [ranA, ranB] = await Promise.all([
    Promise.resolve(a.run(request, { signal: new AbortController().signal })),
    Promise.resolve(b.run(request, { signal: new AbortController().signal })),
  ]);

  expect([ranA, ranB]).toEqual([
    { status: "success", value: "a" },
    { status: "success", value: "b" },
  ]);
  expect(hookSignals).toHaveLength(2);
  expect(hookSignals[0]).not.toBe(hookSignals[1]);
  expect(signals).toHaveLength(2);
  expect(signals[0]).not.toBe(signals[1]);
  await scope.close();
});

test("A08 load twice: one record line, the first meta kept", async () => {
  const queue = data({ label: "telemetry.queue", initial: 0 });
  const telemetry = capsule({
    label: "telemetry",
    hooks: {
      start: ({ load }) => {
        load(queue, state).set(1);
        load(queue, { role: "worker", explain: "later" }).set(2);
      },
    },
  });
  const scope = createScope({ capsules: [telemetry()] });
  await scope.ready;

  expect(scope.resolve(queue)).toBe(2);
  expect(scope.capsules[0]?.loaded).toEqual([
    { unit: "telemetry.queue", role: "state", explain: "Holds spans until flush" },
  ]);
  await scope.close();
});

test("A09 a close hook loads a built resource before next; after release, Disposed", async () => {
  const queue = resource({ label: "thread.queue", factory: () => ({ spans: [] as string[] }) });
  const seen: unknown[] = [];
  const thread = capsule({
    label: "thread",
    hooks: {
      start: async ({ load }) => {
        await load(queue, state);
      },
      close: async ({ load, next }) => {
        seen.push(await load(queue, state));
        const result = await next();
        seen.push(await load(queue, state).catch((error: unknown) => error));
        return result;
      },
    },
  });
  const scope = createScope({ capsules: [thread()] });
  await scope.ready;
  const built = scope.resolve(queue);

  await scope.close();

  expect(seen[0]).toBe(built);
  if (!isError(seen[1], "Disposed")) throw seen[1];
});

test("A10 a secret: true tag hides its whole value in the record", async () => {
  const login = tag<{ user: string; pass: string }>({ label: "db.login", secret: true });
  const host = tag<string>({ label: "db.host" });
  const pool = resource({ label: "db.pool", factory: () => ({ open: true }) });
  const store = tag<Resource.Handle<{ open: boolean }>>({ label: "db.store" });
  const db = capsule({ label: "db", config: { login, host, store } });
  const scope = createScope({
    capsules: [db({ login: { user: "u", pass: "p" }, host: "localhost", store: pool })],
  });

  expect(scope.capsules[0]?.config).toEqual({
    login: "[hidden]",
    host: "localhost",
    store: "db.pool",
  });
  await scope.close();
});

test("A11 mail.enqueue === enqueue, on the handle and on the binding", () => {
  expect(mail.enqueue).toBe(enqueue);
  expect(mail({ smtpUrl: "smtp://x" }).enqueue).toBe(enqueue);
  expect(mail({ smtpUrl: "smtp://x" }).outbox).toBe(outbox);
});

test("A12 an export named label raises ReservedExport", () => {
  const exports: Capsule.Exports = { label: send };

  const error = caught(() => capsule({ label: "bad", exports }));

  if (!isError(error, "ReservedExport")) throw error;
  expect(error.payload).toEqual({ label: "bad", key: "label" });
});

test("A13 a span of an exported unit carries capsule", async () => {
  const scope = createScope({
    capsules: [mail({ smtpUrl: "smtp://x" })],
    observe: { history: 10 },
  });
  await scope.ready;

  scope.run(mail.send);

  expect(scope.spans().map((span) => [span.name, span.attributes.capsule])).toEqual([
    ["mail.send", "mail"],
  ]);
  await scope.close();
});

test("A15 a preset on a loaded unit wins", async () => {
  const pool = resource({ label: "db.pool", factory: () => ({ real: true }) });
  const seen: unknown[] = [];
  const db = capsule({
    label: "db",
    hooks: {
      start: async ({ load }) => {
        seen.push(await load(pool, setup));
      },
    },
  });
  const scope = createScope({
    capsules: [db()],
    presets: [preset(pool, () => ({ real: false }))],
  });
  await scope.ready;

  expect(seen).toEqual([{ real: false }]);
  await scope.close();
});

test("A16 a scope without mail runs an op on mail.enqueue: CapsuleMissing before any work", () => {
  const work: string[] = [];
  const notify = operation({
    label: "notify",
    depends: { enqueue: mail.enqueue },
    run: ({ enqueue }) => {
      work.push("notify");
      return enqueue.run();
    },
  });
  const scope = createScope({});

  const error = caught(() => scope.run(notify));

  if (!isError(error, "CapsuleMissing")) throw error;
  expect(error.payload).toEqual({ unit: "mail.enqueue", capsule: "mail" });
  expect(work).toEqual([]);
});

test("A17 with mail installed the same op runs, and runs again", async () => {
  const notify = operation({
    label: "notify",
    depends: { enqueue: mail.enqueue },
    run: ({ enqueue }) => enqueue.run(),
  });
  const scope = createScope({ capsules: [mail({ smtpUrl: "smtp://x" })] });
  await scope.ready;

  expect(scope.run(notify)).toBe("queued via smtp://x");
  expect(scope.run(notify)).toBe("queued via smtp://x");
  await scope.close();
});

test("A18 Core has no extension export", () => {
  expect("extension" in core).toBe(false);
  expect(typeof core.capsule).toBe("function");
});

test("A19 a hook-only capsule runs its session hook and has an empty record", async () => {
  const seen: string[] = [];
  const router = capsule({
    label: "router",
    hooks: {
      session: ({ next }) => {
        seen.push("session");
        return next();
      },
    },
  });
  const scope = createScope({ capsules: [router()] });
  await scope.ready;

  await scope.session(() => "inside");

  expect(seen).toEqual(["session"]);
  expect(scope.capsules).toEqual([
    { label: "router", config: {}, tags: {}, exports: [], loaded: [] },
  ]);
  await scope.close();
});

test("A20 start hooks run in capsules order; close hooks in reverse", async () => {
  const order: string[] = [];
  const step = (label: string) =>
    capsule({
      label,
      hooks: {
        start: () => {
          order.push(`start ${label}`);
        },
        close: ({ next }) => {
          order.push(`close ${label}`);
          return next();
        },
      },
    });
  const scope = createScope({ capsules: [step("a"), step("b"), step("c")] });
  await scope.ready;

  await scope.close();

  expect(order).toEqual(["start a", "start b", "start c", "close c", "close b", "close a"]);
});

test("the record exists before start with config and exports, and is live", async () => {
  const gate = deferred();
  const queue = data({ label: "mail.queue", initial: 0 });
  const mailer = capsule({
    label: "mailer",
    config: { smtpUrl, from },
    exports: { send },
    hooks: {
      start: async ({ load }) => {
        await gate.promise;
        load(queue, state);
      },
    },
  });
  const scope = createScope({ capsules: [mailer({ smtpUrl: "smtp://x" })] });

  expect(scope.capsules).toEqual([
    {
      label: "mailer",
      config: { smtpUrl: "smtp://x", from: "noreply@example.com" },
      tags: {},
      exports: ["send"],
      loaded: [],
    },
  ]);
  gate.resolve();
  await scope.ready;
  expect(scope.capsules[0]?.loaded).toEqual([
    { unit: "mail.queue", role: "state", explain: "Holds spans until flush" },
  ]);
  await scope.close();
});

test("Q7a a binding is a depends entry that delivers its start value", async () => {
  const db = capsule({ label: "db", hooks: { start: () => ({ url: "sqlite://" }) } });
  const read = operation({ label: "read", depends: { db }, run: ({ db }) => db.url });
  const scope = createScope({ capsules: [db()] });
  await scope.ready;

  expect(scope.run(read)).toBe("sqlite://");
  await scope.close();
});

test("Q7b scope.resolve answers a binding's start value, through the binding or its handle", async () => {
  const db = capsule({ label: "db", hooks: { start: () => ({ url: "sqlite://" }) } });
  const installed = db();
  const scope = createScope({ capsules: [installed] });
  await scope.ready;

  expect(scope.resolve(installed)).toEqual({ url: "sqlite://" });
  expect(scope.resolve(db)).toEqual({ url: "sqlite://" });
  await scope.close();
});

test("A21 an exported tag is bound per call by the capsule; each session reads its own", async () => {
  const request = tag<string>({ label: "http.request" });
  const handler = operation({
    label: "http.handler",
    depends: { request },
    run: async ({ request }) => {
      await Promise.resolve();
      return `served ${request}`;
    },
  });
  const serve = operation({
    label: "http.serve",
    input: (raw): string => String(raw),
    run: () => "unreached",
  });
  const http = capsule({
    label: "http",
    exports: { request, handler },
    hooks: {
      run: ({ op, call, next, run }) => {
        if (op !== serve) return next();
        return run(handler, { tags: [request(String(call?.input))] }, serving);
      },
    },
  });
  const serving = { role: "handler", explain: "Serves one request" } as const;
  const scope = createScope({ capsules: [http()] });
  await scope.ready;
  const a = scope.createSession();
  const b = scope.createSession();

  const served = await Promise.all([
    Promise.resolve(a.run(serve, { input: "/a" })),
    Promise.resolve(b.run(serve, { input: "/b" })),
  ]);

  expect(http.request).toBe(request);
  expect(http().request).toBe(request);
  expect(served).toEqual(["served /a", "served /b"]);
  expect(scope.capsules[0]?.exports).toEqual(["request", "handler"]);
  const unbound = caught(() =>
    scope.run(operation({ label: "read", depends: { request }, run: ({ request }) => request })),
  );
  if (!isError(unbound, "MissingTag")) throw unbound;
  expect(unbound.payload).toEqual({ label: "http.request" });
  await scope.close();
});

test("A22 a hook run in an unobserved namespace leaves no span or log for the tap", async () => {
  const quiet = namespace({ observe: false });
  const spans: string[] = [];
  const logs: string[] = [];
  const flush = operation({
    label: "telemetry.flush",
    run: (_deps, { log }) => {
      log("flushed");
      return "flushed";
    },
  });
  const flushes: Promise<unknown>[] = [];
  const telemetry = capsule({
    label: "telemetry",
    hooks: {
      start: ({ tap, run }) => {
        tap({
          export: (span) => void spans.push(span.name),
          log: (line) => void logs.push(line.message),
        });
        flushes.push(run(flush, { ns: quiet }, worker));
      },
    },
  });
  const scope = createScope({ capsules: [telemetry()] });
  await scope.ready;
  expect(await Promise.all(flushes)).toEqual(["flushed"]);
  expect([spans, logs]).toEqual([[], []]);

  scope.run(flush);

  expect([spans, logs]).toEqual([["telemetry.flush"], ["flushed", "telemetry.flush"]]);
  await scope.close();
});

for (const [kind, make] of [
  ["a redirect-like object", () => ({ isRedirect: true, to: "/x" })],
  ["a Response", () => new Response(null, { status: 302 })],
] as const) {
  test(`A23 ${kind} thrown by an op is settled and rethrown as the same object, on scope and hook`, async () => {
    const thrown = make();
    const jump = operation({
      label: "jump",
      run: () => {
        throw thrown;
      },
    });
    const request = operation({ label: "request", run: () => "request" });
    const hooked: unknown[] = [];
    const router = capsule({
      label: "router",
      hooks: {
        run: async ({ op, next, run, settle }) => {
          if (op !== request) return next();
          hooked.push(await settle(jump, {}, handler));
          hooked.push(await run(jump, {}, handler).catch((error: unknown) => error));
          return next();
        },
      },
    });
    const plain = createScope();
    const scope = createScope({ capsules: [router()] });
    await scope.ready;

    const settled = plain.settle(jump);
    const rethrown = caught(() => plain.run(jump));
    await Promise.resolve(scope.run(request));

    if (settled.status !== "failed") throw new Error(`expected failed, got ${settled.status}`);
    expect(settled.error).toBe(thrown);
    expect(rethrown).toBe(thrown);
    const [hookSettled, hookRethrown] = hooked;
    expect(hookSettled).toMatchObject({ status: "failed" });
    expect((hookSettled as { error: unknown }).error).toBe(thrown);
    expect(hookRethrown).toBe(thrown);
    await plain.close();
    await scope.close();
  });
}

test("I3c a close-hook load once next() is called raises Disposed, while the close still drains", async () => {
  const gate = deferred();
  const pool = resource({ label: "db.pool", factory: () => ({ open: true }) });
  const slow = operation({ label: "slow", depends: { pool }, run: () => gate.promise });
  const reads: unknown[] = [];
  const db = capsule({
    label: "db",
    hooks: {
      close: async ({ load, next }) => {
        const ending = next();
        reads.push(await load(pool, setup).catch((error: unknown) => error));
        gate.resolve();
        return ending;
      },
    },
  });
  const scope = createScope({ capsules: [db()] });
  await scope.ready;
  const running = Promise.resolve(scope.run(slow));

  await scope.close({ graceful: true });
  await running;

  if (!isError(reads[0], "Disposed")) throw reads[0];
});

test("I3d on a root with an ambient ns, a close hook loads a namespace resource and a cell until next(), then Disposed", async () => {
  const space = namespace();
  const queue = resource({ label: "tel.queue", target: "namespace", factory: () => ({ q: 1 }) });
  const count = data({ label: "tel.count", initial: 0 });
  const reads: unknown[] = [];
  const outcome = (read: () => unknown): Promise<unknown> =>
    Promise.resolve()
      .then(read)
      .catch((error: unknown) => (isError(error, "Disposed") ? "Disposed" : error));
  const tel = capsule({
    label: "tel",
    hooks: {
      start: async ({ load }) => {
        await load(queue, state);
        load(count, state).set(3);
      },
      close: async ({ load, next }) => {
        reads.push(await load(queue, state));
        reads.push(load(count, state).get());

        const result = await next();
        reads.push(await outcome(() => load(queue, state)));
        reads.push(await outcome(() => load(count, state).get()));
        return result;
      },
    },
  });
  const scope = createScope({ ns: [space], capsules: [tel] });
  await scope.ready;
  const built = scope.resolve(queue);

  await scope.close({ graceful: true });

  expect(reads).toEqual([built, 3, "Disposed", "Disposed"]);
  expect(reads[0]).toBe(built);
});

test("I2b load, run and settle each write their record line when called, even when the call fails", async () => {
  const broken = resource({
    label: "db.broken",
    factory: () => {
      throw new Error("no pool");
    },
  });
  const boom = operation({
    label: "db.boom",
    run: () => {
      throw new Error("boom");
    },
  });
  const flop = operation({
    label: "db.flop",
    run: () => {
      throw new Error("flop");
    },
  });
  const failures: unknown[] = [];
  const db = capsule({
    label: "db",
    hooks: {
      start: async ({ load, run, settle }) => {
        failures.push(await load(broken, setup).catch((error: unknown) => String(error)));
        failures.push(await run(boom, {}, setup).catch((error: unknown) => String(error)));
        failures.push((await settle(flop, {}, setup)).status);
      },
    },
  });
  const scope = createScope({ capsules: [db()] });
  await scope.ready;

  expect(failures).toEqual(["Error: no pool", "Error: boom", "failed"]);
  expect(scope.capsules[0]?.loaded.map(({ unit }) => unit)).toEqual([
    "db.broken",
    "db.boom",
    "db.flop",
  ]);
  await scope.close();
});

test("A16b a scope without mail runs an inline op on a mail export: CapsuleMissing, no body", () => {
  const work: string[] = [];
  const scope = createScope({});

  const onOp = caught(() =>
    scope.run({
      depends: { e: mail.enqueue },
      run: () => work.push("enqueue body"),
    }),
  );
  const onCell = caught(() =>
    scope.run({
      depends: { o: mail.outbox },
      run: () => work.push("outbox body"),
    }),
  );

  if (!isError(onOp, "CapsuleMissing")) throw onOp;
  if (!isError(onCell, "CapsuleMissing")) throw onCell;
  expect(onOp.payload).toEqual({ unit: "mail.enqueue", capsule: "mail" });
  expect(onCell.payload).toEqual({ unit: "mail.outbox", capsule: "mail" });
  expect(work).toEqual([]);
});

/** A sink capsule's own units, for A24: a queue it loads and a flush it runs, in start. The
 * queue keeps its state in the sink's own namespace (ADR 0119), so the quiet one is not seen. */
function sinkCapsule(quiet: boolean) {
  const space = namespace({ observe: false });
  const queue = resource({
    label: "sink.queue",
    target: "namespace",
    factory: () => ({ held: [] as string[] }),
  });
  const flush = operation({
    label: "sink.flush",
    depends: { queue },
    run: ({ queue }, { log }) => {
      log("flushed");
      return queue.held.length;
    },
  });

  const seen: string[] = [];
  const options = quiet ? { ns: space } : {};
  const sink = capsule({
    label: "sink",
    hooks: {
      start: async ({ tap, load, run }) => {
        tap({
          export: (span) => void seen.push(`span ${span.name}`),
          log: (line) => void seen.push(`log ${line.message}`),
        });
        await load(queue, state, options);
        await run(flush, options, worker);
      },
    },
  });

  return { sink, seen };
}

test("A24a a quiet load and run in start leave no span or log for the tap", async () => {
  const { sink, seen } = sinkCapsule(true);
  const scope = createScope({ capsules: [sink()] });
  await scope.ready;

  expect(seen).toEqual([]);
  await scope.close();
});

test("A24b the same load and run without the option are seen as before", async () => {
  const { sink, seen } = sinkCapsule(false);
  const scope = createScope({ capsules: [sink()] });
  await scope.ready;

  expect(seen).toEqual(["span sink.queue", "log flushed", "span sink.flush", "log sink.flush"]);
  await scope.close();
});

test("A24c a quiet load still writes its record line", async () => {
  const { sink } = sinkCapsule(true);
  const scope = createScope({ capsules: [sink()] });
  await scope.ready;

  expect(scope.capsules[0]?.loaded).toEqual([
    { unit: "sink.queue", role: "state", explain: "Holds spans until flush" },
    { unit: "sink.flush", role: "worker", explain: "Waits for a stop" },
  ]);
  await scope.close();
});

test("A25a a capsule's fixed tags bind on the root, so a unit reads them with nothing from the cmd", async () => {
  const side = tag<"server" | "browser">({ label: "telemetry.side" });
  const key = tag<string>({ label: "telemetry.key", secret: true });
  const readSide = operation({
    label: "telemetry.readSide",
    depends: { side },
    run: ({ side }) => side,
  });
  const telemetry = {
    server: capsule({ label: "telemetry", tags: [side("server"), key("k-123")] }),
  };
  const scope = createScope({ capsules: [telemetry.server()] });
  await scope.ready;

  expect(scope.run(readSide)).toBe("server");
  expect(scope.capsules[0]?.tags).toEqual({
    "telemetry.side": "server",
    "telemetry.key": "[hidden]",
  });
  await scope.close();
});

/** Today's rule for one tag bound twice in one root list (index.test.ts "all returns every
 * binding nearest-first"): the last binding wins. Capsule tags sit in install order, before the
 * cmd's own `tags`. */
test("A25b a tag bound twice follows the root list rule: the later capsule, then the cmd, wins", async () => {
  const side = tag<string>({ label: "telemetry.side" });
  const readSide = operation({ label: "read", depends: { side }, run: ({ side }) => side });
  const readAll = operation({
    label: "readAll",
    depends: { all: side.all },
    run: ({ all }) => all,
  });
  const first = capsule({ label: "first", tags: [side("first")] });
  const second = capsule({ label: "second", tags: [side("second")] });

  const two = createScope({ capsules: [first(), second()] });
  const withCmd = createScope({ capsules: [first(), second()], tags: [side("cmd")] });
  await Promise.all([two.ready, withCmd.ready]);

  expect(two.run(readSide)).toBe("second");
  expect(two.run(readAll)).toEqual(["second", "first"]);
  expect(withCmd.run(readSide)).toBe("cmd");
  expect(withCmd.run(readAll)).toEqual(["cmd", "second", "first"]);
  await Promise.all([two.close(), withCmd.close()]);
});

test("A25c an export named tags raises ReservedExport", () => {
  const exports: Capsule.Exports = { tags: send };

  const error = caught(() => capsule({ label: "bad", exports }));

  if (!isError(error, "ReservedExport")) throw error;
  expect(error.payload).toEqual({ label: "bad", key: "tags" });
});
