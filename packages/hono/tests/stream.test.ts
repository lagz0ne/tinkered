import { expect, test } from "vite-plus/test";
import { Hono } from "hono";
import {
  createScope,
  makeTestClock,
  namespace,
  operation,
  resource,
  tag,
  type Clock,
  type Resource,
} from "@tinker/core";
import { emit, hono, isError, request, route, stream } from "../src/index.ts";

const body = operation({
  label: "streamBody",
  input: (raw: unknown) => raw as string[],
  depends: { emit: emit.required },
  run: async ({ emit }, { input, clock, signal }) => {
    for (const ch of input) {
      emit(ch);
      await clock.sleep(10, signal);
    }
  },
});

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

/** A chunks row streaming its value with a TestClock pause between chunks. */
function streamRow(path: Resource.Handle<string>) {
  const chunks = operation({ label: "chunks", depends: { path }, run: ({ path }) => [path, "b"] });
  return route.get("/stream", chunks, {
    respond: (cs, c) => stream(c, body, { input: cs }),
  });
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
  const { extension: web } = hono([
    route.get("/stream", chunks, {
      respond: (cs, c) => stream(c, body, { input: cs }),
    }),
  ]);
  const scope = createScope({ clock: clk, observe: { history: 20 }, extensions: [web] });
  await scope.ready;
  const res = await scope.resolve(web).request("/stream");
  expect(res.status).toBe(200);
  expect(scope.spans().find((span) => span.name === "GET /stream")?.status).toBe("ok");
  expect(await readAll(readerOf(res), clk)).toEqual(["a", "b", "c"]);
  expect(scope.spans().find((span) => span.name === "streamBody")?.status).toBe("ok");
  expect(scope.spans().some((span) => span.name === "GET /stream body")).toBe(false);
  await scope.close();
});

test("emit passes byte chunks unchanged to the reader", async () => {
  const bytes = new Uint8Array([0, 128, 255]);
  const send = operation({
    label: "sendBytes",
    depends: { emit: emit.required },
    run: ({ emit }) => emit(bytes),
  });
  const ready = operation({ label: "ready", run: () => undefined });
  const { extension: web } = hono([
    route.get("/bytes", ready, { respond: (_value, c) => stream(c, send) }),
  ]);
  const scope = createScope({ extensions: [web] });
  await scope.ready;
  const res = await scope.resolve(web).request("/bytes");
  expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  await scope.close();
});

test("a stream call namespace selects the body's namespace bindings", async () => {
  const flavor = tag<string>({ label: "flavor" });
  const alpha = namespace({ tags: [flavor("alpha")] });
  const send = operation({
    label: "sendFlavor",
    depends: { emit: emit.required, flavor: flavor.required },
    run: ({ emit, flavor }) => emit(flavor),
  });
  const ready = operation({ label: "ready", run: () => undefined });
  const { extension: web } = hono([
    route.get("/flavor", ready, { respond: (_value, c) => stream(c, send, { ns: alpha }) }),
  ]);
  const scope = createScope({ extensions: [web] });
  await scope.ready;
  const res = await scope.resolve(web).request("/flavor");
  expect(await res.text()).toBe("alpha");
  await scope.close();
});

test("body uses its own label, input and per-call tags without leaking between requests", async () => {
  const flavor = tag<string>({ label: "flavor" });
  const labeledBody = operation({
    label: "labeledBody",
    input: (raw: unknown) => raw as string,
    depends: { emit: emit.required, flavor: flavor.required },
    run: ({ emit, flavor }, { input }) => emit(`${input}:${flavor}`),
  });
  const label = operation({ label: "label", run: () => "hello" });
  const { extension: web } = hono([
    route.get("/body", label, {
      respond: (value, c) =>
        stream(c, labeledBody, {
          input: value,
          tags: [flavor(c.req.header("x-flavor") ?? "plain")],
        }),
    }),
  ]);
  const scope = createScope({ observe: { history: 20 }, extensions: [web] });
  await scope.ready;
  const app = scope.resolve(web);
  const [one, two] = await Promise.all([
    app.request("/body", { headers: { "x-flavor": "vanilla" } }),
    app.request("/body", { headers: { "x-flavor": "chocolate" } }),
  ]);
  expect(await one.text()).toBe("hello:vanilla");
  expect(await two.text()).toBe("hello:chocolate");
  expect(scope.spans().filter((span) => span.name === "labeledBody")).toHaveLength(2);
  expect(scope.spans().some((span) => span.name === "GET /body body")).toBe(false);
  await scope.close();
});

