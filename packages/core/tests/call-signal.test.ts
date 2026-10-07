import { makeTestClock } from "@tinker/core/testing";
import { expect, expectTypeOf, test } from "vite-plus/test";
import {
  createScope,
  data,
  extension,
  namespace,
  operation,
  resource,
  tag,
  type RunResult,
} from "../src/index";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("an already aborted call starts no body and leaves its caller alive", async () => {
  const stop = new AbortController();
  const reason = new Error("steer");
  stop.abort(reason);
  const events: string[] = [];
  const value = resource({ label: "value", factory: () => events.push("resource") });
  const work = operation({
    label: "work",
    input: (raw: unknown) => {
      events.push("parse");
      return String(raw);
    },
    depends: { value },
    run: () => events.push("body"),
  });
  const scope = createScope({
    extensions: [
      extension({
        label: "calls",
        hooks: {
          run: (event) => {
            events.push("hook");
            return event.next();
          },
        },
      }),
    ],
  });
  expect(await scope.settle(work, { rawInput: "start", signal: stop.signal })).toEqual({
    status: "cancelled",
    reason,
  });
  expect(events).toEqual([]);
  expect(await scope.close({ graceful: true })).toMatchObject({ status: "success" });
});

test("a call signal stops a nested wait before the retry clock advances", async () => {
  const stop = new AbortController();
  const reason = new Error("new instruction");
  const clock = makeTestClock();
  const events: string[] = [];
  const request = operation({
    label: "request",
    run: async (_deps, ctx) => {
      await ctx.clock.sleep(100, ctx.signal);
      events.push("retried");
    },
  });
  const step = operation({
    label: "step",
    depends: { request },
    run: ({ request }) => request.run(),
  });
  const scope = createScope({ clock });
  const running = scope.controller(step).settle({ signal: stop.signal });
  stop.abort(reason);
  expect(events).toEqual([]);
  expect(await running).toEqual({ status: "cancelled", reason });
  clock.advance(100);
  expect(events).toEqual([]);
  expect(await scope.close({ graceful: true })).toMatchObject({ status: "success" });
});

test("a cancelled call waits for its cleanup before it settles", async () => {
  const stop = new AbortController();
  const reason = new Error("stop");
  const release = deferred();
  const cleaning = deferred();
  const body = deferred();
  const events: string[] = [];
  const work = operation({
    label: "work",
    run: async (_deps, ctx) => {
      ctx.defer(async () => {
        cleaning.resolve();
        await release.promise;
        events.push("cleaned");
      });
      await body.promise;
      ctx.signal.throwIfAborted();
    },
  });
  const scope = createScope();
  const running = Promise.resolve(scope.settle(work, { signal: stop.signal })).then((end) => {
    events.push(end.status);
    return end;
  });
  stop.abort(reason);
  body.resolve();
  await cleaning.promise;
  expect(events).toEqual([]);
  release.resolve();
  expect(await running).toEqual({ status: "cancelled", reason });
  expect(events).toEqual(["cleaned", "cancelled"]);
  expect(await scope.close({ graceful: true })).toMatchObject({ status: "success" });
});

test("a distinct error after call cancellation remains a handled failure", async () => {
  const stop = new AbortController();
  const body = deferred();
  const error = new Error("request failed");
  const work = operation({
    label: "work",
    run: async () => {
      await body.promise;
      throw error;
    },
  });
  const scope = createScope();
  const running = scope.settle(work, { signal: stop.signal });
  stop.abort(new Error("steer"));
  body.resolve();
  expect(await running).toMatchObject({ status: "failed", error });
  expect(await scope.close({ graceful: true })).toMatchObject({ status: "success" });
});

