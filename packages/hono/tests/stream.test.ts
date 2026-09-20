import { expect, test } from "vite-plus/test";
import { Hono } from "hono";
import {
  createScope,
  makeTestClock,
  operation,
  resource,
  type Clock,
  type Resource,
  type Scope,
} from "@tinker/core";
import { handle, isError, request, stream, tinker } from "../src/index.ts";

/** A session-target resource delivering the request path; its defer records the end status.
 * Ops must READ it (resource deps build lazily on first access) for the defer to exist. */
function pathResource(ends: string[]): Resource.Handle<string> {
  return resource({
    label: "perRequest",
    target: "session",
    depends: { req: request },
    factory: ({ req }, ctx) => {
      ctx.defer((end) => {
        ends.push(end.status);
      });
      return new URL(req.url).pathname;
    },
  });
}

/** A chunks route streaming its value with a TestClock pause between chunks. */
function streamApp(scope: Scope.Handle, path: Resource.Handle<string>): Hono {
  const chunks = operation({ label: "chunks", depends: { path }, run: ({ path }) => [path, "b"] });
  return new Hono().use(tinker(scope)).get(
    "/stream",
    handle(chunks, {
      respond: (cs, c) =>
        stream(c, async (emit, { clock, signal }) => {
          for (const ch of cs) {
            emit(ch);
            await clock.sleep(10, signal);
          }
        }),
    }),
  );
}

/** Read every chunk, advancing the clock past each pause; drain like the core tests. */
async function readAll(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  clk: Clock.Test,
): Promise<string[]> {
  const decoder = new TextDecoder();
  const seen: string[] = [];
  for (;;) {
    const reading = reader.read();
    clk.advance(10);
    await Promise.resolve();
    const { done, value } = await reading;
    if (done) return seen;
    seen.push(decoder.decode(value));
  }
}

function readerOf(res: Response): ReadableStreamDefaultReader<Uint8Array> {
  const body = res.body;
  if (!body) throw new Error("no body");
  return body.getReader();
}

test("the body yields each chunk as the clock advances, then ends", async () => {
  const clk = makeTestClock({ now: 0 });
  const chunks = operation({ label: "chunks", run: () => ["a", "b", "c"] });
  const scope = createScope({ clock: clk });
  const app = new Hono().use(tinker(scope)).get(
    "/stream",
    handle(chunks, {
      respond: (cs, c) =>
        stream(c, async (emit, { clock, signal }) => {
          for (const ch of cs) {
            emit(ch);
            await clock.sleep(10, signal);
          }
        }),
    }),
  );
  const res = await app.request("/stream");
  expect(res.status).toBe(200);
  expect(await readAll(readerOf(res), clk)).toEqual(["a", "b", "c"]);
  await scope.close();
});

test("a session resource's defer runs only after the last chunk was read", async () => {
  const clk = makeTestClock({ now: 0 });
  const ends: string[] = [];
  const scope = createScope({ clock: clk });
  const app = streamApp(scope, pathResource(ends));
  const res = await app.request("/stream");
  expect(res.status).toBe(200);
  expect(ends).toEqual([]);
  expect(await readAll(readerOf(res), clk)).toEqual(["/stream", "b"]);
  for (let i = 0; i < 50 && ends.length === 0; i++) await Promise.resolve();
  expect(ends).toEqual(["success"]);
  await scope.close();
});

test("cancelling the reader mid-body force-closes the session and stops the writer", async () => {
  const clk = makeTestClock({ now: 0 });
  const ends: string[] = [];
  const path = pathResource(ends);
  const chunks = operation({
    label: "chunks",
    depends: { path },
    run: ({ path }) => [path, "b", "c"],
  });
  let emitted = 0;
  const scope = createScope({ clock: clk });
  const app = new Hono().use(tinker(scope)).get(
    "/stream",
    handle(chunks, {
      respond: (cs, c) =>
        stream(c, async (emit, { clock, signal }) => {
          for (const ch of cs) {
            emitted++;
            emit(ch);
            await clock.sleep(10, signal);
          }
        }),
    }),
  );
  const res = await app.request("/stream");
  const reader = readerOf(res);
  expect(new TextDecoder().decode((await reader.read()).value)).toBe("/stream");
  await reader.cancel();
  for (let i = 0; i < 100 && ends.length === 0; i++) await Promise.resolve();
  expect(ends).toEqual(["cancelled"]);
  expect(emitted).toBe(1);
  await scope.close();
});