test("route and body have separate session resources that both end with the request", async () => {
  let builds = 0;
  const ends: string[] = [];
  const tx = resource({
    label: "tx",
    target: "session",
    factory: (_deps, { defer }) => {
      const id = ++builds;
      defer((end) => {
        ends.push(`${id}:${end.status}`);
      });
      return id;
    },
  });
  const start = operation({ label: "start", depends: { tx }, run: ({ tx }) => tx });
  const readBody = operation({
    label: "readBodyTx",
    input: (raw: unknown) => raw as number,
    depends: { tx, emit: emit.required },
    run: async ({ tx, emit }, { input, clock, signal }) => {
      emit(`${input}:${tx}`);
      await clock.sleep(10, signal);
    },
  });
  const { extension: web } = hono([
    route.get("/stream", start, { respond: (id, c) => stream(c, readBody, { input: id }) }),
  ]);
  const clock = makeTestClock({ now: 0 });
  const scope = createScope({ clock, extensions: [web] });
  await scope.ready;
  const res = await scope.resolve(web).request("/stream");
  expect(builds).toBe(2);
  expect(ends).toEqual([]);
  const reader = readerOf(res);
  expect(new TextDecoder().decode((await reader.read()).value)).toBe("1:2");
  const last = reader.read();
  clock.advance(10);
  expect((await last).done).toBe(true);
  for (let i = 0; i < 100 && ends.length < 2; i++) await Promise.resolve();
  expect(ends.sort()).toEqual(["1:success", "2:success"]);
  await scope.close();
});

test("a session resource's defer runs only after the last chunk was read", async () => {
  const clk = makeTestClock({ now: 0 });
  const ends: string[] = [];
  const { extension: web } = hono([streamRow(pathResource(ends))]);
  const scope = createScope({ clock: clk, extensions: [web] });
  await scope.ready;
  const res = await scope.resolve(web).request("/stream");
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
  const counted = operation({
    label: "countedBody",
    input: (raw: unknown) => raw as string[],
    depends: { emit: emit.required },
    run: async ({ emit }, { input, clock, signal }) => {
      for (const ch of input) {
        emitted++;
        emit(ch);
        await clock.sleep(10, signal);
      }
    },
  });
  const { extension: web } = hono([
    route.get("/stream", chunks, {
      respond: (cs, c) => stream(c, counted, { input: cs }),
    }),
  ]);
  const scope = createScope({ clock: clk, extensions: [web] });
  await scope.ready;
  const res = await scope.resolve(web).request("/stream");
  const reader = readerOf(res);
  expect(new TextDecoder().decode((await reader.read()).value)).toBe("/stream");
  await reader.cancel();
  for (let i = 0; i < 100 && ends.length === 0; i++) await Promise.resolve();
  expect(ends).toEqual(["cancelled"]);
  expect(emitted).toBe(1);
  await scope.close();
});

test("raw request abort cancels the body and both sessions", async () => {
  const clock = makeTestClock({ now: 0 });
  const requestEnds: string[] = [];
  const bodyEnds: string[] = [];
  const path = pathResource(requestEnds);
  const start = operation({ label: "start", depends: { path }, run: ({ path }) => path });
  const held = operation({
    label: "heldBody",
    input: (raw: unknown) => raw as string,
    depends: { emit: emit.required },
    run: async ({ emit }, { input, signal, clock, defer }) => {
      defer((end) => {
        bodyEnds.push(`${end.status}:${signal.aborted}`);
      });
      emit(input);
      await clock.sleep(10_000, signal);
    },
  });
  const { extension: web } = hono([
    route.get("/stream", start, { respond: (path, c) => stream(c, held, { input: path }) }),
  ]);
  const scope = createScope({ clock, extensions: [web] });
  await scope.ready;
  const ac = new AbortController();
  const res = await scope.resolve(web).request("/stream", { signal: ac.signal });
  const reader = readerOf(res);
  expect(new TextDecoder().decode((await reader.read()).value)).toBe("/stream");
  ac.abort();
  for (let i = 0; i < 100 && (requestEnds.length === 0 || bodyEnds.length === 0); i++)
    await Promise.resolve();
  expect(bodyEnds).toEqual(["cancelled:true"]);
  expect(requestEnds).toEqual(["cancelled"]);
  expect((await scope.close()).status).toBe("cancelled");
});