test("a call signal gives sync inline work its own data and session resource lifetime", async () => {
  const stop = new AbortController();
  const count = data({ initial: 1 });
  const events: string[] = [];
  const local = resource({
    label: "local",
    target: "session",
    factory: (_deps, ctx) => {
      ctx.defer(() => {
        events.push("closed");
      });
      return {};
    },
  });
  const scope = createScope();
  const parentValue = scope.resolve(local);
  const running = scope.settle(
    {
      depends: { count: count.controller, local },
      run: ({ count, local }) => {
        count.set(2);
        return local;
      },
    },
    { signal: stop.signal },
  );
  expectTypeOf(running).toEqualTypeOf<RunResult<{}> | Promise<RunResult<{}>>>();
  const result = await running;
  if (result.status !== "success") throw result;
  expect(result.value).not.toBe(parentValue);
  expect(scope.resolve(count)).toBe(1);
  expect(events).toEqual(["closed"]);
  stop.abort();
  expect(scope.run({ run: () => scope.resolve(local) })).toBe(parentValue);
  await scope.close();
});

test("a signalled call keeps input parsing, tags, and its namespace", async () => {
  const stop = new AbortController();
  const service = tag<string>({ label: "service" });
  const token = tag<string>({ label: "token" });
  const ns = namespace({ tags: [service("cloudflare")] });
  const work = operation({
    label: "request",
    input: (value: unknown) => String(value).toUpperCase(),
    depends: { service, token },
    run: ({ service, token }, { input }) => `${service}/${token}/${input}`,
  });
  const scope = createScope();
  const result = scope.controller(work).run({
    rawInput: "zones",
    signal: stop.signal,
    ns,
    tags: [token("secret")],
  });
  expectTypeOf(result).toEqualTypeOf<string | Promise<string>>();
  expect(await result).toBe("cloudflare/secret/ZONES");
  expect(
    await scope.run(work, {
      input: "users",
      signal: stop.signal,
      ns,
      tags: [token("secret")],
    }),
  ).toBe("cloudflare/secret/users");
  await scope.close();
});

test("a synchronous body sees call cancellation with the exact reason", async () => {
  const stop = new AbortController();
  const reason = { instruction: "stop" };
  const work = operation({
    label: "work",
    run: (_deps, ctx) => {
      stop.abort(reason);
      ctx.signal.throwIfAborted();
    },
  });
  const scope = createScope();
  await expect(scope.controller(work).run({ signal: stop.signal })).rejects.toBe(reason);
  expect(await scope.close({ graceful: true })).toMatchObject({ status: "success" });
});

test("abort during tag-list setup cannot slip past call cancellation", async () => {
  const stop = new AbortController();
  const reason = new Error("stop during setup");
  const zone = tag<string>({ label: "zone" });
  const tags = Object.assign([zone("west")], {
    *[Symbol.iterator]() {
      stop.abort(reason);
      yield zone("west");
    },
  });
  const events: string[] = [];
  const scope = createScope();
  const result = await scope.settle(
    { run: () => events.push("body") },
    {
      tags,
      signal: stop.signal,
    },
  );
  expect(result).toEqual({ status: "cancelled", reason });
  expect(events).toEqual([]);
  expect(await scope.close({ graceful: true })).toMatchObject({ status: "success" });
});

test("graceful owner close still permits cancellation of an active call", async () => {
  const stop = new AbortController();
  const reason = new Error("steer during shutdown");
  const clock = makeTestClock();
  const scope = createScope({ clock });
  const work = operation({
    label: "work",
    run: (_deps, ctx) => ctx.clock.sleep(100, ctx.signal),
  });
  const running = scope.settle(work, { signal: stop.signal });
  const closing = scope.close({ graceful: true });
  stop.abort(reason);
  expect(await running).toEqual({ status: "cancelled", reason });
  expect(await closing).toMatchObject({ status: "success" });
});

test("forced owner close cancels a call even when its supplied signal stays live", async () => {
  const stop = new AbortController();
  const scope = createScope({ clock: makeTestClock() });
  const work = operation({
    label: "work",
    run: (_deps, ctx) => ctx.clock.sleep(100, ctx.signal),
  });
  const running = scope.settle(work, { signal: stop.signal });
  const closing = scope.close();
  const result = await running;
  if (result.status !== "cancelled") throw result;
  const ended = await closing;
  if (ended.status !== "cancelled") throw ended;
  expect(result.reason).toBe(ended.reason);
  expect(stop.signal.aborted).toBe(false);
});