test("a throwing writer errors the body and the session settles failed", async () => {
  const boom = new Error("kaboom");
  const ends: string[] = [];
  const path = pathResource(ends);
  const clk = makeTestClock({ now: 0 });
  const chunks = operation({ label: "chunks", depends: { path }, run: ({ path }) => [path] });
  const scope = createScope({ clock: clk });
  const app = new Hono().use(tinker(scope)).get(
    "/stream",
    handle(chunks, {
      respond: (cs, c) =>
        stream(c, async (emit, { clock }) => {
          emit(cs[0] ?? "");
          await clock.sleep(10);
          throw boom;
        }),
    }),
  );
  const res = await app.request("/stream");
  expect(res.status).toBe(200);
  expect(ends).toEqual([]);
  const reader = readerOf(res);
  expect(new TextDecoder().decode((await reader.read()).value)).toBe("/stream");
  clk.advance(10);
  await Promise.resolve();
  const outcome = await reader.read().then(
    () => "resolved",
    (error: unknown) => error,
  );
  expect(outcome).toBe(boom);
  for (let i = 0; i < 50 && ends.length === 0; i++) await Promise.resolve();
  expect(ends).toEqual(["failed"]);
  await scope.close();
});

test("a plain handle route on the same app still commits right after next", async () => {
  const ends: string[] = [];
  const path = pathResource(ends);
  const ping = operation({ label: "ping", depends: { path }, run: ({ path }) => `pong${path}` });
  const scope = createScope();
  const app = streamApp(scope, path).get("/ping", handle(ping));
  const res = await app.request("/ping");
  expect(res.status).toBe(200);
  expect(await res.json()).toBe("pong/ping");
  expect(ends).toEqual(["success"]);
  await scope.close();
});

test("the request session commits on success, rolls back on abort, fails on an unmapped error", async () => {
  const outcomes: string[] = [];
  const tx = resource({
    label: "tx",
    target: "session",
    depends: { req: request },
    factory: (_deps, ctx) => {
      ctx.defer((end) => {
        outcomes.push(end.status);
      });
      return "tx";
    },
  });
  const parseId = (raw: unknown): number => {
    const id = Number(raw);
    if (Number.isNaN(id)) throw new Error("bad id");
    return id;
  };
  const get = operation({
    label: "get",
    input: parseId,
    depends: { tx },
    run: ({ tx }, ctx) => `${tx}:${ctx.input}`,
  });
  const boom = operation({
    label: "boom",
    depends: { tx },
    run: ({ tx }) => {
      void tx;
      throw new Error("kaboom");
    },
  });
  const scope = createScope();
  const app = new Hono()
    .use(tinker(scope))
    .get("/ok/:id", handle(get, { input: (c) => c.req.param("id") }))
    .get("/boom", handle(boom));
  app.onError((e, c) => c.text("err", 500));
  const good = await app.request("/ok/42");
  expect(good.status).toBe(200);
  expect(await good.json()).toBe("tx:42");
  expect(outcomes).toEqual(["success"]);
  const ac = new AbortController();
  const pending = app.request("/ok/7", { signal: ac.signal });
  ac.abort();
  await Promise.allSettled([pending]);
  for (let i = 0; i < 50 && outcomes.length < 2; i++) await Promise.resolve();
  expect(outcomes).toEqual(["success", "cancelled"]);
  const bad = await app.request("/boom");
  expect(bad.status).toBe(500);
  for (let i = 0; i < 50 && outcomes.length < 3; i++) await Promise.resolve();
  expect(outcomes).toEqual(["success", "cancelled", "failed"]);
  const invalid = await app.request("/ok/abc");
  expect(invalid.status).toBe(400);
  for (let i = 0; i < 50; i++) await Promise.resolve();
  expect(outcomes).toEqual(["success", "cancelled", "failed"]);
  await scope.close();
});

test("stream without tinker raises NoSession to onError", async () => {
  let seen: unknown;
  const app = new Hono().get("/stream", (c) =>
    stream(c, (emit) => {
      emit("a");
      return Promise.resolve();
    }),
  );
  app.onError((e, c) => {
    seen = e;
    return c.text("err", 500);
  });
  const res = await app.request("/stream");
  expect(res.status).toBe(500);
  if (!isError(seen, "NoSession")) throw seen;
  expect(seen.payload.label).toBe("stream");
});