test("stream keeps an explicit content-type and defaults to text/plain", async () => {
  const send = operation({
    label: "send",
    depends: { emit: emit.required },
    run: ({ emit }) => emit("ok"),
  });
  const ready = operation({ label: "ready", run: () => undefined });
  const { extension: web } = hono([
    route.get("/event", ready, {
      respond: (_value, c) => {
        c.header("Content-Type", "text/event-stream");
        return stream(c, send);
      },
    }),
    route.get("/plain", ready, { respond: (_value, c) => stream(c, send) }),
  ]);
  const scope = createScope({ extensions: [web] });
  await scope.ready;
  const app = scope.resolve(web);
  const event = await app.request("/event");
  const plain = await app.request("/plain");
  expect(event.headers.get("content-type")).toBe("text/event-stream");
  expect(plain.headers.get("content-type")).toBe("text/plain; charset=UTF-8");
  expect(await event.text()).toBe("ok");
  expect(await plain.text()).toBe("ok");
  await scope.close();
});

test("a body can settle a failing subflow and finish its stream", async () => {
  const ends: string[] = [];
  const path = pathResource(ends);
  const fail = operation({
    label: "fail",
    run: async () => {
      throw new Error("settled");
    },
  });
  const recover = operation({
    label: "recover",
    depends: { emit: emit.required, fail, path },
    run: async ({ emit, fail, path }) => {
      if ((await fail.settle()).status === "failed") emit(`recovered ${path}`);
    },
  });
  const start = operation({ label: "start", run: () => undefined });
  const { extension: web } = hono([
    route.get("/stream", start, { respond: (_value, c) => stream(c, recover) }),
  ]);
  const scope = createScope({ extensions: [web] });
  await scope.ready;
  const res = await scope.resolve(web).request("/stream");
  expect(await res.text()).toBe("recovered /stream");
  for (let i = 0; i < 50 && ends.length === 0; i++) await Promise.resolve();
  expect(ends).toEqual(["success"]);
  await scope.close();
});

test("a throwing writer errors the body and the session settles failed", async () => {
  const boom = new Error("kaboom");
  const ends: string[] = [];
  const path = pathResource(ends);
  const clk = makeTestClock({ now: 0 });
  const chunks = operation({ label: "chunks", depends: { path }, run: ({ path }) => [path] });
  const broken = operation({
    label: "brokenBody",
    input: (raw: unknown) => raw as string[],
    depends: { emit: emit.required },
    run: async ({ emit }, { input, clock }) => {
      emit(input[0] ?? "");
      await clock.sleep(10);
      throw boom;
    },
  });
  const { extension: web } = hono([
    route.get("/stream", chunks, {
      respond: (cs, c) => stream(c, broken, { input: cs }),
    }),
  ]);
  const scope = createScope({ clock: clk, observe: { history: 20 }, extensions: [web] });
  await scope.ready;
  const res = await scope.resolve(web).request("/stream");
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
  expect(scope.spans().find((span) => span.name === "brokenBody")?.status).toBe("failed");
  expect(scope.spans().some((span) => span.name === "stream failure")).toBe(false);
  await scope.close();
});

test("a plain row on the same app still commits right after the handler", async () => {
  const ends: string[] = [];
  const path = pathResource(ends);
  const ping = operation({ label: "ping", depends: { path }, run: ({ path }) => `pong${path}` });
  const { extension: web } = hono([streamRow(pathResource(ends)), route.get("/ping", ping)]);
  const scope = createScope({ extensions: [web] });
  await scope.ready;
  const res = await scope.resolve(web).request("/ping");
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
  const { extension: web } = hono([
    route.get("/ok/:id", get, { input: (c) => c.req.param("id") }),
    route.get("/boom", boom),
  ]);
  const scope = createScope({ extensions: [web] });
  await scope.ready;
  const app = scope.resolve(web);
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

test("stream without the extension's middleware raises NoSession to onError", async () => {
  let seen: unknown;
  const app = new Hono().get("/stream", (c) => stream(c, body, { input: ["a"] }));
  app.onError((e, c) => {
    seen = e;
    return c.text("err", 500);
  });
  const res = await app.request("/stream");
  expect(res.status).toBe(500);
  if (!isError(seen, "NoSession")) throw seen;
  expect(seen.payload.label).toBe("stream");
});
